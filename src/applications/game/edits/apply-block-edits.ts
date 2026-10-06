import { BlockType } from "../blocks";
import { profiler } from "../profiler";
import { DIMENSIONS } from "../profiler/dimensions";
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

export type BulkEditPhase =
  | "writeBlocks"
  | "seedLightChanges"
  | "removeSkyLight"
  | "removeBlockLight"
  | "refillLight"
  | "collectChunks";

export interface BulkEditOptions {
  /** Build the per-block change log. Defaults to true. */
  recordChanges?: boolean;
  /** Called as each phase starts and ends, for main-thread profilers. */
  onPhase?: (phase: BulkEditPhase, hasStarted: boolean) => void;
}

/** What the session did besides flooding, counted as plain integers and reported once when the session ends. */
interface EditSessionTally {
  editsAlreadyMatching: number;
  chunkRunSwitches: number;
  seedSkippedChunkNotLit: number;
  seedSkippedLightUnchanged: number;
  seedSkyRemovals: number;
  seedBlockRemovals: number;
  seedEmitterRefills: number;
  seedOpenSkyRefills: number;
  seedLitNeighborsQueued: number;
  changeRecordGrowths: number;
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
  onPhase: BulkEditOptions["onPhase"];
  phaseProfilerToken: number;
  tally: EditSessionTally;
  /** Blocks written per new block id, filled only while the profiler is on. */
  blocksWrittenByType: Uint32Array;
}

const INITIAL_CHANGE_CAPACITY = 4096;
const BLOCK_ID_COUNT = 256;

function emptyTally(): EditSessionTally {
  return {
    editsAlreadyMatching: 0,
    chunkRunSwitches: 0,
    seedSkippedChunkNotLit: 0,
    seedSkippedLightUnchanged: 0,
    seedSkyRemovals: 0,
    seedBlockRemovals: 0,
    seedEmitterRefills: 0,
    seedOpenSkyRefills: 0,
    seedLitNeighborsQueued: 0,
    changeRecordGrowths: 0,
  };
}

function clearTally(tally: EditSessionTally) {
  tally.editsAlreadyMatching = 0;
  tally.chunkRunSwitches = 0;
  tally.seedSkippedChunkNotLit = 0;
  tally.seedSkippedLightUnchanged = 0;
  tally.seedSkyRemovals = 0;
  tally.seedBlockRemovals = 0;
  tally.seedEmitterRefills = 0;
  tally.seedOpenSkyRefills = 0;
  tally.seedLitNeighborsQueued = 0;
  tally.changeRecordGrowths = 0;
}

const BLOCK_TYPE_NAMES: readonly string[] = Array.from(
  { length: BLOCK_ID_COUNT },
  (_, block) => BlockType[block] ?? `BLOCK_${block}`,
);

/**
 * Phases the main thread's light engine already wraps in its own scopes (removeSkyLight, removeBlockLight and
 * refillLight map to main.light.relight.*), so only the others get a scope here.
 */
const PHASE_PROFILER_SCOPES: { [phase in BulkEditPhase]?: string } = {
  writeBlocks: "main.edit.writeBlocks",
  seedLightChanges: "main.edit.seedLightChanges",
  collectChunks: "main.edit.collectChunks",
};

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
  onPhase: undefined,
  phaseProfilerToken: 0,
  tally: emptyTally(),
  blocksWrittenByType: new Uint32Array(BLOCK_ID_COUNT),
};

function beginPhase(phase: BulkEditPhase) {
  startWorkerSection(phase);
  const scopeName = PHASE_PROFILER_SCOPES[phase];
  if (scopeName) session.phaseProfilerToken = profiler.begin(scopeName);
  session.onPhase?.(phase, true);
}

function endPhase(phase: BulkEditPhase) {
  session.onPhase?.(phase, false);
  if (PHASE_PROFILER_SCOPES[phase]) profiler.end(session.phaseProfilerToken);
  endWorkerSection();
}

function beginSession(source: LightChunkSource, options: BulkEditOptions) {
  session.onPhase = options.onPhase;
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
  clearTally(session.tally);
  if (profiler.enabled) session.blocksWrittenByType.fill(0);
}

function endSession() {
  session.onPhase = undefined;
  session.cluster.reset(NO_CHUNKS_SOURCE);
}

function recordChange(cell: number, oldBlock: number) {
  if (session.changeCount === session.changeCells.length) {
    session.tally.changeRecordGrowths++;
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

  beginPhase("seedLightChanges");
  const tally = session.tally;
  for (let record = 0; record < session.changeCount; record++) {
    const cell = session.changeCells[record];
    const slot = cell >>> CELL_INDEX_BITS;
    if (cluster.isLitBySlot[slot] === 0) {
      tally.seedSkippedChunkNotLit++;
      continue;
    }
    const index = cell & CELL_INDEX_MASK;
    const oldBlock = session.changeOldBlocks[record];
    const newBlock = blocksBySlot[slot][index];
    const wasTransparent = IS_TRANSPARENT[oldBlock];
    const isTransparent = IS_TRANSPARENT[newBlock];
    const newEmission = EMISSION[newBlock];
    if (wasTransparent === isTransparent && EMISSION[oldBlock] === newEmission) {
      tally.seedSkippedLightUnchanged++;
      continue;
    }

    const light = lightBySlot[slot];
    const initialValue = light[index];
    let value = initialValue;

    if (wasTransparent === 1 && isTransparent === 0 && value >> 4 > 0) {
      skyRemovalQueue.push(cell, value >> 4);
      value &= 0x0f;
      tally.seedSkyRemovals++;
    }
    const previousBlockLight = value & 0xf;
    if (previousBlockLight > newEmission) {
      blockRemovalQueue.push(cell, previousBlockLight);
      value &= 0xf0;
      tally.seedBlockRemovals++;
    }
    if (newEmission > (value & 0xf)) {
      value = (value & 0xf0) | newEmission;
      refillQueue.push(cell);
      tally.seedEmitterRefills++;
    }
    if (isTransparent === 1) {
      const isTopLayer = ((index >> CHUNK_SHIFT) & CHUNK_MASK) === CHUNK_MASK;
      if (wasTransparent === 0 && isTopLayer && isOpenSkyAbove(slot)) {
        value = (MAX_LIGHT << 4) | (value & 0xf);
        refillQueue.push(cell);
        tally.seedOpenSkyRefills++;
      }
      const refillQueuedBeforeNeighbors = refillQueue.pushedCount;
      queueLitNeighbors(slot, index);
      tally.seedLitNeighborsQueued += refillQueue.pushedCount - refillQueuedBeforeNeighbors;
    }
    if (value !== initialValue) {
      light[index] = value;
      markCellChanged(slot, index);
    }
  }
  endPhase("seedLightChanges");

  const removalStartedAtMs = performance.now();
  beginPhase("removeSkyLight");
  removeLight(
    cluster,
    skyRemovalQueue,
    true,
    refillQueue,
    session.restoredEmitterQueue,
    session.floodStats,
  );
  endPhase("removeSkyLight");
  beginPhase("removeBlockLight");
  removeLight(
    cluster,
    blockRemovalQueue,
    false,
    refillQueue,
    session.restoredEmitterQueue,
    session.floodStats,
  );
  const restoreToken = profiler.begin("main.edit.restoreEmitters");
  while (session.restoredEmitterQueue.length > 0) {
    const cell = session.restoredEmitterQueue.shift();
    const slot = cell >>> CELL_INDEX_BITS;
    const index = cell & CELL_INDEX_MASK;
    const light = lightBySlot[slot];
    light[index] =
      (light[index] & 0xf0) | EMISSION[blocksBySlot[slot][index]];
    refillQueue.push(cell);
  }
  profiler.end(restoreToken);
  endPhase("removeBlockLight");
  session.removalMilliseconds = performance.now() - removalStartedAtMs;

  const refillStartedAtMs = performance.now();
  beginPhase("refillLight");
  spreadLight(cluster, refillQueue, session.floodStats);
  endPhase("refillLight");
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
  const resolveToken = profiler.begin("main.edit.collect.resolveNeighbors");
  for (let slot = 0; slot < slotCountBeforeCollecting; slot++) {
    if (cluster.contentChanged[slot] === 0) continue;
    changedSlots.push(slot);
    const faces = cluster.faceChanged[slot];
    for (let direction = 0; direction < DIRECTION_COUNT; direction++) {
      if ((faces & (1 << direction)) !== 0) cluster.neighborSlot(slot, direction);
    }
  }

  profiler.end(resolveToken);

  const flagToken = profiler.begin("main.edit.collect.flagRemesh");
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
  profiler.end(flagToken);

  const coordinateOf = (slot: number): ChunkCoordinate => ({
    x: cluster.chunkXBySlot[slot],
    y: cluster.chunkYBySlot[slot],
    z: cluster.chunkZBySlot[slot],
  });
  const sortToken = profiler.begin("main.edit.collect.sortNearestFirst");
  const collected = {
    changedChunks: changedSlots.map(coordinateOf),
    chunksToRemesh: sortNearestFirst(
      remeshSlots.map(coordinateOf),
      session.editedSlots.map(coordinateOf),
    ),
  };
  profiler.end(sortToken);
  return collected;
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
  const logToken = profiler.begin("main.edit.collect.buildChangeLog");
  try {
    return writeChangeLog();
  } finally {
    profiler.end(logToken);
  }
}

function writeChangeLog(): BlockChangeLog {
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
  beginPhase("collectChunks");
  const { changedChunks, chunksToRemesh } = collectChangedChunks();
  const changes = shouldRecordChanges ? buildChangeLog() : emptyChangeLog();
  endPhase("collectChunks");
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
  if (profiler.enabled) publishSessionMetrics(stats, changedChunks.length, chunksToRemesh.length, changes);
  endSession();
  return { changedChunks, chunksToRemesh, changes, stats };
}

/** Reports what one edit session did: edit outcomes, seeding, flood work, queue and cluster use, memory. */
function publishSessionMetrics(
  stats: BulkEditStats,
  changedChunkCount: number,
  chunksToRemeshCount: number,
  changes: BlockChangeLog,
) {
  const { floodStats, cluster, tally } = session;
  profiler.addCounter("game.edit.sessions");
  profiler.addCounter("game.edit.editsRequested", stats.editsRequested);
  profiler.addCounter("game.edit.blocksChanged", stats.blocksChanged);
  profiler.addCounter("game.edit.editsInUnloadedChunks", stats.editsInUnloadedChunks);
  profiler.addCounter("game.edit.editsSkippedByReplaceRule", stats.editsSkippedByReplaceRule);
  profiler.addCounter("game.edit.editsAlreadyMatching", tally.editsAlreadyMatching);
  profiler.addCounter("game.edit.chunkRunSwitches", tally.chunkRunSwitches);
  profiler.addCounter("game.edit.chunksMarkedChanged", changedChunkCount);
  profiler.addCounter("game.edit.chunksTouched", stats.chunksTouched);
  profiler.addCounter("game.edit.changeRecordGrowths", tally.changeRecordGrowths);
  profiler.sampleGauge("game.edit.blocksChangedPerSession", stats.blocksChanged);
  profiler.sampleGauge("game.edit.chunksToRemeshPerSession", chunksToRemeshCount);

  profiler.addCounter("game.edit.seed.skippedChunkNotLit", tally.seedSkippedChunkNotLit);
  profiler.addCounter("game.edit.seed.skippedLightUnchanged", tally.seedSkippedLightUnchanged);
  profiler.addCounter("game.edit.seed.skyRemovals", tally.seedSkyRemovals);
  profiler.addCounter("game.edit.seed.blockRemovals", tally.seedBlockRemovals);
  profiler.addCounter("game.edit.seed.emitterRefills", tally.seedEmitterRefills);
  profiler.addCounter("game.edit.seed.openSkyRefills", tally.seedOpenSkyRefills);
  profiler.addCounter("game.edit.seed.litNeighborsQueued", tally.seedLitNeighborsQueued);

  profiler.addCounter("game.edit.light.cellsVisited", floodStats.cellsVisited);
  profiler.addCounter("game.edit.light.cellsLit", floodStats.cellsLit);
  profiler.addCounter("game.edit.light.cellsRemoved", floodStats.cellsRemoved);
  profiler.addCounter("game.edit.light.skyCellsRemoved", floodStats.skyCellsRemoved);
  profiler.addCounter("game.edit.light.blockCellsRemoved", floodStats.blockCellsRemoved);
  profiler.addCounter("game.edit.light.cellsQueuedBySpread", floodStats.cellsQueuedBySpread);
  profiler.addCounter("game.edit.light.cellsQueuedByRemoval", floodStats.cellsQueuedByRemoval);
  profiler.addCounter("game.edit.light.deadCellsSkipped", floodStats.deadCellsSkipped);
  profiler.addCounter("game.edit.light.neighborsExamined", floodStats.neighborsExamined);
  profiler.addCounter("game.edit.light.neighborsOutsideLitChunks", floodStats.neighborsOutsideLitChunks);
  profiler.addCounter("game.edit.light.neighborsOpaque", floodStats.neighborsOpaque);
  profiler.addCounter("game.edit.light.neighborsAlreadyBrightEnough", floodStats.neighborsAlreadyBrightEnough);
  profiler.addCounter("game.edit.light.neighborsKeptForRefill", floodStats.neighborsKeptForRefill);
  profiler.addCounter("game.edit.light.neighborsAlreadyDark", floodStats.neighborsAlreadyDark);
  profiler.addCounter("game.edit.light.chunkBoundaryCrossings", floodStats.chunkBoundaryCrossings);
  profiler.addCounter("game.edit.light.lightArraysDetached", floodStats.lightArraysDetached);
  profiler.addCounter("game.edit.light.emittersRestoredByRemoval", floodStats.emittersRestored);
  profiler.addCounter("game.edit.light.spreadCalls", floodStats.spreadCalls);
  profiler.addCounter("game.edit.light.removeCalls", floodStats.removeCalls);
  profiler.sampleGauge("game.edit.light.cellsVisitedPerChangedBlock", floodStats.cellsVisited / Math.max(1, stats.blocksChanged));
  profiler.recordBreakdown(DIMENSIONS.lightFloodWave, "skyRemoval", { units: floodStats.skyCellsRemoved, calls: 1 });
  profiler.recordBreakdown(DIMENSIONS.lightFloodWave, "blockRemoval", { units: floodStats.blockCellsRemoved, calls: 1 });
  profiler.recordBreakdown(DIMENSIONS.lightFloodWave, "spread", { units: floodStats.cellsLit, calls: 1 });

  const queues = [session.skyRemovalQueue, session.blockRemovalQueue, session.refillQueue, session.restoredEmitterQueue];
  profiler.sampleGauge("game.edit.light.queuePeakSkyRemoval", session.skyRemovalQueue.peakLength);
  profiler.sampleGauge("game.edit.light.queuePeakBlockRemoval", session.blockRemovalQueue.peakLength);
  profiler.sampleGauge("game.edit.light.queuePeakRefill", session.refillQueue.peakLength);
  profiler.sampleGauge("game.edit.light.queuePeakRestoredEmitters", session.restoredEmitterQueue.peakLength);
  let queueGrowths = 0;
  let queueCapacityBytes = 0;
  for (const queue of queues) {
    queueGrowths += queue.growthCount;
    queueCapacityBytes += queue.capacityBytes;
  }
  profiler.addCounter("game.edit.light.queueGrowths", queueGrowths);
  profiler.sampleGauge("memory.edit.lightQueueBytes", queueCapacityBytes, "bytes");

  const clusterStats = cluster.stats;
  profiler.sampleGauge("game.edit.cluster.slots", cluster.slotCount);
  profiler.addCounter("game.edit.cluster.slotLookups", clusterStats.slotLookups);
  profiler.addCounter("game.edit.cluster.slotLookupsFound", clusterStats.slotLookupsFound);
  profiler.addCounter("game.edit.cluster.hashProbeSteps", clusterStats.hashProbeSteps);
  profiler.addCounter("game.edit.cluster.slotsCreated", clusterStats.slotsCreated);
  profiler.addCounter("game.edit.cluster.slotsWithoutBlocks", clusterStats.slotsWithoutBlocks);
  profiler.addCounter("game.edit.cluster.slotsLoadedFromSource", clusterStats.slotsLoadedFromSource);
  profiler.addCounter("game.edit.cluster.neighborResolutions", clusterStats.neighborResolutions);
  profiler.addCounter("game.edit.cluster.neighborResolutionsNotLit", clusterStats.neighborResolutionsNotLit);
  profiler.addCounter("game.edit.cluster.tableGrowths", clusterStats.tableGrowths);
  profiler.addCounter("game.edit.cluster.lightArraysDetached", clusterStats.lightArraysDetached);

  profiler.recordBytes("bytes.edit.changeRecords", session.changeCount * (Uint32Array.BYTES_PER_ELEMENT + 1));
  profiler.recordBytes(
    "bytes.edit.changeLog",
    changes.x.byteLength + changes.y.byteLength + changes.z.byteLength + changes.oldBlock.byteLength + changes.newBlock.byteLength,
  );
  profiler.sampleGauge("memory.edit.changeRecordCapacityBytes", session.changeCells.byteLength + session.changeOldBlocks.byteLength, "bytes");

  for (let block = 0; block < BLOCK_ID_COUNT; block++) {
    const written = session.blocksWrittenByType[block]!;
    if (written > 0) profiler.recordBreakdown(DIMENSIONS.editBlock, BLOCK_TYPE_NAMES[block]!, { units: written, calls: 1 });
  }
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
  profiler.addCounter("game.edit.path.bulk");
  const batch =
    edits instanceof BlockEditBatch ? edits : BlockEditBatch.fromEdits(edits);
  beginSession(source, options);
  const cluster = session.cluster;
  const writingStartedAtMs = performance.now();

  beginPhase("writeBlocks");
  const { xs, ys, zs, blocks: newBlocks, replaceRule } = batch;
  let editsInUnloadedChunks = 0;
  let editsSkippedByReplaceRule = 0;
  let lastChunkX = 0;
  let lastChunkY = 0;
  let lastChunkZ = 0;
  let lastSlot = -1;
  const isProfiling = profiler.enabled;
  const blocksWrittenByType = session.blocksWrittenByType;
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
      session.tally.chunkRunSwitches++;
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
    if (oldBlock === newBlock) {
      session.tally.editsAlreadyMatching++;
      continue;
    }
    if (!allowsReplacing(replaceRule, oldBlock)) {
      editsSkippedByReplaceRule++;
      continue;
    }
    chunkBlocks[index] = newBlock;
    markCellChanged(lastSlot, index);
    recordChange((lastSlot << CELL_INDEX_BITS) | index, oldBlock);
    if (isProfiling) blocksWrittenByType[newBlock]++;
  }
  endPhase("writeBlocks");

  return finishSession(
    batch.length,
    editsInUnloadedChunks,
    editsSkippedByReplaceRule,
    performance.now() - writingStartedAtMs,
    options.recordChanges !== false,
  );
}

/** Notes a block the caller already wrote. Returns false when its chunk is not loaded. */
function recordWrittenChange(
  x: number,
  y: number,
  z: number,
  oldBlock: number,
): boolean {
  const slot = session.cluster.slotForChunk(
    x >> CHUNK_SHIFT,
    y >> CHUNK_SHIFT,
    z >> CHUNK_SHIFT,
  );
  if (session.cluster.hasBlocksBySlot[slot] === 0) return false;
  const index =
    ((x & CHUNK_MASK) << (CHUNK_SHIFT * 2)) |
    ((y & CHUNK_MASK) << CHUNK_SHIFT) |
    (z & CHUNK_MASK);
  markCellChanged(slot, index);
  recordChange((slot << CELL_INDEX_BITS) | index, oldBlock);
  return true;
}

/**
 * Relights after blocks that the caller has already written, given what each
 * block was before. Use it when block writes are done elsewhere (water
 * simulation, saved edits); applyBlockEdits does the writing itself.
 */
export function relightAfterBlocksWritten(
  source: LightChunkSource,
  changes: ArrayLike<{ x: number; y: number; z: number; oldBlock: number }>,
  options: BulkEditOptions = {},
): BulkEditResult {
  profiler.addCounter("game.edit.path.relightAfterWrites");
  beginSession(source, options);
  let editsInUnloadedChunks = 0;
  for (let position = 0; position < changes.length; position++) {
    const { x, y, z, oldBlock } = changes[position];
    if (!recordWrittenChange(x, y, z, oldBlock)) editsInUnloadedChunks++;
  }
  return finishSession(
    changes.length,
    editsInUnloadedChunks,
    0,
    0,
    options.recordChanges !== false,
  );
}

/** The single-block fast path: no batch or change arrays are built. */
export function relightAfterSingleBlockWritten(
  source: LightChunkSource,
  x: number,
  y: number,
  z: number,
  oldBlock: number,
  options: BulkEditOptions = {},
): BulkEditResult {
  profiler.addCounter("game.edit.path.singleBlock");
  beginSession(source, options);
  const isLoaded = recordWrittenChange(x, y, z, oldBlock);
  return finishSession(
    1,
    isLoaded ? 0 : 1,
    0,
    0,
    options.recordChanges === true,
  );
}
