import {
  BLOCK_TEXTURES,
  BlockType,
  TRANSLUCENT_BLOCKS,
  TRANSPARENT_BLOCKS,
  isSlab,
  isStairs,
  isTopSlab,
  isWater,
} from "@/applications/game/blocks";
import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "../config";
import {
  LIGHT_STEPS_PER_LEVEL,
  POSITION_AXIS_BITS,
  POSITION_Y_SHIFT,
  POSITION_Z_SHIFT,
} from "../vertex-format";
import { PADDED_COLUMNS, PADDED_ROWS, STRIDE_X, STRIDE_Y, Z_PADDING, paddedDelta } from "./padded-layout";
import { isPlantVoxelBlock } from "./plant-voxels";

export const BLOCK_ID_COUNT = 256;
export const FULLY_LIT_AMBIENT_OCCLUSION = 3;

function buildBlockLookup(isMember: (block: BlockType) => boolean): Uint8Array {
  const lookup = new Uint8Array(BLOCK_ID_COUNT);
  for (let block = 0; block < BLOCK_ID_COUNT; block++) lookup[block] = isMember(block) ? 1 : 0;
  return lookup;
}

export const IS_TRANSPARENT = buildBlockLookup((block) => TRANSPARENT_BLOCKS.includes(block));
export const IS_TRANSLUCENT = buildBlockLookup((block) => TRANSLUCENT_BLOCKS.includes(block));
export const IS_SLAB = buildBlockLookup(isSlab);
export const IS_TOP_SLAB = buildBlockLookup(isTopSlab);
export const IS_WATER = buildBlockLookup(isWater);
export const OCCLUDES_AMBIENT_LIGHT = buildBlockLookup(
  (block) =>
    block !== BlockType.AIR && !TRANSPARENT_BLOCKS.includes(block) && !TRANSLUCENT_BLOCKS.includes(block)
);
export const RECEIVES_AMBIENT_OCCLUSION = buildBlockLookup(
  (block) => !TRANSLUCENT_BLOCKS.includes(block) && !isSlab(block)
);

/** How the mesher handles a block: air is skipped, plants become instances, stairs and slabs are never merged. */
export const BLOCK_KIND_AIR = 0;
export const BLOCK_KIND_CUBE = 1;
export const BLOCK_KIND_WATER = 2;
export const BLOCK_KIND_SLAB = 3;
export const BLOCK_KIND_STAIRS = 4;
export const BLOCK_KIND_PLANT = 5;

export const BLOCK_KIND = (() => {
  const kinds = new Uint8Array(BLOCK_ID_COUNT);
  for (let block = 0; block < BLOCK_ID_COUNT; block++) {
    if (block === BlockType.AIR) kinds[block] = BLOCK_KIND_AIR;
    else if (isPlantVoxelBlock(block)) kinds[block] = BLOCK_KIND_PLANT;
    else if (isStairs(block)) kinds[block] = BLOCK_KIND_STAIRS;
    else if (isSlab(block)) kinds[block] = BLOCK_KIND_SLAB;
    else if (isWater(block)) kinds[block] = BLOCK_KIND_WATER;
    else kinds[block] = BLOCK_KIND_CUBE;
  }
  return kinds;
})();

/**
 * Per block flags for the row occupancy masks. An occluder hides the face of any
 * block pressed against it and darkens the ambient occlusion around it (every
 * block that is not transparent, stairs included). A cube occluder additionally emits no faces of its own once all six
 * neighbors are occluders, which is what lets buried cells be skipped.
 */
export const ROW_FLAG_SOLID = 1;
export const ROW_FLAG_OCCLUDER = 2;
export const ROW_FLAG_CUBE_OCCLUDER = 4;

export const BLOCK_ROW_FLAGS = (() => {
  const flags = new Uint8Array(BLOCK_ID_COUNT);
  for (let block = 0; block < BLOCK_ID_COUNT; block++) {
    const isOccluder = OCCLUDES_AMBIENT_LIGHT[block] === 1;
    flags[block] =
      (block !== BlockType.AIR ? ROW_FLAG_SOLID : 0) |
      (isOccluder ? ROW_FLAG_OCCLUDER : 0) |
      (isOccluder && BLOCK_KIND[block] === BLOCK_KIND_CUBE ? ROW_FLAG_CUBE_OCCLUDER : 0);
  }
  return flags;
})();

// A texture index of 0 is the invalid texture, so a falsy face texture falls back
// to the side texture and then the default, as the face tables always did.
function buildFaceTextureLookup(
  faceKey: "TOP_FACE" | "BOTTOM_FACE" | "FRONT_FACE" | "BACK_FACE" | "LEFT_FACE" | "RIGHT_FACE",
  fallsBackToSides: boolean
): Uint8Array {
  const lookup = new Uint8Array(BLOCK_ID_COUNT);
  for (let block = 0; block < BLOCK_ID_COUNT; block++) {
    const textures = BLOCK_TEXTURES[block];
    if (!textures) continue;
    const defaultTexture = textures.DEFAULT ?? 0;
    const faceTexture = textures[faceKey];
    if (faceTexture) lookup[block] = faceTexture;
    else if (fallsBackToSides && textures.SIDES) lookup[block] = textures.SIDES;
    else lookup[block] = defaultTexture;
  }
  return lookup;
}

// Face order: up, down, front (+z), back (-z), left (-x), right (+x).
export const FACE_UP = 0;
export const FACE_DOWN = 1;
export const FACE_FRONT = 2;
export const FACE_BACK = 3;
export const FACE_LEFT = 4;
export const FACE_RIGHT = 5;
export const FACE_COUNT = 6;

export const FACE_TEXTURES = [
  buildFaceTextureLookup("TOP_FACE", false),
  buildFaceTextureLookup("BOTTOM_FACE", false),
  buildFaceTextureLookup("FRONT_FACE", true),
  buildFaceTextureLookup("BACK_FACE", true),
  buildFaceTextureLookup("LEFT_FACE", true),
  buildFaceTextureLookup("RIGHT_FACE", true),
];

export const FACE_NORMALS: number[][] = [
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
  [-1, 0, 0],
  [1, 0, 0],
];

export const FACE_NEIGHBOR_DELTAS = Int32Array.from(
  FACE_NORMALS.map(([deltaX, deltaY, deltaZ]) => paddedDelta(deltaX, deltaY, deltaZ))
);

// Corner flags per face: x, y (0 = bottom of the block, 1 = top), z.
const FACE_CORNERS: number[][][] = [
  [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]],
  [[1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0]],
  [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]],
  [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]],
  [[0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1]],
  [[1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0]],
];

/** Flag of corner c of face f along axis a is at index (f * 4 + c) * 3 + a. */
export const FACE_CORNER_FLAGS = Uint8Array.from(FACE_CORNERS.flat(2));

/**
 * Texture orientation per face. The u axis and v axis are the two axes the face
 * spans; "forward" means the coordinate grows with the corner flag along that
 * axis. Side faces run v downward from the top of the block.
 */
/**
 * Per face and corner (at face * 4 + corner): the corner's flags as a mask over a
 * packed (x, y, z) size word, and whether its u and v take the far end of their range.
 */
export const CORNER_SIZE_MASKS = new Int32Array(FACE_COUNT * 4);
export const CORNER_U_AT_FAR_END = new Uint8Array(FACE_COUNT * 4);
export const CORNER_V_AT_FAR_END = new Uint8Array(FACE_COUNT * 4);

export const FACE_U_AXIS = Uint8Array.from([0, 0, 0, 0, 2, 2]);
export const FACE_U_FORWARD = Uint8Array.from([0, 1, 0, 1, 1, 0]);
export const FACE_V_AXIS = Uint8Array.from([2, 2, 1, 1, 1, 1]);
export const FACE_V_FORWARD = Uint8Array.from([1, 0, 0, 0, 0, 0]);

const POSITION_AXIS_MASK = (1 << POSITION_AXIS_BITS) - 1;
for (let face = 0; face < FACE_COUNT; face++) {
  for (let corner = 0; corner < 4; corner++) {
    const base = (face * 4 + corner) * 3;
    CORNER_SIZE_MASKS[face * 4 + corner] =
      (FACE_CORNER_FLAGS[base] ? POSITION_AXIS_MASK : 0) |
      (FACE_CORNER_FLAGS[base + 1] ? POSITION_AXIS_MASK << POSITION_Y_SHIFT : 0) |
      (FACE_CORNER_FLAGS[base + 2] ? POSITION_AXIS_MASK << POSITION_Z_SHIFT : 0);
    const isUFlagSet = FACE_CORNER_FLAGS[base + FACE_U_AXIS[face]] === 1;
    CORNER_U_AT_FAR_END[face * 4 + corner] = isUFlagSet === (FACE_U_FORWARD[face] === 1) ? 1 : 0;
    CORNER_V_AT_FAR_END[face * 4 + corner] = FACE_CORNER_FLAGS[base + FACE_V_AXIS[face]];
  }
}

// Greedy merging walks each face direction as slices of rows of cells. Slice, row
// and cell axes (0 = x, 1 = y, 2 = z) of each face's grid.
export const SLICE_AXIS_OF_FACE = Uint8Array.from([1, 1, 2, 2, 0, 0]);
export const ROW_AXIS_OF_FACE = Uint8Array.from([0, 0, 0, 0, 1, 1]);
export const CELL_AXIS_OF_FACE = Uint8Array.from([2, 2, 1, 1, 2, 2]);

/**
 * For each face, the corner pairs that differ only along the cell axis (merging
 * along cells needs those values to agree) and only along the row axis, as four
 * corner indices each at face * 4.
 */
function buildCornerPairs(axisOfFace: Uint8Array, otherAxisOfFace: Uint8Array): Uint8Array {
  const pairs = new Uint8Array(FACE_COUNT * 4);
  for (let face = 0; face < FACE_COUNT; face++) {
    const found: number[] = [];
    for (let first = 0; first < 4; first++) {
      for (let second = first + 1; second < 4; second++) {
        const firstBase = (face * 4 + first) * 3;
        const secondBase = (face * 4 + second) * 3;
        const varyingAxis = axisOfFace[face];
        const fixedAxis = otherAxisOfFace[face];
        if (
          FACE_CORNER_FLAGS[firstBase + varyingAxis] !== FACE_CORNER_FLAGS[secondBase + varyingAxis] &&
          FACE_CORNER_FLAGS[firstBase + fixedAxis] === FACE_CORNER_FLAGS[secondBase + fixedAxis]
        ) {
          found.push(first, second);
        }
      }
    }
    pairs.set(found, face * 4);
  }
  return pairs;
}

export const MERGE_ALONG_CELLS = 1;
export const MERGE_ALONG_ROWS = 2;

export const CELL_AXIS_CORNER_PAIRS = buildCornerPairs(CELL_AXIS_OF_FACE, ROW_AXIS_OF_FACE);
export const ROW_AXIS_CORNER_PAIRS = buildCornerPairs(ROW_AXIS_OF_FACE, CELL_AXIS_OF_FACE);

export const FACE_KIND_UP = 0;
export const FACE_KIND_DOWN = 1;
export const FACE_KIND_SIDE = 2;
export const FACE_KINDS = [FACE_KIND_UP, FACE_KIND_DOWN, FACE_KIND_SIDE, FACE_KIND_SIDE, FACE_KIND_SIDE, FACE_KIND_SIDE];

function isFaceCulled(block: number, neighbor: number, faceKind: number): boolean {
  if (neighbor === BlockType.AIR) return false;

  // If I am a bottom slab, my top face is never covered by the block above
  if (faceKind === FACE_KIND_UP && IS_SLAB[block] && !IS_TOP_SLAB[block]) return false;

  // If I am a top slab, my bottom face is never covered by the block below
  if (faceKind === FACE_KIND_DOWN && IS_TOP_SLAB[block]) return false;

  // If the neighbor below is a bottom slab, it never covers my bottom face
  if (faceKind === FACE_KIND_DOWN && IS_SLAB[neighbor] && !IS_TOP_SLAB[neighbor]) return false;

  // If the neighbor above is a top slab, it never covers my top face
  if (faceKind === FACE_KIND_UP && IS_TOP_SLAB[neighbor]) return false;

  if (!IS_TRANSPARENT[neighbor]) return true;

  if (IS_SLAB[block] && IS_SLAB[neighbor]) {
    // Slabs only cull each other on the sides if they are the same type (both top or both bottom)
    if (faceKind === FACE_KIND_SIDE) {
      return IS_TOP_SLAB[block] === IS_TOP_SLAB[neighbor];
    }
  }

  if (IS_WATER[block] && IS_WATER[neighbor]) return true;
  if (block === BlockType.GLASS && neighbor === BlockType.GLASS) return true;

  return false;
}

const CULL_NOT_COMPUTED = -1;
const faceCullMemo = new Int8Array(3 * BLOCK_ID_COUNT * BLOCK_ID_COUNT).fill(CULL_NOT_COMPUTED);

/** isFaceCulled, remembered per block pair: a chunk only ever sees a handful of distinct pairs. */
export function isFaceCulledMemoized(block: number, neighbor: number, faceKind: number): boolean {
  const memoIndex = (faceKind * BLOCK_ID_COUNT + block) * BLOCK_ID_COUNT + neighbor;
  let culled = faceCullMemo[memoIndex];
  if (culled === CULL_NOT_COMPUTED) {
    culled = isFaceCulled(block, neighbor, faceKind) ? 1 : 0;
    faceCullMemo[memoIndex] = culled;
  }
  return culled === 1;
}

export const LIGHT_LEVEL_OF_PACKED_LIGHT = (() => {
  const lookup = new Uint8Array(BLOCK_ID_COUNT);
  for (let packed = 0; packed < BLOCK_ID_COUNT; packed++) {
    lookup[packed] = Math.max((packed >> 4) & 0xf, packed & 0xf);
  }
  return lookup;
})();

const MAX_LIGHT_SUM = 64;

/** Vertex light in quarter levels: index count * 64 + sum of the averaged cells' levels. */
export const VERTEX_LIGHT_STEPS = (() => {
  const steps = new Uint8Array(5 * MAX_LIGHT_SUM);
  for (let count = 1; count <= 4; count++) {
    for (let sum = 0; sum < MAX_LIGHT_SUM; sum++) {
      steps[count * MAX_LIGHT_SUM + sum] = Math.round((sum * LIGHT_STEPS_PER_LEVEL) / count);
    }
  }
  return steps;
})();
export const VERTEX_LIGHT_SUM_STRIDE = MAX_LIGHT_SUM;

// Around the neighbor cell a face looks at there are eight cells in the face plane.
// Ambient occlusion and vertex light of each corner come from the two side cells and
// the diagonal cell touching that corner; those are indices into the ring.
const RING_CELL_COUNT = 8;

function ringSteps(): Array<[number, number]> {
  const steps: Array<[number, number]> = [];
  for (let first = -1; first <= 1; first++) {
    for (let second = -1; second <= 1; second++) {
      if (first !== 0 || second !== 0) steps.push([first, second]);
    }
  }
  return steps;
}

const RING_STEPS = ringSteps();

function tangentAxesOf(normal: number[]): [number, number] {
  const [firstTangent, secondTangent] = [0, 1, 2].filter((axis) => normal[axis] === 0);
  return [firstTangent, secondTangent];
}

export const FACE_RING_DELTAS = (() => {
  const deltas = new Int32Array(FACE_COUNT * RING_CELL_COUNT);
  FACE_NORMALS.forEach((normal, face) => {
    const [firstTangent, secondTangent] = tangentAxesOf(normal);
    RING_STEPS.forEach(([firstStep, secondStep], ring) => {
      const offset = [...normal];
      offset[firstTangent] += firstStep;
      offset[secondTangent] += secondStep;
      deltas[face * RING_CELL_COUNT + ring] = paddedDelta(offset[0], offset[1], offset[2]);
    });
  });
  return deltas;
})();

/**
 * Where each ring cell sits in the occupancy rows: the row index offset (x * 34 + y)
 * and the shift along z, for the cell at ring index r of face f at f * 8 + r.
 */
export const RING_ROW_DELTAS = new Int32Array(FACE_COUNT * RING_CELL_COUNT);
export const RING_Z_OFFSETS = new Int8Array(FACE_COUNT * RING_CELL_COUNT);
FACE_NORMALS.forEach((normal, face) => {
  const [firstTangent, secondTangent] = tangentAxesOf(normal);
  RING_STEPS.forEach(([firstStep, secondStep], ring) => {
    const offset = [...normal];
    offset[firstTangent] += firstStep;
    offset[secondTangent] += secondStep;
    RING_ROW_DELTAS[face * RING_CELL_COUNT + ring] = offset[0] * PADDED_ROWS + offset[1];
    RING_Z_OFFSETS[face * RING_CELL_COUNT + ring] = offset[2];
  });
});

/** For corner c of face f: ring indices of the first side, second side and diagonal cell, at (f * 4 + c) * 3. */
export const CORNER_RING_INDICES = (() => {
  const indices = new Uint8Array(FACE_COUNT * 4 * 3);
  const ringIndexOf = (firstStep: number, secondStep: number) =>
    RING_STEPS.findIndex(([first, second]) => first === firstStep && second === secondStep);
  FACE_NORMALS.forEach((normal, face) => {
    const [firstTangent, secondTangent] = tangentAxesOf(normal);
    FACE_CORNERS[face].forEach((corner, cornerIndex) => {
      const firstStep = corner[firstTangent] === 1 ? 1 : -1;
      const secondStep = corner[secondTangent] === 1 ? 1 : -1;
      const base = (face * 4 + cornerIndex) * 3;
      indices[base] = ringIndexOf(firstStep, 0);
      indices[base + 1] = ringIndexOf(0, secondStep);
      indices[base + 2] = ringIndexOf(firstStep, secondStep);
    });
  });
  return indices;
})();

/**
 * Per padded cell, one bit per face direction the cell lies beyond. A cell beyond
 * one face has light only if that neighbor chunk's light was provided; a cell
 * beyond two faces (diagonal across a chunk edge) never has any.
 */
export const OUTSIDE_FACE_FLAGS = (() => {
  const flags = new Uint8Array(PADDED_COLUMNS * STRIDE_X);
  for (let paddedX = 0; paddedX < PADDED_COLUMNS; paddedX++) {
    for (let paddedY = 0; paddedY < PADDED_ROWS; paddedY++) {
      for (let cellZ = -Z_PADDING; cellZ < CHUNK_LENGTH + Z_PADDING; cellZ++) {
        const x = paddedX - 1;
        const y = paddedY - 1;
        let outside = 0;
        if (y >= CHUNK_HEIGHT) outside |= 1 << FACE_UP;
        if (y < 0) outside |= 1 << FACE_DOWN;
        if (cellZ >= CHUNK_LENGTH) outside |= 1 << FACE_FRONT;
        if (cellZ < 0) outside |= 1 << FACE_BACK;
        if (x < 0) outside |= 1 << FACE_LEFT;
        if (x >= CHUNK_WIDTH) outside |= 1 << FACE_RIGHT;
        flags[paddedX * STRIDE_X + paddedY * STRIDE_Y + cellZ + Z_PADDING] = outside;
      }
    }
  }
  return flags;
})();
