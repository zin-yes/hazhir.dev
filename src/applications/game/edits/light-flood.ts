import { CellQueue } from "./cell-queue";
import {
  BOUNDARY_FACES,
  CELL_INDEX_BITS,
  CELL_INDEX_MASK,
  CHUNK_MASK,
  CHUNK_SHIFT,
  ChunkCluster,
  DIRECTION_COUNT,
  DIRECTION_INDEX_STEP,
  NEGATIVE_Y,
  UNRESOLVED_NEIGHBOR,
  X_STRIDE,
  Y_STRIDE,
} from "./chunk-cluster";
import { EMISSION, IS_TRANSPARENT, MAX_LIGHT } from "./light-tables";

/**
 * What the flood fills did, as plain integers the caller reports (the main thread through the profiler, a worker
 * through its recorder). The first four fields are the original summary; the rest say where the work went.
 */
export class FloodStats {
  cellsLit = 0;
  cellsVisited = 0;
  cellsRemoved = 0;
  deadCellsSkipped = 0;
  /** Calls of spreadLight and removeLight since the last clear. */
  spreadCalls = 0;
  removeCalls = 0;
  /** Cells pushed onto the queues by the floods themselves (seeds pushed by the caller are not counted). */
  cellsQueuedBySpread = 0;
  cellsQueuedByRemoval = 0;
  /** The most cells any flood queue held at once. */
  peakQueueLength = 0;
  /** Neighbor steps examined, and how each ended. */
  neighborsExamined = 0;
  neighborsOutsideLitChunks = 0;
  neighborsOpaque = 0;
  neighborsAlreadyBrightEnough = 0;
  chunkBoundaryCrossings = 0;
  /** Chunks whose shared light array had to be copied before the first write. */
  lightArraysDetached = 0;
  /** Removal waves: cells zeroed per channel, neighbors left lit by something else, glowing blocks restored. */
  skyCellsRemoved = 0;
  blockCellsRemoved = 0;
  neighborsKeptForRefill = 0;
  neighborsAlreadyDark = 0;
  emittersRestored = 0;

  clear() {
    this.cellsLit = 0;
    this.cellsVisited = 0;
    this.cellsRemoved = 0;
    this.deadCellsSkipped = 0;
    this.spreadCalls = 0;
    this.removeCalls = 0;
    this.cellsQueuedBySpread = 0;
    this.cellsQueuedByRemoval = 0;
    this.peakQueueLength = 0;
    this.neighborsExamined = 0;
    this.neighborsOutsideLitChunks = 0;
    this.neighborsOpaque = 0;
    this.neighborsAlreadyBrightEnough = 0;
    this.chunkBoundaryCrossings = 0;
    this.lightArraysDetached = 0;
    this.skyCellsRemoved = 0;
    this.blockCellsRemoved = 0;
    this.neighborsKeptForRefill = 0;
    this.neighborsAlreadyDark = 0;
    this.emittersRestored = 0;
  }
}

const AXIS_STRIDE = [X_STRIDE, Y_STRIDE, 1];
const AXIS_SPAN = CHUNK_MASK;

/** The slot the last successful stepAcrossFaces call landed in. */
export const stepTarget = { slot: 0 };

/**
 * Index of the cell one step away in a direction, or -1 when that step leaves
 * the chunk into one that is not lit. The slot of the cell it reaches is left
 * in stepTarget.slot, which saves allocating a pair per step.
 */
export function stepAcrossFaces(
  cluster: ChunkCluster,
  slot: number,
  index: number,
  direction: number,
): number {
  const axis = direction >> 1;
  const isPositive = (direction & 1) === 0;
  const coordinate =
    axis === 0
      ? index >> (CHUNK_SHIFT * 2)
      : axis === 1
        ? (index >> CHUNK_SHIFT) & CHUNK_MASK
        : index & CHUNK_MASK;
  if (isPositive ? coordinate === AXIS_SPAN : coordinate === 0) {
    let neighborSlot = cluster.neighborSlots[slot * DIRECTION_COUNT + direction];
    if (neighborSlot === UNRESOLVED_NEIGHBOR) {
      neighborSlot = cluster.resolveNeighbor(slot, direction);
    }
    if (neighborSlot < 0) return -1;
    stepTarget.slot = neighborSlot;
    const wrap = AXIS_SPAN * AXIS_STRIDE[axis];
    return isPositive ? index - wrap : index + wrap;
  }
  stepTarget.slot = slot;
  return index + DIRECTION_INDEX_STEP[direction];
}

/**
 * Floods light outward from the queued cells, which already hold their light.
 * Both channels spread together: block light loses one level per step, sky
 * light too except that full sky light (15) falls straight down undimmed.
 * Every cell it brightens is queued in turn.
 */
export function spreadLight(
  cluster: ChunkCluster,
  queue: CellQueue,
  stats: FloodStats,
) {
  const blocksBySlot = cluster.blocksBySlot;
  const lightBySlot = cluster.lightBySlot;
  const pushedBeforeFlood = queue.pushedCount;
  stats.spreadCalls++;

  while (queue.length > 0) {
    const cell = queue.shift();
    const slot = cell >>> CELL_INDEX_BITS;
    const index = cell & CELL_INDEX_MASK;
    stats.cellsVisited++;
    const value = lightBySlot[slot][index];
    if (value === 0) {
      stats.deadCellsSkipped++;
      continue;
    }
    const sky = value >> 4;
    const block = value & 0xf;

    for (let direction = 0; direction < DIRECTION_COUNT; direction++) {
      stats.neighborsExamined++;
      const neighborIndex = stepAcrossFaces(cluster, slot, index, direction);
      if (neighborIndex < 0) {
        stats.neighborsOutsideLitChunks++;
        continue;
      }
      const neighborSlot = stepTarget.slot;
      if (neighborSlot !== slot) stats.chunkBoundaryCrossings++;
      if (IS_TRANSPARENT[blocksBySlot[neighborSlot][neighborIndex]] === 0) {
        stats.neighborsOpaque++;
        continue;
      }

      let neighborLight = lightBySlot[neighborSlot];
      const neighborValue = neighborLight[neighborIndex];
      const neighborSky = neighborValue >> 4;
      const neighborBlock = neighborValue & 0xf;
      const reachedSky =
        direction === NEGATIVE_Y && sky === MAX_LIGHT ? MAX_LIGHT : sky - 1;
      const reachedBlock = block - 1;
      if (reachedSky <= neighborSky && reachedBlock <= neighborBlock) {
        stats.neighborsAlreadyBrightEnough++;
        continue;
      }

      const updatedSky = reachedSky > neighborSky ? reachedSky : neighborSky;
      const updatedBlock =
        reachedBlock > neighborBlock ? reachedBlock : neighborBlock;
      if (cluster.copyLightOnWrite[neighborSlot] !== 0) {
        cluster.detachLight(neighborSlot);
        neighborLight = lightBySlot[neighborSlot];
        stats.lightArraysDetached++;
      }
      neighborLight[neighborIndex] = (updatedSky << 4) | updatedBlock;
      cluster.contentChanged[neighborSlot] = 1;
      cluster.faceChanged[neighborSlot] |= BOUNDARY_FACES[neighborIndex];
      stats.cellsLit++;
      // A cell down to one level cannot brighten anything next to it.
      if (updatedSky > 1 || updatedBlock > 1) {
        queue.push((neighborSlot << CELL_INDEX_BITS) | neighborIndex);
      }
    }
  }
  stats.cellsQueuedBySpread += queue.pushedCount - pushedBeforeFlood;
  if (queue.peakLength > stats.peakQueueLength) stats.peakQueueLength = queue.peakLength;
}

/**
 * Zeroes one channel of every cell whose light flowed from the cells in the
 * queue (each carrying the level it used to hold). Cells next to the hole that
 * are lit by something else go to refillQueue, and glowing blocks that were
 * zeroed go to restoredEmitters so the caller can switch them back on.
 */
export function removeLight(
  cluster: ChunkCluster,
  queue: CellQueue,
  isSkyChannel: boolean,
  refillQueue: CellQueue,
  restoredEmitters: CellQueue,
  stats: FloodStats,
) {
  const blocksBySlot = cluster.blocksBySlot;
  const lightBySlot = cluster.lightBySlot;
  const pushedBeforeFlood = queue.pushedCount;
  stats.removeCalls++;

  while (queue.length > 0) {
    const cell = queue.shift();
    const removedValue = queue.shiftedValue;
    const slot = cell >>> CELL_INDEX_BITS;
    const index = cell & CELL_INDEX_MASK;
    stats.cellsVisited++;

    for (let direction = 0; direction < DIRECTION_COUNT; direction++) {
      stats.neighborsExamined++;
      const neighborIndex = stepAcrossFaces(cluster, slot, index, direction);
      if (neighborIndex < 0) {
        stats.neighborsOutsideLitChunks++;
        continue;
      }
      const neighborSlot = stepTarget.slot;
      if (neighborSlot !== slot) stats.chunkBoundaryCrossings++;
      const neighborLight = lightBySlot[neighborSlot];
      const neighborValue = neighborLight[neighborIndex];
      const neighborChannelValue = isSkyChannel
        ? neighborValue >> 4
        : neighborValue & 0xf;
      if (neighborChannelValue === 0) {
        stats.neighborsAlreadyDark++;
        continue;
      }

      const neighborCell = (neighborSlot << CELL_INDEX_BITS) | neighborIndex;
      const isFedByRemovedCell =
        neighborChannelValue < removedValue ||
        (isSkyChannel &&
          direction === NEGATIVE_Y &&
          removedValue === MAX_LIGHT &&
          neighborChannelValue === MAX_LIGHT);
      if (!isFedByRemovedCell) {
        stats.neighborsKeptForRefill++;
        refillQueue.push(neighborCell);
        continue;
      }

      neighborLight[neighborIndex] = isSkyChannel
        ? neighborValue & 0x0f
        : neighborValue & 0xf0;
      cluster.contentChanged[neighborSlot] = 1;
      cluster.faceChanged[neighborSlot] |= BOUNDARY_FACES[neighborIndex];
      stats.cellsRemoved++;
      if (isSkyChannel) stats.skyCellsRemoved++;
      else stats.blockCellsRemoved++;
      queue.push(neighborCell, neighborChannelValue);
      if (
        !isSkyChannel &&
        EMISSION[blocksBySlot[neighborSlot][neighborIndex]] > 0
      ) {
        stats.emittersRestored++;
        restoredEmitters.push(neighborCell);
      }
    }
  }
  stats.cellsQueuedByRemoval += queue.pushedCount - pushedBeforeFlood;
  if (queue.peakLength > stats.peakQueueLength) stats.peakQueueLength = queue.peakLength;
}
