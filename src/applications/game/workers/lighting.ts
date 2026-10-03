import {
  BlockType,
  TRANSPARENT_BLOCKS,
  getBlockLightLevel,
} from "@/applications/game/blocks";
import {
  CHUNK_HEIGHT,
  CHUNK_LENGTH,
  CHUNK_WIDTH,
} from "@/applications/game/config";
import { createSurfaceHeightSampler } from "./generation";
import {
  addWorkerCounter,
  endWorkerSection,
  startWorkerSection,
} from "../profiler/worker-recorder";

const CHUNK_SHIFT = 5;
const CHUNK_MASK = (1 << CHUNK_SHIFT) - 1;
if (
  CHUNK_WIDTH !== 1 << CHUNK_SHIFT ||
  CHUNK_HEIGHT !== 1 << CHUNK_SHIFT ||
  CHUNK_LENGTH !== 1 << CHUNK_SHIFT
) {
  throw new Error("lighting assumes 32 x 32 x 32 chunks");
}
const BLOCKS_PER_CHUNK = CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH;

const getIndex = (x: number, y: number, z: number) =>
  (x << (CHUNK_SHIFT * 2)) | (y << CHUNK_SHIFT) | z;

const IS_TRANSPARENT = new Uint8Array(256);
const EMISSION = new Uint8Array(256);
for (let block = 0; block < 256; block++) {
  IS_TRANSPARENT[block] = TRANSPARENT_BLOCKS.includes(block) ? 1 : 0;
  EMISSION[block] = getBlockLightLevel(block);
}

const MAX_LIGHT = 15;

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

/**
 * Initializes the light map for a newly generated chunk.
 * Calculates initial sunlight (vertical raycast) and block light sources.
 */
export function initializeChunkLight(
  chunk: Uint8Array,
  seed: number,
  chunkX: number,
  chunkY: number,
  chunkZ: number,
  topChunk?: Uint8Array,
  topChunkLight?: Uint8Array,
): InitializedChunkLight {
  const light = new Uint8Array(BLOCKS_PER_CHUNK);
  const hasTopInformation = Boolean(topChunk || topChunkLight);
  let lookUpSurfaceHeight: ((x: number, z: number) => number) | undefined;
  let columnsExposed = 0;

  // 1. Sunlight Initialization (Vertical Raycast)
  // We assume sunlight comes from the top.
  startWorkerSection("sunlightColumns");
  for (let x = 0; x < CHUNK_WIDTH; x++) {
    for (let z = 0; z < CHUNK_LENGTH; z++) {
      let isExposed = true;

      if (topChunkLight) {
        // If we have light info from above, use it: the bottom-most layer of the top chunk.
        if (topChunkLight[getIndex(x, 0, z)] >> 4 < MAX_LIGHT)
          isExposed = false;
      } else if (topChunk) {
        for (let ty = 0; ty < CHUNK_HEIGHT; ty++) {
          if (!IS_TRANSPARENT[topChunk[getIndex(x, ty, z)]]) {
            isExposed = false;
            break;
          }
        }
      }

      // Without anything from above, the terrain noise decides how high the ground is.
      let surfaceY = -Infinity;
      if (!hasTopInformation) {
        lookUpSurfaceHeight ??= createSurfaceHeightSampler(seed);
        surfaceY = lookUpSurfaceHeight(
          chunkX * CHUNK_WIDTH + x,
          chunkZ * CHUNK_LENGTH + z,
        );
      }

      for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
        if (!hasTopInformation && chunkY * CHUNK_HEIGHT + y <= surfaceY) {
          isExposed = false;
        }
        const index = getIndex(x, y, z);
        if (IS_TRANSPARENT[chunk[index]]) {
          if (isExposed) {
            light[index] = MAX_LIGHT << 4;
            columnsExposed++;
          }
        } else {
          isExposed = false;
        }
      }
    }
  }
  endWorkerSection();

  // 2. Block Light Sources
  startWorkerSection("blockLightScan");
  const queue: number[] = [];
  let lightSourcesFound = 0;
  for (let i = 0; i < BLOCKS_PER_CHUNK; i++) {
    const emission = EMISSION[chunk[i]];
    if (emission > 0) {
      light[i] = (light[i] & 0xf0) | emission;
      queue.push(i);
      lightSourcesFound++;
    }
  }
  endWorkerSection();

  // 3. Queue only the sky-lit cells that can still brighten something.
  startWorkerSection("frontierQueue");
  let isFullySunlit = lightSourcesFound === 0;
  for (let x = 0; x < CHUNK_WIDTH; x++) {
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_LENGTH; z++) {
        const index = getIndex(x, y, z);
        if (!IS_TRANSPARENT[chunk[index]]) continue;
        if (light[index] >> 4 !== MAX_LIGHT) {
          isFullySunlit = false;
          continue;
        }
        if (isSkyFrontierCell(chunk, light, x, y, z)) queue.push(index);
      }
    }
  }
  endWorkerSection();

  addWorkerCounter("columnsExposed", columnsExposed);
  addWorkerCounter("lightSourcesFound", lightSourcesFound);
  addWorkerCounter("queueLength", queue.length);
  if (isFullySunlit) addWorkerCounter("fullySunlitChunks", 1);

  return { light, queue: Uint32Array.from(queue), isFullySunlit };
}

const X_STRIDE = 1 << (CHUNK_SHIFT * 2);
const Y_STRIDE = 1 << CHUNK_SHIFT;

/** True when the open cell at index is below the sky light a cell next to it could pass on. */
function isDimmerThan(
  chunk: Uint8Array,
  light: Uint8Array,
  index: number,
  reachableSky: number,
): boolean {
  return IS_TRANSPARENT[chunk[index]] === 1 && light[index] >> 4 < reachableSky;
}

/**
 * A full sky light cell matters to the flood fill only if it touches a cell it
 * could brighten, or the edge of the chunk (where the neighbor is unknown).
 * Light never needs to go up from it: the cell above a sky-lit cell is sky-lit too.
 */
function isSkyFrontierCell(
  chunk: Uint8Array,
  light: Uint8Array,
  x: number,
  y: number,
  z: number,
): boolean {
  if (
    x === 0 ||
    x === CHUNK_WIDTH - 1 ||
    z === 0 ||
    z === CHUNK_LENGTH - 1 ||
    y === 0
  ) {
    return true;
  }
  const index = getIndex(x, y, z);
  // Sideways light reaches 14, falling light keeps 15.
  return (
    isDimmerThan(chunk, light, index + X_STRIDE, MAX_LIGHT - 1) ||
    isDimmerThan(chunk, light, index - X_STRIDE, MAX_LIGHT - 1) ||
    isDimmerThan(chunk, light, index + 1, MAX_LIGHT - 1) ||
    isDimmerThan(chunk, light, index - 1, MAX_LIGHT - 1) ||
    isDimmerThan(chunk, light, index - Y_STRIDE, MAX_LIGHT)
  );
}

// Where a cell that left the chunk by at most one axis lives. Slot 0 is the chunk itself.
const SLOT_CENTER = 0;
const SLOT_NEGATIVE_X = 1;
const SLOT_POSITIVE_X = 2;
const SLOT_POSITIVE_Y = 3;
const SLOT_NEGATIVE_Y = 4;
const SLOT_POSITIVE_Z = 5;
const SLOT_NEGATIVE_Z = 6;
const SLOT_COUNT = 7;
const NOT_LOADED = -1;

const SLOT_KEYS = ["", "-1,0,0", "1,0,0", "0,1,0", "0,-1,0", "0,0,1", "0,0,-1"];

/** Slot holding the cell, or NOT_LOADED for cells beyond the six face neighbors. */
function slotOf(x: number, y: number, z: number): number {
  const outsideX = x < 0 ? -1 : x >= CHUNK_WIDTH ? 1 : 0;
  const outsideY = y < 0 ? -1 : y >= CHUNK_HEIGHT ? 1 : 0;
  const outsideZ = z < 0 ? -1 : z >= CHUNK_LENGTH ? 1 : 0;
  const outsideAxes =
    (outsideX !== 0 ? 1 : 0) +
    (outsideY !== 0 ? 1 : 0) +
    (outsideZ !== 0 ? 1 : 0);
  if (outsideAxes === 0) return SLOT_CENTER;
  if (outsideAxes > 1) return NOT_LOADED;
  if (outsideX !== 0) return outsideX < 0 ? SLOT_NEGATIVE_X : SLOT_POSITIVE_X;
  if (outsideY !== 0) return outsideY < 0 ? SLOT_NEGATIVE_Y : SLOT_POSITIVE_Y;
  return outsideZ < 0 ? SLOT_NEGATIVE_Z : SLOT_POSITIVE_Z;
}

const DIRECTION_X = [1, -1, 0, 0, 0, 0];
const DIRECTION_Y = [0, 0, 1, -1, 0, 0];
const DIRECTION_Z = [0, 0, 0, 0, 1, -1];

// For each face slot: the chunk's own boundary cells and the matching cells of the neighbor beyond.
const FACE_CENTER_INDICES: Int32Array[] = [];
const FACE_NEIGHBOR_INDICES: Int32Array[] = [];
(function buildFaceTables() {
  const last = CHUNK_WIDTH - 1;
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const centerIndices = new Int32Array(CHUNK_WIDTH * CHUNK_HEIGHT);
    const neighborIndices = new Int32Array(CHUNK_WIDTH * CHUNK_HEIGHT);
    for (let first = 0; first < CHUNK_WIDTH; first++) {
      for (let second = 0; second < CHUNK_HEIGHT; second++) {
        const position = first * CHUNK_HEIGHT + second;
        switch (slot) {
          case SLOT_NEGATIVE_X:
            centerIndices[position] = getIndex(0, first, second);
            neighborIndices[position] = getIndex(last, first, second);
            break;
          case SLOT_POSITIVE_X:
            centerIndices[position] = getIndex(last, first, second);
            neighborIndices[position] = getIndex(0, first, second);
            break;
          case SLOT_NEGATIVE_Y:
            centerIndices[position] = getIndex(first, 0, second);
            neighborIndices[position] = getIndex(first, last, second);
            break;
          case SLOT_POSITIVE_Y:
            centerIndices[position] = getIndex(first, last, second);
            neighborIndices[position] = getIndex(first, 0, second);
            break;
          case SLOT_NEGATIVE_Z:
            centerIndices[position] = getIndex(first, second, 0);
            neighborIndices[position] = getIndex(first, second, last);
            break;
          case SLOT_POSITIVE_Z:
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

/**
 * Propagates light within a chunk and into/from its neighbors.
 * This is a BFS flood fill.
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
  const blocksBySlot: (Uint8Array | undefined)[] = new Array(SLOT_COUNT);
  const lightBySlot: (Uint8Array | undefined)[] = new Array(SLOT_COUNT);
  const isClonedBySlot: boolean[] = new Array(SLOT_COUNT).fill(false);
  blocksBySlot[SLOT_CENTER] = centerChunk;
  lightBySlot[SLOT_CENTER] = centerLight;
  for (let slot = 1; slot < SLOT_COUNT; slot++) {
    blocksBySlot[slot] = neighbors[SLOT_KEYS[slot]] || undefined;
    lightBySlot[slot] = neighborLights[SLOT_KEYS[slot]] || undefined;
  }

  const readLight = (x: number, y: number, z: number): number => {
    const slot = slotOf(x, y, z);
    const light = slot === NOT_LOADED ? undefined : lightBySlot[slot];
    return light
      ? light[getIndex(x & CHUNK_MASK, y & CHUNK_MASK, z & CHUNK_MASK)]
      : 0;
  };

  // Neighbor light is copied the first time something is written into it.
  const writeLight = (x: number, y: number, z: number, value: number) => {
    const slot = slotOf(x, y, z);
    if (slot === NOT_LOADED) return;
    let light = lightBySlot[slot];
    if (!light) return;
    if (slot !== SLOT_CENTER && !isClonedBySlot[slot]) {
      light = new Uint8Array(light);
      lightBySlot[slot] = light;
      isClonedBySlot[slot] = true;
    }
    light[getIndex(x & CHUNK_MASK, y & CHUNK_MASK, z & CHUNK_MASK)] = value;
  };

  // Cells waiting to spread, three integers each.
  let cells = new Int32Array(3 * 4096);
  let cellCount = 0;
  const pushCell = (x: number, y: number, z: number) => {
    if (cellCount + 3 > cells.length) {
      const grown = new Int32Array(cells.length * 2);
      grown.set(cells);
      cells = grown;
    }
    cells[cellCount++] = x;
    cells[cellCount++] = y;
    cells[cellCount++] = z;
  };

  startWorkerSection("seedFromQueue");
  for (let position = 0; position < queue.length; position++) {
    const index = queue[position];
    pushCell(
      index >> (CHUNK_SHIFT * 2),
      (index >> CHUNK_SHIFT) & CHUNK_MASK,
      index & CHUNK_MASK,
    );
  }
  endWorkerSection();

  // Seed queue with light from neighbors: for each boundary cell of the center
  // chunk, pull in what the neighbor beyond it holds.
  startWorkerSection("seedFromNeighborBorders");
  const seedFromFace = (slot: number, isFromAbove: boolean) => {
    const neighborLight = lightBySlot[slot];
    if (!blocksBySlot[slot] || !neighborLight) return;
    const centerIndices = FACE_CENTER_INDICES[slot];
    const neighborIndices = FACE_NEIGHBOR_INDICES[slot];
    for (let position = 0; position < centerIndices.length; position++) {
      const index = centerIndices[position];
      if (!IS_TRANSPARENT[centerChunk[index]]) continue;

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
        centerLight[index] =
          (Math.max(newSky, currentSky) << 4) |
          Math.max(newBlock, currentBlock);
        pushCell(
          index >> (CHUNK_SHIFT * 2),
          (index >> CHUNK_SHIFT) & CHUNK_MASK,
          index & CHUNK_MASK,
        );
      }
    }
  };
  seedFromFace(SLOT_NEGATIVE_X, false);
  seedFromFace(SLOT_POSITIVE_X, false);
  seedFromFace(SLOT_NEGATIVE_Y, false);
  seedFromFace(SLOT_POSITIVE_Y, true);
  seedFromFace(SLOT_NEGATIVE_Z, false);
  seedFromFace(SLOT_POSITIVE_Z, false);
  endWorkerSection();

  startWorkerSection("bfsFlood");
  let lightValuesChanged = 0;
  let head = 0;
  while (head < cellCount) {
    const x = cells[head++];
    const y = cells[head++];
    const z = cells[head++];

    const currentLight = readLight(x, y, z);
    const sky = currentLight >> 4;
    const block = currentLight & 0xf;
    if (sky === 0 && block === 0) continue;

    for (let direction = 0; direction < 6; direction++) {
      const nx = x + DIRECTION_X[direction];
      const ny = y + DIRECTION_Y[direction];
      const nz = z + DIRECTION_Z[direction];

      const slot = slotOf(nx, ny, nz);
      if (slot === NOT_LOADED) continue;
      if (slot !== SLOT_CENTER && !blocksBySlot[slot] && !lightBySlot[slot])
        continue;

      const blocks = blocksBySlot[slot];
      const neighborBlockType = blocks
        ? blocks[getIndex(nx & CHUNK_MASK, ny & CHUNK_MASK, nz & CHUNK_MASK)]
        : BlockType.AIR;
      if (!IS_TRANSPARENT[neighborBlockType]) continue;

      const neighborLightValue = readLight(nx, ny, nz);
      const neighborSky = neighborLightValue >> 4;
      const neighborBlockLight = neighborLightValue & 0xf;

      let newSky = neighborSky;
      let newBlockLight = neighborBlockLight;
      let changed = false;

      // Vertical propagation of full sky light downwards
      const targetSky =
        DIRECTION_Y[direction] === -1 && sky === MAX_LIGHT
          ? MAX_LIGHT
          : sky - 1;
      if (targetSky > neighborSky) {
        newSky = targetSky;
        changed = true;
      }
      if (block - 1 > neighborBlockLight) {
        newBlockLight = block - 1;
        changed = true;
      }

      if (changed) {
        writeLight(nx, ny, nz, (newSky << 4) | newBlockLight);
        pushCell(nx, ny, nz);
        lightValuesChanged++;
      }
    }
  }
  endWorkerSection();

  const neighborUpdates: { [key: string]: Uint8Array } = {};
  for (let slot = 1; slot < SLOT_COUNT; slot++) {
    if (isClonedBySlot[slot])
      neighborUpdates[SLOT_KEYS[slot]] = lightBySlot[slot]!;
  }

  addWorkerCounter("bfsNodesVisited", head / 3);
  addWorkerCounter("lightValuesChanged", lightValuesChanged);
  addWorkerCounter(
    "neighborBordersUpdated",
    Object.keys(neighborUpdates).length,
  );

  return { centerLight, neighborLightUpdates: neighborUpdates };
}
