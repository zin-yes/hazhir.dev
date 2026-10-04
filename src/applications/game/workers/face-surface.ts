import {
  LIGHT_STEPS_PER_LEVEL,
  SURFACE_LIGHT_SHIFT,
  SURFACE_OCCLUSION_SHIFT,
  SURFACE_TEXTURE_SHIFT,
  SURFACE_V_SHIFT,
} from "../vertex-format";
import {
  CELL_AXIS_CORNER_PAIRS,
  CORNER_RING_INDICES,
  CORNER_SIZE_MASKS,
  CORNER_U_AT_FAR_END,
  CORNER_V_AT_FAR_END,
  FACE_NEIGHBOR_DELTAS,
  FACE_RING_DELTAS,
  FULLY_LIT_AMBIENT_OCCLUSION,
  LIGHT_LEVEL_OF_PACKED_LIGHT,
  MERGE_ALONG_CELLS,
  MERGE_ALONG_ROWS,
  OCCLUDES_AMBIENT_LIGHT,
  OUTSIDE_FACE_FLAGS,
  RING_ROW_DELTAS,
  RING_Z_OFFSETS,
  ROW_AXIS_CORNER_PAIRS,
  VERTEX_LIGHT_STEPS,
  VERTEX_LIGHT_SUM_STRIDE,
} from "./mesh-tables";
import { paddedBlockGrid, paddedLightGrid } from "./padded-grid";
import { occluderRows } from "./row-occupancy";
import type { VertexStream } from "./vertex-stream";

const RING_CELL_COUNT = 8;
const FACE_FLAG_VALUES = 64;

/** Ambient occlusion (0 = boxed in, 3 = open) and vertex light in quarter levels of the four corners of the last sampled face. */
export const cornerAmbientOcclusion = new Int32Array(4);
export const cornerLightSteps = new Int32Array(4);

const ringLightLevels = new Int32Array(RING_CELL_COUNT);
const quadPositionWords = new Int32Array(4);
const quadSurfaceWords = new Int32Array(4);

/** Whether a padded cell's light is known, by the face directions it lies beyond (see OUTSIDE_FACE_FLAGS). */
export const lightKnownByOutsideFlags = new Uint8Array(FACE_FLAG_VALUES);

export function updateLightKnownFlags(hasLightBorderForFace: boolean[]) {
  for (let flags = 0; flags < FACE_FLAG_VALUES; flags++) {
    const isInside = flags === 0;
    const isBeyondOneFace = flags !== 0 && (flags & (flags - 1)) === 0;
    lightKnownByOutsideFlags[flags] =
      isInside || (isBeyondOneFace && hasLightBorderForFace[31 - Math.clz32(flags)]) ? 1 : 0;
  }
}

/**
 * Fills cornerAmbientOcclusion and cornerLightSteps for a face of the block at
 * cellIndex. Each corner averages the light of the cell the face looks at and of
 * the open cells touching that corner, and is darkened by blocks pressed against
 * it. Returns the directions the face may merge with equal neighbors in
 * (MERGE_ALONG_CELLS, MERGE_ALONG_ROWS, both when all four corners agree, or 0): a
 * face may only grow along an axis its corner values do not change along.
 */
export function sampleFaceSurface(
  face: number,
  cellIndex: number,
  faceLevel: number,
  receivesAmbientOcclusion: boolean,
  isEdgeCell: boolean,
  rowIndex: number,
  z: number
): number {
  const light = paddedLightGrid.cells;
  const ringStart = face * RING_CELL_COUNT;
  let blockedMask = 0;
  let excludedMask = 0;

  if (isEdgeCell) {
    const blocks = paddedBlockGrid.cells;
    for (let ring = 0; ring < RING_CELL_COUNT; ring++) {
      const sampleIndex = cellIndex + FACE_RING_DELTAS[ringStart + ring];
      if (OCCLUDES_AMBIENT_LIGHT[blocks[sampleIndex]] === 1) {
        blockedMask |= 1 << ring;
        excludedMask |= 1 << ring;
      } else if (lightKnownByOutsideFlags[OUTSIDE_FACE_FLAGS[sampleIndex]] === 0) {
        excludedMask |= 1 << ring;
      }
    }
  } else {
    // Away from the chunk edge every ring cell is inside, so occlusion is a bit test on the occupancy rows.
    for (let ring = 0; ring < RING_CELL_COUNT; ring++) {
      const rowBits = occluderRows[rowIndex + RING_ROW_DELTAS[ringStart + ring]];
      blockedMask |= ((rowBits >>> (z + RING_Z_OFFSETS[ringStart + ring])) & 1) << ring;
    }
    excludedMask = blockedMask;
    if (blockedMask === 0) {
      const faceLight = light[cellIndex + FACE_NEIGHBOR_DELTAS[face]];
      let isUniform = true;
      for (let ring = 0; ring < RING_CELL_COUNT; ring++) {
        if (light[cellIndex + FACE_RING_DELTAS[ringStart + ring]] !== faceLight) {
          isUniform = false;
          break;
        }
      }
      if (isUniform) {
        const uniformSteps = faceLevel * LIGHT_STEPS_PER_LEVEL;
        for (let corner = 0; corner < 4; corner++) {
          cornerAmbientOcclusion[corner] = FULLY_LIT_AMBIENT_OCCLUSION;
          cornerLightSteps[corner] = uniformSteps;
        }
        return MERGE_ALONG_CELLS | MERGE_ALONG_ROWS;
      }
    }
  }

  for (let ring = 0; ring < RING_CELL_COUNT; ring++) {
    ringLightLevels[ring] =
      (excludedMask >> ring) & 1
        ? 0
        : LIGHT_LEVEL_OF_PACKED_LIGHT[light[cellIndex + FACE_RING_DELTAS[ringStart + ring]]];
  }

  for (let corner = 0; corner < 4; corner++) {
    const base = (face * 4 + corner) * 3;
    const firstSide = CORNER_RING_INDICES[base];
    const secondSide = CORNER_RING_INDICES[base + 1];
    const diagonal = CORNER_RING_INDICES[base + 2];

    let occlusion = FULLY_LIT_AMBIENT_OCCLUSION;
    if (receivesAmbientOcclusion) {
      const isFirstSideBlocked = (blockedMask >> firstSide) & 1;
      const isSecondSideBlocked = (blockedMask >> secondSide) & 1;
      const isDiagonalBlocked = (blockedMask >> diagonal) & 1;
      occlusion =
        isFirstSideBlocked && isSecondSideBlocked
          ? 0
          : FULLY_LIT_AMBIENT_OCCLUSION - isFirstSideBlocked - isSecondSideBlocked - isDiagonalBlocked;
    }

    let lightSum = faceLevel;
    let cellCount = 1;
    if (((excludedMask >> firstSide) & 1) === 0) {
      lightSum += ringLightLevels[firstSide];
      cellCount++;
    }
    if (((excludedMask >> secondSide) & 1) === 0) {
      lightSum += ringLightLevels[secondSide];
      cellCount++;
    }
    if (((excludedMask >> diagonal) & 1) === 0) {
      lightSum += ringLightLevels[diagonal];
      cellCount++;
    }
    cornerAmbientOcclusion[corner] = occlusion;
    cornerLightSteps[corner] = VERTEX_LIGHT_STEPS[cellCount * VERTEX_LIGHT_SUM_STRIDE + lightSum];
  }

  return (
    (isConstantAcrossPairs(CELL_AXIS_CORNER_PAIRS, face) ? MERGE_ALONG_CELLS : 0) |
    (isConstantAcrossPairs(ROW_AXIS_CORNER_PAIRS, face) ? MERGE_ALONG_ROWS : 0)
  );
}

function isConstantAcrossPairs(pairs: Uint8Array, face: number): boolean {
  const base = face * 4;
  return (
    cornerAmbientOcclusion[pairs[base]] === cornerAmbientOcclusion[pairs[base + 1]] &&
    cornerAmbientOcclusion[pairs[base + 2]] === cornerAmbientOcclusion[pairs[base + 3]] &&
    cornerLightSteps[pairs[base]] === cornerLightSteps[pairs[base + 1]] &&
    cornerLightSteps[pairs[base + 2]] === cornerLightSteps[pairs[base + 3]]
  );
}

/**
 * Appends one axis aligned face as a quad, using the corner values left in
 * cornerAmbientOcclusion and cornerLightSteps. The box spans minimumWord to
 * minimumWord + sizeWord, both packed like a position word (1/16 blocks; the size
 * along the face's own axis is the block height for top faces and a single cell
 * otherwise). Texture coordinates are in half blocks: u runs 0 to uExtent, v from
 * vAtFlagZero to vAtFlagOne along the face's v axis, mirrored per face as
 * FACE_U_FORWARD says.
 */
export function emitFaceQuad(
  target: VertexStream,
  face: number,
  minimumWord: number,
  sizeWord: number,
  uExtent: number,
  vAtFlagZero: number,
  vAtFlagOne: number,
  textureIndex: number
) {
  const positionWords = quadPositionWords;
  const surfaceWords = quadSurfaceWords;
  const textureBits = textureIndex << SURFACE_TEXTURE_SHIFT;
  const faceBase = face * 4;
  for (let corner = 0; corner < 4; corner++) {
    const cornerIndex = faceBase + corner;
    positionWords[corner] = minimumWord + (sizeWord & CORNER_SIZE_MASKS[cornerIndex]);
    surfaceWords[corner] =
      (CORNER_U_AT_FAR_END[cornerIndex] === 1 ? uExtent : 0) |
      ((CORNER_V_AT_FAR_END[cornerIndex] === 1 ? vAtFlagOne : vAtFlagZero) << SURFACE_V_SHIFT) |
      textureBits |
      (cornerAmbientOcclusion[corner] << SURFACE_OCCLUSION_SHIFT) |
      (cornerLightSteps[corner] << SURFACE_LIGHT_SHIFT);
  }
  // Split along the brighter diagonal so a dark corner does not streak.
  target.pushQuadFromCorners(
    positionWords,
    surfaceWords,
    cornerAmbientOcclusion[0] + cornerAmbientOcclusion[3] >
      cornerAmbientOcclusion[1] + cornerAmbientOcclusion[2]
  );
}
