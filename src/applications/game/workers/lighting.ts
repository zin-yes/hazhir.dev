import { CellQueue } from "../edits/cell-queue";
import {
  CELLS_PER_CHUNK,
  CHUNK_MASK,
  CHUNK_SHIFT,
  ChunkCluster,
  DIRECTION_COUNT,
  DIRECTION_OFFSET_X,
  DIRECTION_OFFSET_Y,
  DIRECTION_OFFSET_Z,
  NEGATIVE_X,
  NEGATIVE_Y,
  NEGATIVE_Z,
  NO_CHUNK,
  NO_CHUNKS_SOURCE,
  POSITIVE_X,
  POSITIVE_Y,
  POSITIVE_Z,
  X_STRIDE,
  Y_STRIDE,
} from "../edits/chunk-cluster";
import { FloodStats, spreadLight } from "../edits/light-flood";
import { EMISSION, IS_TRANSPARENT, MAX_LIGHT } from "../edits/light-tables";
import { BlockType } from "../blocks";
import { DIMENSIONS } from "../profiler/dimensions";
import { SEA_LEVEL } from "../worldgen/constants";
import {
  addWorkerCounter,
  addWorkerKeyedUnits,
  endWorkerSection,
  isWorkerProfiling,
  startWorkerSection,
} from "../profiler/worker-recorder";

const CHUNK_SIZE = CHUNK_MASK + 1;
const COLUMN_COUNT = CHUNK_SIZE * CHUNK_SIZE;
const BLOCK_ID_COUNT = 256;
const BYTES_PER_WORD = 4;
const SKY_LIT_CELL = MAX_LIGHT << 4;

const LIGHT_STAGE_SKY = "sky";
const LIGHT_STAGE_BLOCK_SOURCES = "blockSources";
const LIGHT_STAGE_FRONTIER = "frontier";
const LIGHT_STAGE_BORDER_EXCHANGE = "borderExchange";
const LIGHT_STAGE_FLOOD = "flood";
const LIGHT_STAGE_NEIGHBOR_UPDATES = "neighborUpdates";
const LIGHT_EMITTER_KEY_PREFIX = "emitter.";
const LIGHT_CHANNEL_SKY = "sky";
const LIGHT_CHANNEL_BLOCK = "block";
const SKY_ENTRY_SOURCE_COUNTER_KNOWN_LIGHT = "skyEntryColumnsFromLightAbove";
const SKY_ENTRY_SOURCE_COUNTER_KNOWN_BLOCKS = "skyEntryColumnsFromBlocksAbove";
const SKY_ENTRY_SOURCE_COUNTER_ASSUMED = "skyEntryColumnsAssumed";

const getIndex = (x: number, y: number, z: number) =>
  (x << (CHUNK_SHIFT * 2)) | (y << CHUNK_SHIFT) | z;

export interface InitializedChunkLight {
  light: Uint8Array;
  /**
   * Cells that may still brighten a neighbor, as chunk indices. Sky-lit cells
   * whose surroundings are already as bright as light could make them are left
   * out, since flooding from them would change nothing.
   */
  queue: Uint32Array;
  /** Every open cell is full sky light and nothing glows, so spreading light cannot change anything. */
  isFullySunlit: boolean;
}

// Scratch space reused by every call, since a worker lights one chunk at a time.
const lowestLitHeightByColumn = new Uint8Array(COLUMN_COUNT);
const emitterIndices = new Uint16Array(CELLS_PER_CHUNK);
const queueScratch = new Uint32Array(CELLS_PER_CHUNK * 2);
const frontierStats = { edgeCells: 0, interiorCells: 0 };

/** The block id every cell of the chunk holds, or -1 when the chunk is mixed. */
function findUniformBlock(chunk: Uint8Array): number {
  const firstBlock = chunk[0];
  if (chunk.byteOffset % BYTES_PER_WORD !== 0) {
    for (let index = 1; index < chunk.length; index++) {
      if (chunk[index] !== firstBlock) return -1;
    }
    return firstBlock;
  }
  const words = new Uint32Array(
    chunk.buffer,
    chunk.byteOffset,
    chunk.length / BYTES_PER_WORD,
  );
  const firstWord = words[0];
  if (firstWord !== (firstBlock * 0x01010101) >>> 0) return -1;
  for (let word = 1; word < words.length; word++) {
    if (words[word] !== firstWord) return -1;
  }
  return firstBlock;
}

/** True when every cell in the column of the chunk lets light through. */
function isColumnOpen(chunk: Uint8Array, x: number, z: number): boolean {
  let index = getIndex(x, 0, z);
  for (let y = 0; y < CHUNK_SIZE; y++, index += Y_STRIDE) {
    if (IS_TRANSPARENT[chunk[index]] === 0) return false;
  }
  return true;
}

/**
 * Whether sky light enters the top of a column: read from the light of the
 * chunk above when it is known, else from whether the chunk above is open air
 * all the way down. With nothing known above, the chunk's own data decides:
 * from sea level up the sky is assumed open, which is right at and above the
 * top of the world and wherever the ground tops out inside the chunk; below
 * sea level only a water column is, since ocean water reaches the surface
 * while an open cave in the top layer is almost always buried. (This replaces
 * sampling the terrain height, which cost a noise lookup per column. It differs
 * from that only for caves open at the top of a chunk above sea level and for
 * water-filled caves below it, both of which now start lit.)
 */
function isSkyEnteringColumn(
  chunk: Uint8Array,
  x: number,
  z: number,
  isChunkAtOrAboveSeaLevel: boolean,
  topChunk: Uint8Array | undefined,
  topChunkLight: Uint8Array | undefined,
): boolean {
  if (topChunkLight) return topChunkLight[getIndex(x, 0, z)] >> 4 === MAX_LIGHT;
  if (topChunk) return isColumnOpen(topChunk, x, z);
  return (
    isChunkAtOrAboveSeaLevel ||
    chunk[getIndex(x, CHUNK_SIZE - 1, z)] === BlockType.WATER
  );
}

/**
 * Initializes the light map for a newly generated chunk from the chunk data
 * alone: sun falls down every column the sky enters until the first opaque
 * block, and light sources glow. Only the chunk's height is needed, to tell
 * ground from sky when nothing above it is known.
 */
export function initializeChunkLight(
  chunk: Uint8Array,
  _seed: number,
  _chunkX: number,
  chunkY: number,
  _chunkZ: number,
  topChunk?: Uint8Array,
  topChunkLight?: Uint8Array,
): InitializedChunkLight {
  return initializeChunkLightFromAbove(chunk, chunkY, topChunk, topChunkLight);
}

export function initializeChunkLightFromAbove(
  chunk: Uint8Array,
  chunkY: number,
  topChunk?: Uint8Array,
  topChunkLight?: Uint8Array,
): InitializedChunkLight {
  const isProfiling = isWorkerProfiling();
  startWorkerSection("allocateLightMap");
  const light = new Uint8Array(CELLS_PER_CHUNK);
  endWorkerSection();
  addWorkerCounter("lightMapBytes", light.byteLength);

  const uniformBlock = findUniformBlock(chunk);
  const isUniformOpaque =
    uniformBlock >= 0 &&
    IS_TRANSPARENT[uniformBlock] === 0 &&
    EMISSION[uniformBlock] === 0;
  if (isUniformOpaque) {
    addWorkerCounter("uniformChunksSkipped", 1);
    addWorkerCounter("fullySunlitChunks", 1);
    return { light, queue: new Uint32Array(0), isFullySunlit: true };
  }
  const isUniformOpenNonEmitting =
    uniformBlock >= 0 &&
    IS_TRANSPARENT[uniformBlock] === 1 &&
    EMISSION[uniformBlock] === 0;
  if (isUniformOpenNonEmitting) addWorkerCounter("uniformOpenChunksSeen", 1);

  // 1. Count open cells and find the light sources.
  startWorkerSection(
    "blockLightScan",
    DIMENSIONS.lightKind,
    LIGHT_STAGE_BLOCK_SOURCES,
  );
  let openCellCount = CELLS_PER_CHUNK;
  let emitterCount = 0;
  if (!isUniformOpenNonEmitting) {
    openCellCount = 0;
    for (let index = 0; index < CELLS_PER_CHUNK; index++) {
      const block = chunk[index];
      openCellCount += IS_TRANSPARENT[block];
      if (EMISSION[block] > 0) emitterIndices[emitterCount++] = index;
    }
  }
  endWorkerSection();

  // 2. Sunlight: every column the sky enters is lit from the top down to its first opaque block.
  startWorkerSection("sunlightColumns", DIMENSIONS.lightKind, LIGHT_STAGE_SKY);
  let skyLitCellCount = 0;
  let columnsEnteredBySky = 0;
  const isChunkAtOrAboveSeaLevel =
    chunkY * CHUNK_SIZE + CHUNK_SIZE - 1 >= SEA_LEVEL;
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      let lowestLitHeight = CHUNK_SIZE;
      if (
        isSkyEnteringColumn(
          chunk,
          x,
          z,
          isChunkAtOrAboveSeaLevel,
          topChunk,
          topChunkLight,
        )
      ) {
        columnsEnteredBySky++;
        let index = getIndex(x, CHUNK_SIZE - 1, z);
        while (lowestLitHeight > 0 && IS_TRANSPARENT[chunk[index]] === 1) {
          light[index] = SKY_LIT_CELL;
          lowestLitHeight--;
          index -= Y_STRIDE;
        }
        skyLitCellCount += CHUNK_SIZE - lowestLitHeight;
      }
      lowestLitHeightByColumn[(x << CHUNK_SHIFT) | z] = lowestLitHeight;
    }
  }
  endWorkerSection();

  // 3. Queue the light sources and the sky-lit cells that can still brighten something.
  startWorkerSection(
    "frontierQueue",
    DIMENSIONS.lightKind,
    LIGHT_STAGE_FRONTIER,
  );
  let queueLength = 0;
  frontierStats.edgeCells = 0;
  frontierStats.interiorCells = 0;
  for (let emitter = 0; emitter < emitterCount; emitter++) {
    const index = emitterIndices[emitter];
    light[index] = (light[index] & 0xf0) | EMISSION[chunk[index]];
    queueScratch[queueLength++] = index;
  }
  const lightSourceQueueLength = queueLength;
  queueLength = queueSkyFrontier(chunk, queueLength);
  endWorkerSection();

  startWorkerSection("queueToTypedArray");
  const queueCells = queueScratch.slice(0, queueLength);
  endWorkerSection();

  const isFullySunlit = emitterCount === 0 && skyLitCellCount === openCellCount;
  addWorkerCounter("columnsExposed", columnsEnteredBySky);
  addWorkerCounter("lightSourcesFound", emitterCount);
  addWorkerCounter("queueLength", queueLength);
  addWorkerCounter("frontierCellsQueued", queueLength - lightSourceQueueLength);
  addWorkerCounter("openCellsScanned", openCellCount);
  addWorkerCounter("skyLitCells", skyLitCellCount);
  addWorkerCounter("queueBytes", queueCells.byteLength);
  addWorkerCounter("frontierEdgeCellsQueued", frontierStats.edgeCells);
  addWorkerCounter("frontierInteriorCellsQueued", frontierStats.interiorCells);
  addWorkerCounter("emitterCellsQueued", lightSourceQueueLength);
  addWorkerCounter("blockedColumns", COLUMN_COUNT - columnsEnteredBySky);
  addWorkerCounter(
    topChunkLight
      ? SKY_ENTRY_SOURCE_COUNTER_KNOWN_LIGHT
      : topChunk
        ? SKY_ENTRY_SOURCE_COUNTER_KNOWN_BLOCKS
        : SKY_ENTRY_SOURCE_COUNTER_ASSUMED,
    COLUMN_COUNT,
  );
  if (isFullySunlit) addWorkerCounter("fullySunlitChunks", 1);
  if (isProfiling) {
    addWorkerKeyedUnits(DIMENSIONS.lightChannel, LIGHT_CHANNEL_SKY, skyLitCellCount);
    addWorkerKeyedUnits(DIMENSIONS.lightChannel, LIGHT_CHANNEL_BLOCK, emitterCount);
    addWorkerKeyedUnits(DIMENSIONS.lightKind, LIGHT_STAGE_SKY, columnsEnteredBySky);
    addWorkerKeyedUnits(DIMENSIONS.lightKind, LIGHT_STAGE_BLOCK_SOURCES, emitterCount);
    addWorkerKeyedUnits(
      DIMENSIONS.lightKind,
      LIGHT_STAGE_FRONTIER,
      queueLength - lightSourceQueueLength,
    );
    reportEmitterKinds(chunk, emitterCount);
  }

  return { light, queue: queueCells, isFullySunlit };
}

function reportEmitterKinds(chunk: Uint8Array, emitterCount: number) {
  const emitterCountsByBlockId = new Int32Array(BLOCK_ID_COUNT);
  for (let emitter = 0; emitter < emitterCount; emitter++) {
    emitterCountsByBlockId[chunk[emitterIndices[emitter]]]++;
  }
  for (let blockId = 0; blockId < BLOCK_ID_COUNT; blockId++) {
    if (emitterCountsByBlockId[blockId] === 0) continue;
    addWorkerKeyedUnits(
      DIMENSIONS.lightKind,
      LIGHT_EMITTER_KEY_PREFIX + (BlockType[blockId] ?? `block${blockId}`),
      emitterCountsByBlockId[blockId],
    );
  }
}

/**
 * Queues the sky-lit cells that matter to the flood fill: those on the chunk
 * edge (the neighbor is unknown) or the bottom layer, and those beside an open
 * cell the sky does not reach. Light never needs to go up from a lit cell, and
 * a lit column runs unbroken from the top of the chunk, so the only dim open
 * cells beside a lit cell are in the columns next to it, below their lit run.
 */
function queueSkyFrontier(chunk: Uint8Array, queueLength: number): number {
  const bottoms = lowestLitHeightByColumn;
  const lastIndex = CHUNK_SIZE - 1;
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const column = (x << CHUNK_SHIFT) | z;
      const lowest = bottoms[column];
      if (lowest === CHUNK_SIZE) continue;

      const isOnChunkEdge =
        x === 0 || x === lastIndex || z === 0 || z === lastIndex;
      if (isOnChunkEdge) {
        for (let y = lowest; y < CHUNK_SIZE; y++) {
          queueScratch[queueLength++] = getIndex(x, y, z);
        }
        frontierStats.edgeCells += CHUNK_SIZE - lowest;
        continue;
      }

      const bottomPositiveX = bottoms[column + CHUNK_SIZE];
      const bottomNegativeX = bottoms[column - CHUNK_SIZE];
      const bottomPositiveZ = bottoms[column + 1];
      const bottomNegativeZ = bottoms[column - 1];
      const tallestNeighborBottom = Math.max(
        bottomPositiveX,
        bottomNegativeX,
        bottomPositiveZ,
        bottomNegativeZ,
      );
      const lastCandidate = Math.max(
        Math.min(lastIndex, tallestNeighborBottom - 1),
        lowest === 0 ? 0 : -1,
      );
      for (let y = lowest; y <= lastCandidate; y++) {
        const index = getIndex(x, y, z);
        if (
          y === 0 ||
          (y < bottomPositiveX && IS_TRANSPARENT[chunk[index + X_STRIDE]] === 1) ||
          (y < bottomNegativeX && IS_TRANSPARENT[chunk[index - X_STRIDE]] === 1) ||
          (y < bottomPositiveZ && IS_TRANSPARENT[chunk[index + 1]] === 1) ||
          (y < bottomNegativeZ && IS_TRANSPARENT[chunk[index - 1]] === 1)
        ) {
          queueScratch[queueLength++] = index;
          frontierStats.interiorCells++;
        }
      }
    }
  }
  return queueLength;
}

// For each direction: the chunk's own boundary cells and the matching cells of the neighbor beyond.
const FACE_CENTER_INDICES: Int32Array[] = [];
const FACE_NEIGHBOR_INDICES: Int32Array[] = [];
(function buildFaceTables() {
  const last = CHUNK_SIZE - 1;
  for (let direction = 0; direction < DIRECTION_COUNT; direction++) {
    const centerIndices = new Int32Array(CHUNK_SIZE * CHUNK_SIZE);
    const neighborIndices = new Int32Array(CHUNK_SIZE * CHUNK_SIZE);
    for (let first = 0; first < CHUNK_SIZE; first++) {
      for (let second = 0; second < CHUNK_SIZE; second++) {
        const position = first * CHUNK_SIZE + second;
        switch (direction) {
          case NEGATIVE_X:
            centerIndices[position] = getIndex(0, first, second);
            neighborIndices[position] = getIndex(last, first, second);
            break;
          case POSITIVE_X:
            centerIndices[position] = getIndex(last, first, second);
            neighborIndices[position] = getIndex(0, first, second);
            break;
          case NEGATIVE_Y:
            centerIndices[position] = getIndex(first, 0, second);
            neighborIndices[position] = getIndex(first, last, second);
            break;
          case POSITIVE_Y:
            centerIndices[position] = getIndex(first, last, second);
            neighborIndices[position] = getIndex(first, 0, second);
            break;
          case NEGATIVE_Z:
            centerIndices[position] = getIndex(first, second, 0);
            neighborIndices[position] = getIndex(first, second, last);
            break;
          case POSITIVE_Z:
            centerIndices[position] = getIndex(first, second, last);
            neighborIndices[position] = getIndex(first, second, 0);
            break;
        }
      }
    }
    FACE_CENTER_INDICES.push(centerIndices);
    FACE_NEIGHBOR_INDICES.push(neighborIndices);
  }
})();

const NEIGHBOR_KEYS = [
  "1,0,0",
  "-1,0,0",
  "0,1,0",
  "0,-1,0",
  "0,0,1",
  "0,0,-1",
];
const CENTER_SLOT = 0;
const DIRECTION_NAMES = ["positiveX", "negativeX", "positiveY", "negativeY", "positiveZ", "negativeZ"];
const BORDER_EXAMINED_COUNTER_NAMES = DIRECTION_NAMES.map((name) => `borderCellsExamined.${name}`);
const BORDER_SEEDED_COUNTER_NAMES = DIRECTION_NAMES.map((name) => `borderCellsSeeded.${name}`);

const propagationCluster = new ChunkCluster();
const propagationQueue = new CellQueue();
const propagationStats = new FloodStats();

/**
 * Propagates light within a chunk and into/from its neighbors with a flood
 * fill. Neighbor light is copied the first time something is written into it;
 * the copies that were written are returned for the caller to merge.
 *
 * Only the six face neighbors take part: a cell two chunks away diagonally is
 * not loaded as far as this flood is concerned.
 */
export function propagateChunkLight(
  centerChunk: Uint8Array,
  centerLight: Uint8Array,
  neighbors: {
    [key: string]: Uint8Array; // key is "dx,dy,dz" e.g. "1,0,0"
  },
  neighborLights: {
    [key: string]: Uint8Array;
  },
  queue: ArrayLike<number>,
): {
  centerLight: Uint8Array;
  neighborLightUpdates: { [key: string]: Uint8Array };
} {
  const cluster = propagationCluster;
  const floodQueue = propagationQueue;

  startWorkerSection("bindNeighborSlots");
  cluster.reset(NO_CHUNKS_SOURCE);
  floodQueue.clear();
  propagationStats.clear();
  cluster.registerChunk(0, 0, 0, centerChunk, centerLight, false);
  let neighborChunksLoaded = 0;
  let neighborLightsLoaded = 0;
  for (let direction = 0; direction < DIRECTION_COUNT; direction++) {
    const blocks = neighbors[NEIGHBOR_KEYS[direction]] || undefined;
    const light = neighborLights[NEIGHBOR_KEYS[direction]] || undefined;
    if (blocks) neighborChunksLoaded++;
    if (light) neighborLightsLoaded++;
    if (!blocks || !light) continue;
    cluster.registerChunk(
      DIRECTION_OFFSET_X[direction],
      DIRECTION_OFFSET_Y[direction],
      DIRECTION_OFFSET_Z[direction],
      blocks,
      light,
      true,
    );
  }
  endWorkerSection();

  startWorkerSection("seedFromQueue");
  addWorkerCounter("seedQueueLength", queue.length);
  addWorkerCounter("seedQueueBytes", queue.length * BYTES_PER_WORD);
  for (let position = 0; position < queue.length; position++) {
    floodQueue.push(queue[position]);
  }
  endWorkerSection();

  // Pull in what each neighbor holds just beyond the center chunk's boundary cells.
  startWorkerSection(
    "seedFromNeighborBorders",
    DIMENSIONS.lightKind,
    LIGHT_STAGE_BORDER_EXCHANGE,
  );
  let borderCellsExamined = 0;
  let borderCellsSeeded = 0;
  let borderCellsOpaque = 0;
  let borderSkyCellsRaised = 0;
  let borderBlockCellsRaised = 0;
  for (let direction = 0; direction < DIRECTION_COUNT; direction++) {
    const neighborSlot = cluster.neighborSlot(CENTER_SLOT, direction);
    if (neighborSlot === NO_CHUNK) continue;
    startWorkerSection("seedFromFace");
    const examinedBeforeFace = borderCellsExamined;
    const seededBeforeFace = borderCellsSeeded;
    const neighborLight = cluster.lightBySlot[neighborSlot];
    const centerIndices = FACE_CENTER_INDICES[direction];
    const neighborIndices = FACE_NEIGHBOR_INDICES[direction];
    const isFromAbove = direction === POSITIVE_Y;
    for (let position = 0; position < centerIndices.length; position++) {
      const index = centerIndices[position];
      if (IS_TRANSPARENT[centerChunk[index]] === 0) {
        borderCellsOpaque++;
        continue;
      }
      borderCellsExamined++;

      const neighborValue = neighborLight[neighborIndices[position]];
      if (neighborValue === 0) continue;
      const neighborSky = neighborValue >> 4;
      const neighborBlock = neighborValue & 0xf;

      // Horizontal and upward spread always decays; full sky light falls from above undimmed.
      const newSky =
        isFromAbove && neighborSky === MAX_LIGHT
          ? MAX_LIGHT
          : neighborSky > 0
            ? neighborSky - 1
            : 0;
      const newBlock = neighborBlock > 0 ? neighborBlock - 1 : 0;

      const current = centerLight[index];
      const currentSky = current >> 4;
      const currentBlock = current & 0xf;
      if (newSky > currentSky || newBlock > currentBlock) {
        if (newSky > currentSky) borderSkyCellsRaised++;
        if (newBlock > currentBlock) borderBlockCellsRaised++;
        centerLight[index] =
          (Math.max(newSky, currentSky) << 4) |
          Math.max(newBlock, currentBlock);
        borderCellsSeeded++;
        floodQueue.push(index);
      }
    }
    endWorkerSection();
    addWorkerCounter(BORDER_EXAMINED_COUNTER_NAMES[direction], borderCellsExamined - examinedBeforeFace);
    addWorkerCounter(BORDER_SEEDED_COUNTER_NAMES[direction], borderCellsSeeded - seededBeforeFace);
  }
  endWorkerSection();

  const cellsQueuedBeforeFlood = floodQueue.length;
  startWorkerSection("bfsFlood", DIMENSIONS.lightKind, LIGHT_STAGE_FLOOD);
  spreadLight(cluster, floodQueue, propagationStats);
  endWorkerSection();

  startWorkerSection(
    "buildNeighborUpdates",
    DIMENSIONS.lightKind,
    LIGHT_STAGE_NEIGHBOR_UPDATES,
  );
  const neighborUpdates: { [key: string]: Uint8Array } = {};
  for (let direction = 0; direction < DIRECTION_COUNT; direction++) {
    const neighborSlot = cluster.neighborSlot(CENTER_SLOT, direction);
    if (neighborSlot !== NO_CHUNK && cluster.copyLightOnWrite[neighborSlot] === 0) {
      neighborUpdates[NEIGHBOR_KEYS[direction]] = cluster.lightBySlot[neighborSlot];
    }
  }
  const neighborBordersUpdated = Object.keys(neighborUpdates).length;
  endWorkerSection();
  cluster.reset(NO_CHUNKS_SOURCE);

  const { cellsVisited, cellsLit, deadCellsSkipped } = propagationStats;
  addWorkerCounter("bfsNodesVisited", cellsVisited);
  addWorkerCounter("bfsNodesQueuedBySeeding", cellsQueuedBeforeFlood);
  addWorkerCounter("bfsDeadNodesSkipped", deadCellsSkipped);
  addWorkerCounter("lightValuesChanged", cellsLit);
  addWorkerCounter("neighborChunksLoaded", neighborChunksLoaded);
  addWorkerCounter("neighborLightsLoaded", neighborLightsLoaded);
  addWorkerCounter("borderCellsExamined", borderCellsExamined);
  addWorkerCounter("borderCellsSeeded", borderCellsSeeded);
  addWorkerCounter("borderCellsOpaque", borderCellsOpaque);
  addWorkerCounter("centerLightBytesReturned", centerLight.byteLength);
  addWorkerCounter("neighborBordersUpdated", neighborBordersUpdated);
  addWorkerCounter(
    "neighborLightBytesReturned",
    neighborBordersUpdated * CELLS_PER_CHUNK,
  );
  if (isWorkerProfiling()) {
    addWorkerKeyedUnits(
      DIMENSIONS.lightKind,
      LIGHT_STAGE_BORDER_EXCHANGE,
      borderCellsSeeded,
    );
    addWorkerKeyedUnits(DIMENSIONS.lightChannel, LIGHT_CHANNEL_SKY, borderSkyCellsRaised);
    addWorkerKeyedUnits(DIMENSIONS.lightChannel, LIGHT_CHANNEL_BLOCK, borderBlockCellsRaised);
    addWorkerKeyedUnits(DIMENSIONS.lightKind, LIGHT_STAGE_FLOOD, cellsVisited);
    addWorkerKeyedUnits(
      DIMENSIONS.lightKind,
      LIGHT_STAGE_NEIGHBOR_UPDATES,
      neighborBordersUpdated,
    );
  }

  return { centerLight, neighborLightUpdates: neighborUpdates };
}
