import { packPositionWord, packSurfaceWord } from "../vertex-format";
import {
  CELL_AXIS_CORNER_PAIRS,
  CORNER_RING_INDICES,
  FACE_CORNER_FLAGS,
  FACE_RING_DELTAS,
  FACE_U_AXIS,
  FACE_U_FORWARD,
  FACE_V_AXIS,
  LIGHT_LEVEL_OF_PACKED_LIGHT,
  MERGE_ALONG_CELLS,
  MERGE_ALONG_ROWS,
  OCCLUDES_AMBIENT_LIGHT,
  OUTSIDE_FACE_FLAGS,
  ROW_AXIS_CORNER_PAIRS,
  VERTEX_LIGHT_STEPS,
  VERTEX_LIGHT_SUM_STRIDE,
} from "./mesh-tables";
import { paddedBlockGrid, paddedLightGrid } from "./padded-grid";
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
  isEdgeCell: boolean
): number {
  const blocks = paddedBlockGrid.cells;
  const light = paddedLightGrid.cells;
  const ringStart = face * RING_CELL_COUNT;
  let blockedMask = 0;
  let excludedMask = 0;
  let lowestLevel = faceLevel;
  let highestLevel = faceLevel;

  for (let ring = 0; ring < RING_CELL_COUNT; ring++) {
    const sampleIndex = cellIndex + FACE_RING_DELTAS[ringStart + ring];
    if (OCCLUDES_AMBIENT_LIGHT[blocks[sampleIndex]] === 1) {
      blockedMask |= 1 << ring;
      excludedMask |= 1 << ring;
      continue;
    }
    if (isEdgeCell && lightKnownByOutsideFlags[OUTSIDE_FACE_FLAGS[sampleIndex]] === 0) {
      excludedMask |= 1 << ring;
      continue;
    }
    const level = LIGHT_LEVEL_OF_PACKED_LIGHT[light[sampleIndex]];
    ringLightLevels[ring] = level;
    if (level < lowestLevel) lowestLevel = level;
    if (level > highestLevel) highestLevel = level;
  }

  if (excludedMask === 0 && lowestLevel === highestLevel) {
    const uniformSteps = VERTEX_LIGHT_STEPS[4 * VERTEX_LIGHT_SUM_STRIDE + 4 * faceLevel];
    for (let corner = 0; corner < 4; corner++) {
      cornerAmbientOcclusion[corner] = 3;
      cornerLightSteps[corner] = uniformSteps;
    }
    return MERGE_ALONG_CELLS | MERGE_ALONG_ROWS;
  }

  for (let corner = 0; corner < 4; corner++) {
    const base = (face * 4 + corner) * 3;
    const firstSide = CORNER_RING_INDICES[base];
    const secondSide = CORNER_RING_INDICES[base + 1];
    const diagonal = CORNER_RING_INDICES[base + 2];

    let occlusion = 3;
    if (receivesAmbientOcclusion) {
      const isFirstSideBlocked = (blockedMask >> firstSide) & 1;
      const isSecondSideBlocked = (blockedMask >> secondSide) & 1;
      const isDiagonalBlocked = (blockedMask >> diagonal) & 1;
      occlusion =
        isFirstSideBlocked && isSecondSideBlocked
          ? 0
          : 3 - isFirstSideBlocked - isSecondSideBlocked - isDiagonalBlocked;
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
 * cornerAmbientOcclusion and cornerLightSteps. The box spans minimum to
 * minimum + size per axis in 1/16 blocks (size along the face's own axis is the
 * block height for top faces and a single cell otherwise). Texture coordinates
 * are in half blocks: u runs 0 to uExtent, v from vAtFlagZero to vAtFlagOne along
 * the face's v axis, mirrored per face as FACE_U_FORWARD says.
 */
export function emitFaceQuad(
  target: VertexStream,
  face: number,
  minX16: number,
  minY16: number,
  minZ16: number,
  sizeX16: number,
  sizeY16: number,
  sizeZ16: number,
  uExtent: number,
  vAtFlagZero: number,
  vAtFlagOne: number,
  textureIndex: number
) {
  const uAxis = FACE_U_AXIS[face];
  const vAxis = FACE_V_AXIS[face];
  const isUForward = FACE_U_FORWARD[face] === 1;
  const faceBase = face * 12;

  const positionWords = quadPositionWords;
  const surfaceWords = quadSurfaceWords;
  for (let corner = 0; corner < 4; corner++) {
    const base = faceBase + corner * 3;
    positionWords[corner] = packPositionWord(
      minX16 + FACE_CORNER_FLAGS[base] * sizeX16,
      minY16 + FACE_CORNER_FLAGS[base + 1] * sizeY16,
      minZ16 + FACE_CORNER_FLAGS[base + 2] * sizeZ16
    );
    const isUFlagSet = FACE_CORNER_FLAGS[base + uAxis] === 1;
    surfaceWords[corner] = packSurfaceWord(
      isUFlagSet === isUForward ? uExtent : 0,
      FACE_CORNER_FLAGS[base + vAxis] === 1 ? vAtFlagOne : vAtFlagZero,
      textureIndex,
      cornerAmbientOcclusion[corner],
      cornerLightSteps[corner]
    );
  }
  // Split along the brighter diagonal so a dark corner does not streak.
  target.pushQuad(
    positionWords[0],
    surfaceWords[0],
    positionWords[1],
    surfaceWords[1],
    positionWords[2],
    surfaceWords[2],
    positionWords[3],
    surfaceWords[3],
    cornerAmbientOcclusion[0] + cornerAmbientOcclusion[3] >
      cornerAmbientOcclusion[1] + cornerAmbientOcclusion[2]
  );
}
