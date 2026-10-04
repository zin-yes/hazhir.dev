import { BlockType } from "../blocks";
import {
  addWorkerCounter,
  endWorkerSection,
  startWorkerSection,
} from "../profiler/worker-recorder";
import {
  BlockEditBatch,
  type BlockEdit,
  type ReplaceRule,
} from "./block-edit-batch";
import { CellQueue } from "./cell-queue";
import {
  BOUNDARY_FACES,
  CELL_INDEX_BITS,
  CELL_INDEX_MASK,
  CHUNK_MASK,
  CHUNK_SHIFT,
  ChunkCluster,
  DIRECTION_COUNT,
  NO_CHUNK,
  POSITIVE_Y,
  type ChunkCoordinate,
  type LightChunkSource,
  NO_CHUNKS_SOURCE,
} from "./chunk-cluster";
import {
  FloodStats,
  removeLight,
  spreadLight,
  stepAcrossFaces,
  stepTarget,
} from "./light-flood";
import { EMISSION, IS_TRANSPARENT, MAX_LIGHT } from "./light-tables";

/**
 * Bulk block edits with one batched light update.
 *
 * Light is two flood-fill closures stored per cell (sky << 4 | block). A batch
 * of edits is applied in three moves, whatever its size:
 *   1. write every block, remembering what each cell used to be;
 *   2. for each cell whose opacity or glow changed, zero the light that flowed
 *      through or from it and let that removal wave eat everything that
 *      depended on it, all waves sharing one queue per channel;
 *   3. refill: flood from the lit cells left around the holes and from new
 *      glowing blocks, once, so each cell is brightened as often as the
 *      brightness of its best source changes, not once per edit.
 * The result is the light a from-scratch flood of the final world would give.
 *
 * Above a chunk with no loaded chunk over it the sky is assumed open, which is
 * the rule initial lighting uses for the top of a column too.
 */

export interface BlockChangeLog {
  count: number;
  x: Int32Array;
  y: Int32Array;
  z: Int32Array;
  oldBlock: Uint8Array;
  newBlock: Uint8Array;
}

export interface BulkEditStats {
  editsRequested: number;
  blocksChanged: number;
  editsInUnloadedChunks: number;
  editsSkippedByReplaceRule: number;
  chunksTouched: number;
  cellsRemoved: number;
  cellsLit: number;
  cellsVisited: number;
  millisecondsWritingBlocks: number;
  millisecondsRemovingLight: number;
  millisecondsRefillingLight: number;
  millisecondsCollecting: number;
}

export interface BulkEditResult {
  /** Chunks whose block or light data was written to. */
  changedChunks: ChunkCoordinate[];
  /**
   * The chunks whose mesh must be rebuilt, nearest to the edit first: each
   * chunk with a changed block or light value, plus the neighbor across any
   * face where a border layer cell changed (meshes read that layer as their
   * border). Only chunks that are loaded and lit are listed.
   */
  chunksToRemesh: ChunkCoordinate[];
  /** Every block that changed, in world coordinates. */
  changes: BlockChangeLog;
  stats: BulkEditStats;
}

export interface BulkEditOptions {
  /** Build the per-block change log. Defaults to true. */
  recordChanges?: boolean;
}

interface EditSession {
  cluster: ChunkCluster;
  skyRemovalQueue: CellQueue;
  blockRemovalQueue: CellQueue;
  refillQueue: CellQueue;
  restoredEmitterQueue: CellQueue;
  floodStats: FloodStats;
  changeCells: Uint32Array;
  changeOldBlocks: Uint8Array;
  changeCount: number;
  editedSlots: number[];
  removalMilliseconds: number;
  refillMilliseconds: number;
}

const INITIAL_CHANGE_CAPACITY = 4096;

const session: EditSession = {
  cluster: new ChunkCluster(),
  skyRemovalQueue: new CellQueue(),
  blockRemovalQueue: new CellQueue(),
  refillQueue: new CellQueue(),
  restoredEmitterQueue: new CellQueue(),
  floodStats: new FloodStats(),
  changeCells: new Uint32Array(INITIAL_CHANGE_CAPACITY),
  changeOldBlocks: new Uint8Array(INITIAL_CHANGE_CAPACITY),
  changeCount: 0,
  editedSlots: [],
  removalMilliseconds: 0,
  refillMilliseconds: 0,
};

function beginSession(source: LightChunkSource) {
  session.cluster.reset(source);
  session.skyRemovalQueue.clear();
  session.blockRemovalQueue.clear();
  session.refillQueue.clear();
  session.restoredEmitterQueue.clear();
  session.floodStats.clear();
  session.changeCount = 0;
  session.editedSlots.length = 0;
  session.removalMilliseconds = 0;
  session.refillMilliseconds = 0;
}

function endSession() {
  session.cluster.reset(NO_CHUNKS_SOURCE);
}

function recordChange(cell: number, oldBlock: number) {
  if (session.changeCount === session.changeCells.length) {
    const grownCells = new Uint32Array(session.changeCells.length * 2);
    grownCells.set(session.changeCells);
    session.changeCells = grownCells;
    const grownBlocks = new Uint8Array(session.changeOldBlocks.length * 2);
    grownBlocks.set(session.changeOldBlocks);
    session.changeOldBlocks = grownBlocks;
  }
  session.changeCells[session.changeCount] = cell;
  session.changeOldBlocks[session.changeCount] = oldBlock;
  session.changeCount++;
}

function markCellChanged(slot: number, index: number) {
  const cluster = session.cluster;
  if (cluster.contentChanged[slot] === 0) session.editedSlots.push(slot);
  cluster.contentChanged[slot] = 1;
  cluster.faceChanged[slot] |= BOUNDARY_FACES[index];
}

function allowsReplacing(rule: ReplaceRule, oldBlock: number): boolean {
  if (rule === "any") return true;
  return rule === "airOnly"
    ? oldBlock === BlockType.AIR
    : oldBlock !== BlockType.AIR;
}

function isOpenSkyAbove(slot: number): boolean {
  return session.cluster.neighborSlot(slot, POSITIVE_Y) === NO_CHUNK;
}

/** Queues the lit cells around a cell that now lets light through, so their light flows into it. */
function queueLitNeighbors(slot: number, index: number) {
  const cluster = session.cluster;
  for (let direction = 0; direction < DIRECTION_COUNT; direction++) {
    const neighborIndex = stepAcrossFaces(cluster, slot, index, direction);
    if (neighborIndex < 0) continue;
    const neighborSlot = stepTarget.slot;
    if (cluster.lightBySlot[neighborSlot][neighborIndex] !== 0) {
      session.refillQueue.push(
        (neighborSlot << CELL_INDEX_BITS) | neighborIndex,
      );
    }
  }
}

/**
 * Brings light in line with the blocks already written, for every recorded
 * change: removal waves first, then one refill flood.
 */
function relightRecordedChanges() {
  const { cluster, refillQueue, skyRemovalQueue, blockRemovalQueue } = session;
  const blocksBySlot = cluster.blocksBySlot;
  const lightBySlot = cluster.lightBySlot;

  startWorkerSection("seedLightChanges");
  for (let record = 0; record < session.changeCount; record++) {
    const cell = session.changeCells[record];
    const slot = cell >>> CELL_INDEX_BITS;
    if (cluster.isLitBySlot[slot] === 0) continue;
    const index = cell & CELL_INDEX_MASK;
    const oldBlock = session.changeOldBlocks[record];
    const newBlock = blocksBySlot[slot][index];
    const wasTransparent = IS_TRANSPARENT[oldBlock];
    const isTransparent = IS_TRANSPARENT[newBlock];
    const newEmission = EMISSION[newBlock];
    if (wasTransparent === isTransparent && EMISSION[oldBlock] === newEmission) {
      continue;
    }

    const light = lightBySlot[slot];
    const initialValue = light[index];
    let value = initialValue;

    if (wasTransparent === 1 && isTransparent === 0 && value >> 4 > 0) {
      skyRemovalQueue.push(cell, value >> 4);
      value &= 0x0f;
    }
    const previousBlockLight = value & 0xf;
    if (previousBlockLight > newEmission) {
      blockRemovalQueue.push(cell, previousBlockLight);
      value &= 0xf0;
    }
    if (newEmission > (value & 0xf)) {
      value = (value & 0xf0) | newEmission;
      refillQueue.push(cell);
    }
    if (isTransparent === 1) {
      const isTopLayer = ((index >> CHUNK_SHIFT) & CHUNK_MASK) === CHUNK_MASK;
      if (wasTransparent === 0 && isTopLayer && isOpenSkyAbove(slot)) {
        value = (MAX_LIGHT << 4) | (value & 0xf);
        refillQueue.push(cell);
      }
      queueLitNeighbors(slot, index);
    }
    if (value !== initialValue) {
      light[index] = value;
      markCellChanged(slot, index);
    }
  }
  endWorkerSection();

  const removalStartedAtMs = performance.now();
  startWorkerSection("removeLight");
  removeLight(
    cluster,
    skyRemovalQueue,
    true,
    refillQueue,
    session.restoredEmitterQueue,
    session.floodStats,
  );
  removeLight(
    cluster,
    blockRemovalQueue,
    false,
    refillQueue,
    session.restoredEmitterQueue,
    session.floodStats,
  );
  while (session.restoredEmitterQueue.length > 0) {
    const cell = session.restoredEmitterQueue.shift();
    const slot = cell >>> CELL_INDEX_BITS;
    const index = cell & CELL_INDEX_MASK;
    const light = lightBySlot[slot];
    light[index] =
      (light[index] & 0xf0) | EMISSION[blocksBySlot[slot][index]];
    refillQueue.push(cell);
  }
  endWorkerSection();
  session.removalMilliseconds = performance.now() - removalStartedAtMs;

  const refillStartedAtMs = performance.now();
  startWorkerSection("refillLight");
  spreadLight(cluster, refillQueue, session.floodStats);
  endWorkerSection();
  session.refillMilliseconds = performance.now() - refillStartedAtMs;
}

interface CollectedChunks {
  changedChunks: ChunkCoordinate[];
  chunksToRemesh: ChunkCoordinate[];
}

function collectChangedChunks(): CollectedChunks {
  const cluster = session.cluster;
  const changedSlots: number[] = [];
  const slotCountBeforeCollecting = cluster.slotCount;

  // Looking up neighbors can add slots, so resolve them all before sizing the flags.
  for (let slot = 0; slot < slotCountBeforeCollecting; slot++) {
    if (cluster.contentChanged[slot] === 0) continue;
    changedSlots.push(slot);
    const faces = cluster.faceChanged[slot];
    for (let direction = 0; direction < DIRECTION_COUNT; direction++) {
      if ((faces & (1 << direction)) !== 0) cluster.neighborSlot(slot, direction);
    }
  }

  const remeshFlags = new Uint8Array(cluster.slotCount);
  for (const slot of changedSlots) {
    if (cluster.isLitBySlot[slot] === 0) continue;
    remeshFlags[slot] = 1;
    const faces = cluster.faceChanged[slot];
    for (let direction = 0; direction < DIRECTION_COUNT; direction++) {
      if ((faces & (1 << direction)) === 0) continue;
      const neighbor = cluster.neighborSlot(slot, direction);
      if (neighbor !== NO_CHUNK) remeshFlags[neighbor] = 1;
    }
  }
  const remeshSlots: number[] = [];
  for (let slot = 0; slot < remeshFlags.length; slot++) {
    if (remeshFlags[slot] === 1) remeshSlots.push(slot);
  }

  const coordinateOf = (slot: number): ChunkCoordinate => ({
    x: cluster.chunkXBySlot[slot],
    y: cluster.chunkYBySlot[slot],
    z: cluster.chunkZBySlot[slot],
  });
  return {
    changedChunks: changedSlots.map(coordinateOf),
    chunksToRemesh: sortNearestFirst(
      remeshSlots.map(coordinateOf),
      session.editedSlots.map(coordinateOf),
    ),
  };
}

function sortNearestFirst(
  chunks: ChunkCoordinate[],
  editedChunks: ChunkCoordinate[],
): ChunkCoordinate[] {
  if (chunks.length < 2 || editedChunks.length === 0) return chunks;
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  for (const edited of editedChunks) {
    sumX += edited.x;
    sumY += edited.y;
    sumZ += edited.z;
  }
  const focusX = sumX / editedChunks.length;
  const focusY = sumY / editedChunks.length;
  const focusZ = sumZ / editedChunks.length;
  const distance = (chunk: ChunkCoordinate) =>
    (chunk.x - focusX) ** 2 +
    (chunk.y - focusY) ** 2 +
    (chunk.z - focusZ) ** 2;
  return chunks.sort((first, second) => distance(first) - distance(second));
}

function buildChangeLog(): BlockChangeLog {
  const { cluster } = session;
  const count = session.changeCount;
  const log: BlockChangeLog = {
    count,
    x: new Int32Array(count),
    y: new Int32Array(count),
    z: new Int32Array(count),
    oldBlock: session.changeOldBlocks.slice(0, count),
    newBlock: new Uint8Array(count),
  };
  for (let record = 0; record < count; record++) {
    const cell = session.changeCells[record];
    const slot = cell >>> CELL_INDEX_BITS;
    const index = cell & CELL_INDEX_MASK;
    log.x[record] =
      cluster.chunkXBySlot[slot] * (CHUNK_MASK + 1) + (index >> (CHUNK_SHIFT * 2));
    log.y[record] =
      cluster.chunkYBySlot[slot] * (CHUNK_MASK + 1) +
      ((index >> CHUNK_SHIFT) & CHUNK_MASK);
    log.z[record] =
      cluster.chunkZBySlot[slot] * (CHUNK_MASK + 1) + (index & CHUNK_MASK);
    log.newBlock[record] = cluster.blocksBySlot[slot][index];
  }
  return log;
}

function buildStats(
  editsRequested: number,
  editsInUnloadedChunks: number,
  editsSkippedByReplaceRule: number,
  millisecondsWritingBlocks: number,
  millisecondsCollecting: number,
): BulkEditStats {
  const { floodStats, cluster } = session;
  let chunksTouched = 0;
  for (let slot = 0; slot < cluster.slotCount; slot++) {
    if (cluster.contentChanged[slot] === 1) chunksTouched++;
  }
  return {
    editsRequested,
    blocksChanged: session.changeCount,
    editsInUnloadedChunks,
    editsSkippedByReplaceRule,
    chunksTouched,
    cellsRemoved: floodStats.cellsRemoved,
    cellsLit: floodStats.cellsLit,
    cellsVisited: floodStats.cellsVisited,
    millisecondsWritingBlocks,
    millisecondsRemovingLight: session.removalMilliseconds,
    millisecondsRefillingLight: session.refillMilliseconds,
    millisecondsCollecting,
  };
}

function finishSession(
  editsRequested: number,
  editsInUnloadedChunks: number,
  editsSkippedByReplaceRule: number,
  millisecondsWritingBlocks: number,
  shouldRecordChanges: boolean,
): BulkEditResult {
  relightRecordedChanges();

  const collectingStartedAtMs = performance.now();
  startWorkerSection("collectChunks");
  const { changedChunks, chunksToRemesh } = collectChangedChunks();
  const changes = shouldRecordChanges ? buildChangeLog() : emptyChangeLog();
  endWorkerSection();
  const stats = buildStats(
    editsRequested,
    editsInUnloadedChunks,
    editsSkippedByReplaceRule,
    millisecondsWritingBlocks,
    performance.now() - collectingStartedAtMs,
  );
  addWorkerCounter("editsRequested", editsRequested);
  addWorkerCounter("blocksChanged", stats.blocksChanged);
  addWorkerCounter("cellsRemoved", stats.cellsRemoved);
  addWorkerCounter("cellsLit", stats.cellsLit);
  addWorkerCounter("chunksToRemesh", chunksToRemesh.length);
  endSession();
  return { changedChunks, chunksToRemesh, changes, stats };
}

function emptyChangeLog(): BlockChangeLog {
  return {
    count: 0,
    x: new Int32Array(0),
    y: new Int32Array(0),
    z: new Int32Array(0),
    oldBlock: new Uint8Array(0),
    newBlock: new Uint8Array(0),
  };
}

/**
 * Writes a batch of block edits into the loaded chunks and relights once for
 * the whole batch. Chunk block and light arrays are changed in place. Edits in
 * chunks that are not loaded are skipped and counted; unloaded chunks next to
 * the edit are left alone (they light themselves when they load).
 */
export function applyBlockEdits(
  source: LightChunkSource,
  edits: BlockEditBatch | ArrayLike<BlockEdit>,
  options: BulkEditOptions = {},
): BulkEditResult {
  const batch =
    edits instanceof BlockEditBatch ? edits : BlockEditBatch.fromEdits(edits);
  beginSession(source);
  const cluster = session.cluster;
  const writingStartedAtMs = performance.now();

  startWorkerSection("writeBlocks");
  const { xs, ys, zs, blocks: newBlocks, replaceRule } = batch;
  let editsInUnloadedChunks = 0;
  let editsSkippedByReplaceRule = 0;
  let lastChunkX = 0;
  let lastChunkY = 0;
  let lastChunkZ = 0;
  let lastSlot = -1;
  for (let position = 0; position < batch.length; position++) {
    const x = xs[position];
    const y = ys[position];
    const z = zs[position];
    const chunkX = x >> CHUNK_SHIFT;
    const chunkY = y >> CHUNK_SHIFT;
    const chunkZ = z >> CHUNK_SHIFT;
    if (
      lastSlot < 0 ||
      chunkX !== lastChunkX ||
      chunkY !== lastChunkY ||
      chunkZ !== lastChunkZ
    ) {
      lastSlot = cluster.slotForChunk(chunkX, chunkY, chunkZ);
      lastChunkX = chunkX;
      lastChunkY = chunkY;
      lastChunkZ = chunkZ;
    }
    if (cluster.hasBlocksBySlot[lastSlot] === 0) {
      editsInUnloadedChunks++;
      continue;
    }
    const index =
      ((x & CHUNK_MASK) << (CHUNK_SHIFT * 2)) |
      ((y & CHUNK_MASK) << CHUNK_SHIFT) |
      (z & CHUNK_MASK);
    const chunkBlocks = cluster.blocksBySlot[lastSlot];
    const oldBlock = chunkBlocks[index];
    const newBlock = newBlocks[position];
    if (oldBlock === newBlock) continue;
    if (!allowsReplacing(replaceRule, oldBlock)) {
      editsSkippedByReplaceRule++;
      continue;
    }
    chunkBlocks[index] = newBlock;
    markCellChanged(lastSlot, index);
    recordChange((lastSlot << CELL_INDEX_BITS) | index, oldBlock);
  }
  endWorkerSection();

  return finishSession(
    batch.length,
    editsInUnloadedChunks,
    editsSkippedByReplaceRule,
    performance.now() - writingStartedAtMs,
    options.recordChanges !== false,
  );
}

/**
 * Relights after blocks that the caller has already written, given what each
 * block was before. Use it when block writes are done elsewhere (a single
 * edit, water simulation); applyBlockEdits does the writing itself.
 */
export function relightAfterBlocksWritten(
  source: LightChunkSource,
  changes: ArrayLike<{ x: number; y: number; z: number; oldBlock: number }>,
  options: BulkEditOptions = {},
): BulkEditResult {
  beginSession(source);
  const cluster = session.cluster;
  let editsInUnloadedChunks = 0;
  for (let position = 0; position < changes.length; position++) {
    const { x, y, z, oldBlock } = changes[position];
    const slot = cluster.slotForChunk(
      x >> CHUNK_SHIFT,
      y >> CHUNK_SHIFT,
      z >> CHUNK_SHIFT,
    );
    if (cluster.hasBlocksBySlot[slot] === 0) {
      editsInUnloadedChunks++;
      continue;
    }
    const index =
      ((x & CHUNK_MASK) << (CHUNK_SHIFT * 2)) |
      ((y & CHUNK_MASK) << CHUNK_SHIFT) |
      (z & CHUNK_MASK);
    markCellChanged(slot, index);
    recordChange((slot << CELL_INDEX_BITS) | index, oldBlock);
  }
  return finishSession(
    changes.length,
    editsInUnloadedChunks,
    0,
    0,
    options.recordChanges !== false,
  );
}
