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

export class FloodStats {
  cellsLit = 0;
  cellsVisited = 0;
  cellsRemoved = 0;
  deadCellsSkipped = 0;

  clear() {
    this.cellsLit = 0;
    this.cellsVisited = 0;
    this.cellsRemoved = 0;
    this.deadCellsSkipped = 0;
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
      const neighborIndex = stepAcrossFaces(cluster, slot, index, direction);
      if (neighborIndex < 0) continue;
      const neighborSlot = stepTarget.slot;
      if (IS_TRANSPARENT[blocksBySlot[neighborSlot][neighborIndex]] === 0) {
        continue;
      }

      let neighborLight = lightBySlot[neighborSlot];
      const neighborValue = neighborLight[neighborIndex];
      const neighborSky = neighborValue >> 4;
      const neighborBlock = neighborValue & 0xf;
      const reachedSky =
        direction === NEGATIVE_Y && sky === MAX_LIGHT ? MAX_LIGHT : sky - 1;
      const reachedBlock = block - 1;
      if (reachedSky <= neighborSky && reachedBlock <= neighborBlock) continue;

      const updatedSky = reachedSky > neighborSky ? reachedSky : neighborSky;
      const updatedBlock =
        reachedBlock > neighborBlock ? reachedBlock : neighborBlock;
      if (cluster.copyLightOnWrite[neighborSlot] !== 0) {
        cluster.detachLight(neighborSlot);
        neighborLight = lightBySlot[neighborSlot];
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

  while (queue.length > 0) {
    const cell = queue.shift();
    const removedValue = queue.shiftedValue;
    const slot = cell >>> CELL_INDEX_BITS;
    const index = cell & CELL_INDEX_MASK;
    stats.cellsVisited++;

    for (let direction = 0; direction < DIRECTION_COUNT; direction++) {
      const neighborIndex = stepAcrossFaces(cluster, slot, index, direction);
      if (neighborIndex < 0) continue;
      const neighborSlot = stepTarget.slot;
      const neighborLight = lightBySlot[neighborSlot];
      const neighborValue = neighborLight[neighborIndex];
      const neighborChannelValue = isSkyChannel
        ? neighborValue >> 4
        : neighborValue & 0xf;
      if (neighborChannelValue === 0) continue;

      const neighborCell = (neighborSlot << CELL_INDEX_BITS) | neighborIndex;
      const isFedByRemovedCell =
        neighborChannelValue < removedValue ||
        (isSkyChannel &&
          direction === NEGATIVE_Y &&
          removedValue === MAX_LIGHT &&
          neighborChannelValue === MAX_LIGHT);
      if (!isFedByRemovedCell) {
        refillQueue.push(neighborCell);
        continue;
      }

      neighborLight[neighborIndex] = isSkyChannel
        ? neighborValue & 0x0f
        : neighborValue & 0xf0;
      cluster.contentChanged[neighborSlot] = 1;
      cluster.faceChanged[neighborSlot] |= BOUNDARY_FACES[neighborIndex];
      stats.cellsRemoved++;
      queue.push(neighborCell, neighborChannelValue);
      if (
        !isSkyChannel &&
        EMISSION[blocksBySlot[neighborSlot][neighborIndex]] > 0
      ) {
        restoredEmitters.push(neighborCell);
      }
    }
  }
}
