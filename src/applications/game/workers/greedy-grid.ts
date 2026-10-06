import { DIMENSIONS } from "../profiler/dimensions";
import {
  addWorkerKeyedUnits,
  endWorkerSection,
  startWorkerSampledSection,
  startWorkerSection,
} from "../profiler/worker-recorder";
import { CHUNK_UV_UNITS_PER_BLOCK, POSITION_UNITS_PER_BLOCK, packPositionWord } from "../vertex-format";
import {
  cornerAmbientOcclusion,
  cornerLightSteps,
  emitFaceQuad,
} from "./face-surface";
import {
  CELL_AXIS_OF_FACE,
  FACE_COUNT,
  FACE_U_AXIS,
  FACE_UP,
  FACE_V_AXIS,
  FACE_V_FORWARD,
  MERGE_ALONG_CELLS,
  MERGE_ALONG_ROWS,
  ROW_AXIS_OF_FACE,
  SLICE_AXIS_OF_FACE,
} from "./mesh-tables";
import type { VertexStream } from "./vertex-stream";

/**
 * Greedy merging of faces whose shading does not change along the direction they
 * grow in. A face may grow along cells (or rows) when its ambient occlusion and
 * vertex light are the same at the two corners on each side of that axis, so a
 * rectangle of equal faces shades exactly like the cells it replaces. Faces are
 * recorded per direction and slice (the layer along the face's axis) as a pair
 * of keys per cell, then merged into the largest rectangles of equal keys, a run
 * along the row first and then as many rows as extend the run.
 *   firstKey:  texture 8 bits | translucent << 8 | top height << 9 | merge directions << 14
 *              | ambient occlusion of corner 0..3 in 2 bits each from bit 16
 *   secondKey: light steps of corner 0..3 in 6 bits each
 * The top height (in 1/16 blocks) only differs from 16 for the water surface.
 */
const KEY_TRANSLUCENT_SHIFT = 8;
const KEY_TOP_HEIGHT_SHIFT = 9;
const KEY_DIRECTIONS_SHIFT = 14;
const KEY_OCCLUSION_SHIFT = 16;
const LIGHT_STEP_BITS = 6;

const CELLS_PER_ROW = 32;
const ROWS_PER_SLICE = 32;
const SLICES_PER_FACE = 32;
const CELLS_PER_SLICE = CELLS_PER_ROW * ROWS_PER_SLICE;

/** Order matches the face indices: up, down, front, back, left, right. */
export const FACE_DIRECTION_NAMES = ["up", "down", "front", "back", "left", "right"] as const;
const MERGED_QUAD_SAMPLE_INTERVAL = 64;

/** Units of merge work since the last reset, flushed to the profiler once per task. */
export const greedyMergeStats = {
  slicesVisited: 0,
  rowsVisited: 0,
  runsStarted: 0,
  cellsAbsorbedAlongCells: 0,
  rowsAbsorbedAlongRows: 0,
  facesConsumed: 0,
  translucentQuads: 0,
  recordedFacesByDirection: new Int32Array(FACE_COUNT),
  quadsByDirection: new Int32Array(FACE_COUNT),
};

export function resetGreedyMergeStats() {
  greedyMergeStats.slicesVisited = 0;
  greedyMergeStats.rowsVisited = 0;
  greedyMergeStats.runsStarted = 0;
  greedyMergeStats.cellsAbsorbedAlongCells = 0;
  greedyMergeStats.rowsAbsorbedAlongRows = 0;
  greedyMergeStats.facesConsumed = 0;
  greedyMergeStats.translucentQuads = 0;
  greedyMergeStats.recordedFacesByDirection.fill(0);
  greedyMergeStats.quadsByDirection.fill(0);
}

/** Keys are only meaningful where the row mask has a bit; the grid is never cleared, merging consumes the masks. */
const firstKeys = new Int32Array(FACE_COUNT * SLICES_PER_FACE * CELLS_PER_SLICE);
const secondKeys = new Int32Array(FACE_COUNT * SLICES_PER_FACE * CELLS_PER_SLICE);
const rowCellMasks = new Int32Array(FACE_COUNT * SLICES_PER_FACE * ROWS_PER_SLICE);
const sliceRowMasks = new Int32Array(FACE_COUNT * SLICES_PER_FACE);
const faceSliceMasks = new Int32Array(FACE_COUNT);

/** Records the face last sampled into cornerAmbientOcclusion and cornerLightSteps for merging. */
export function recordMergeableFace(
  face: number,
  x: number,
  y: number,
  z: number,
  textureIndex: number,
  isTranslucent: boolean,
  topHeight16: number,
  mergeDirections: number
) {
  let slice: number;
  let row: number;
  let cell: number;
  if (face < 2) {
    slice = y;
    row = x;
    cell = z;
  } else if (face < 4) {
    slice = z;
    row = x;
    cell = y;
  } else {
    slice = x;
    row = y;
    cell = z;
  }
  const sliceIndex = face * SLICES_PER_FACE + slice;
  const keyIndex = sliceIndex * CELLS_PER_SLICE + row * CELLS_PER_ROW + cell;
  firstKeys[keyIndex] =
    textureIndex |
    ((isTranslucent ? 1 : 0) << KEY_TRANSLUCENT_SHIFT) |
    (topHeight16 << KEY_TOP_HEIGHT_SHIFT) |
    (mergeDirections << KEY_DIRECTIONS_SHIFT) |
    (cornerAmbientOcclusion[0] << KEY_OCCLUSION_SHIFT) |
    (cornerAmbientOcclusion[1] << (KEY_OCCLUSION_SHIFT + 2)) |
    (cornerAmbientOcclusion[2] << (KEY_OCCLUSION_SHIFT + 4)) |
    (cornerAmbientOcclusion[3] << (KEY_OCCLUSION_SHIFT + 6));
  secondKeys[keyIndex] =
    cornerLightSteps[0] |
    (cornerLightSteps[1] << LIGHT_STEP_BITS) |
    (cornerLightSteps[2] << (LIGHT_STEP_BITS * 2)) |
    (cornerLightSteps[3] << (LIGHT_STEP_BITS * 3));
  greedyMergeStats.recordedFacesByDirection[face]++;
  rowCellMasks[sliceIndex * ROWS_PER_SLICE + row] |= 1 << cell;
  sliceRowMasks[sliceIndex] |= 1 << row;
  faceSliceMasks[face] |= 1 << slice;
}

const quadOrigin = new Int32Array(3);
const quadExtent = new Int32Array(3);

function emitMergedQuad(
  target: VertexStream,
  face: number,
  slice: number,
  row: number,
  firstCell: number,
  rowCount: number,
  cellCount: number,
  firstKey: number,
  secondKey: number
) {
  const sliceAxis = SLICE_AXIS_OF_FACE[face];
  const rowAxis = ROW_AXIS_OF_FACE[face];
  const cellAxis = CELL_AXIS_OF_FACE[face];
  quadOrigin[sliceAxis] = slice;
  quadOrigin[rowAxis] = row;
  quadOrigin[cellAxis] = firstCell;
  quadExtent[sliceAxis] = 1;
  quadExtent[rowAxis] = rowCount;
  quadExtent[cellAxis] = cellCount;

  const topHeight16 = (firstKey >> KEY_TOP_HEIGHT_SHIFT) & 31;
  for (let corner = 0; corner < 4; corner++) {
    cornerAmbientOcclusion[corner] = (firstKey >> (KEY_OCCLUSION_SHIFT + corner * 2)) & 3;
    cornerLightSteps[corner] = (secondKey >> (corner * LIGHT_STEP_BITS)) & 63;
  }

  const blockUnits = POSITION_UNITS_PER_BLOCK;
  const uExtent = quadExtent[FACE_U_AXIS[face]] * CHUNK_UV_UNITS_PER_BLOCK;
  const vExtent = quadExtent[FACE_V_AXIS[face]] * CHUNK_UV_UNITS_PER_BLOCK;
  const isVForward = FACE_V_FORWARD[face] === 1;
  emitFaceQuad(
    target,
    face,
    packPositionWord(quadOrigin[0] * blockUnits, quadOrigin[1] * blockUnits, quadOrigin[2] * blockUnits),
    packPositionWord(
      quadExtent[0] * blockUnits,
      face === FACE_UP ? topHeight16 : quadExtent[1] * blockUnits,
      quadExtent[2] * blockUnits
    ),
    uExtent,
    isVForward ? 0 : vExtent,
    isVForward ? vExtent : 0,
    firstKey & 0xff
  );
}

function lowestSetBitIndex(mask: number): number {
  return 31 - Math.clz32(mask & -mask);
}

/**
 * Merges every recorded face into rectangles and appends them to the opaque or
 * transparent stream (by the key's translucent bit). Leaves the grid empty.
 * Returns the number of quads emitted.
 */
export function mergeRecordedFaces(opaque: VertexStream, transparent: VertexStream): number {
  let quadsEmitted = 0;
  for (let face = 0; face < FACE_COUNT; face++) {
    let pendingSlices = faceSliceMasks[face];
    faceSliceMasks[face] = 0;
    if (pendingSlices === 0) continue;
    const quadsBeforeDirection = quadsEmitted;
    startWorkerSection("mergeDirection", DIMENSIONS.meshFaceDirection, FACE_DIRECTION_NAMES[face]);
    while (pendingSlices !== 0) {
      const slice = lowestSetBitIndex(pendingSlices);
      pendingSlices &= pendingSlices - 1;
      greedyMergeStats.slicesVisited++;
      const sliceIndex = face * SLICES_PER_FACE + slice;
      const rowMaskBase = sliceIndex * ROWS_PER_SLICE;
      const keyBase = sliceIndex * CELLS_PER_SLICE;
      let pendingRows = sliceRowMasks[sliceIndex];
      sliceRowMasks[sliceIndex] = 0;
      while (pendingRows !== 0) {
        const row = lowestSetBitIndex(pendingRows);
        pendingRows &= pendingRows - 1;
        greedyMergeStats.rowsVisited++;

        let cellMask = rowCellMasks[rowMaskBase + row];
        while (cellMask !== 0) {
          const firstCell = lowestSetBitIndex(cellMask);
          const rowKeyBase = keyBase + row * CELLS_PER_ROW;
          const firstKey = firstKeys[rowKeyBase + firstCell];
          const secondKey = secondKeys[rowKeyBase + firstCell];
          const mergeDirections = (firstKey >> KEY_DIRECTIONS_SHIFT) & 3;

          let cellCount = 1;
          if ((mergeDirections & MERGE_ALONG_CELLS) !== 0) {
            while (
              firstCell + cellCount < CELLS_PER_ROW &&
              ((cellMask >>> (firstCell + cellCount)) & 1) === 1 &&
              firstKeys[rowKeyBase + firstCell + cellCount] === firstKey &&
              secondKeys[rowKeyBase + firstCell + cellCount] === secondKey
            ) {
              cellCount++;
            }
          }
          const runBits = cellCount === 32 ? -1 : ((1 << cellCount) - 1) << firstCell;

          let rowCount = 1;
          while ((mergeDirections & MERGE_ALONG_ROWS) !== 0 && row + rowCount < ROWS_PER_SLICE) {
            const nextRow = row + rowCount;
            if ((rowCellMasks[rowMaskBase + nextRow] & runBits) !== runBits) break;
            const nextKeyBase = keyBase + nextRow * CELLS_PER_ROW + firstCell;
            let isRunEqual = true;
            for (let offset = 0; offset < cellCount; offset++) {
              if (
                firstKeys[nextKeyBase + offset] !== firstKey ||
                secondKeys[nextKeyBase + offset] !== secondKey
              ) {
                isRunEqual = false;
                break;
              }
            }
            if (!isRunEqual) break;
            rowCount++;
          }

          for (let consumed = 0; consumed < rowCount; consumed++) {
            rowCellMasks[rowMaskBase + row + consumed] &= ~runBits;
          }
          cellMask = rowCellMasks[rowMaskBase + row];

          const isTranslucent = ((firstKey >> KEY_TRANSLUCENT_SHIFT) & 1) === 1;
          greedyMergeStats.runsStarted++;
          greedyMergeStats.cellsAbsorbedAlongCells += cellCount - 1;
          greedyMergeStats.rowsAbsorbedAlongRows += rowCount - 1;
          greedyMergeStats.facesConsumed += cellCount * rowCount;
          if (isTranslucent) greedyMergeStats.translucentQuads++;
          startWorkerSampledSection("emitMergedQuad", MERGED_QUAD_SAMPLE_INTERVAL);
          emitMergedQuad(
            isTranslucent ? transparent : opaque,
            face,
            slice,
            row,
            firstCell,
            rowCount,
            cellCount,
            firstKey,
            secondKey
          );
          endWorkerSection();
          quadsEmitted++;
        }
      }
    }
    const quadsInDirection = quadsEmitted - quadsBeforeDirection;
    greedyMergeStats.quadsByDirection[face] = quadsInDirection;
    addWorkerKeyedUnits(DIMENSIONS.meshFaceDirection, FACE_DIRECTION_NAMES[face], quadsInDirection);
    endWorkerSection();
  }
  return quadsEmitted;
}
