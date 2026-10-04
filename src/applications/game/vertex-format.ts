/**
 * Shared bit layout for chunk vertices and plant instances.
 *
 * A mesh vertex is two uint32 words (8 bytes):
 *   position word: x | y << 10 | z << 20 | edgeNormalAxis << 30, x y z in 1/16 block units
 *   surface word:  u | v << 7 | texture << 14 | ambientOcclusion << 22 | light << 24 | edgeOutward << 30
 *                  (u and v are 7 bits, light is in 1/4 levels, 6 bits)
 * Normals are not stored: the fragment shader never uses them.
 *
 * Edge expansion: greedy merging leaves T-junctions (a small quad's corner on a
 * big quad's edge), which rasterize with pixel-sized cracks. Cube faces carry
 * their normal axis plus one (0 = never expand) and, per corner, which way is
 * outward along the two other axes (bit 0: axis (normal + 1) % 3, bit 1: axis
 * (normal + 2) % 3, set = towards +). The opaque vertex shader pushes each
 * corner outward by a sub-pixel amount so neighboring quads overlap.
 *
 * u and v are unwrapped texture coordinates: the texture repeats every whole
 * unit and the fragment shader takes the fraction. Chunk surfaces use half
 * block units (CHUNK_UV_UNITS_PER_BLOCK), so a merged quad spans up to 32
 * blocks (value 64) and a stair step can sit at half a texture. Plant
 * templates use 1/32 texture units (PLANT_UV_UNITS_PER_TEXTURE) to address
 * individual pixels of a 16 pixel texture.
 *
 * A plant instance is one uint32:
 *   x | y << 5 | z << 10 | light << 15 | neighborMask << 19
 * where x, y, z are the block position inside the chunk and neighborMask has one
 * bit per solid neighbor in the order of PLANT_NEIGHBOR_DIRECTIONS.
 */

export const POSITION_UNITS_PER_BLOCK = 16;
export const CHUNK_UV_UNITS_PER_BLOCK = 2;
export const PLANT_UV_UNITS_PER_TEXTURE = 32;
export const MAX_MERGED_QUAD_BLOCKS = 32;
export const WORDS_PER_VERTEX = 2;
export const VERTICES_PER_QUAD = 4;
export const INDICES_PER_QUAD = 6;

export const POSITION_AXIS_BITS = 10;
export const POSITION_Y_SHIFT = POSITION_AXIS_BITS;
export const POSITION_Z_SHIFT = POSITION_AXIS_BITS * 2;

export const UV_BITS = 7;
export const SURFACE_V_SHIFT = UV_BITS;
export const SURFACE_TEXTURE_SHIFT = UV_BITS * 2;
export const SURFACE_TEXTURE_BITS = 8;
export const SURFACE_OCCLUSION_SHIFT =
  SURFACE_TEXTURE_SHIFT + SURFACE_TEXTURE_BITS;
export const SURFACE_OCCLUSION_BITS = 2;
export const SURFACE_LIGHT_SHIFT =
  SURFACE_OCCLUSION_SHIFT + SURFACE_OCCLUSION_BITS;
export const SURFACE_LIGHT_BITS = 4;
/** Vertex light is averaged across neighboring cells, so it carries quarter levels. */
export const LIGHT_STEPS_PER_LEVEL = 4;
export const SURFACE_LIGHT_STEP_BITS = SURFACE_LIGHT_BITS + 2;

export const EDGE_NORMAL_AXIS_SHIFT = 30;
export const EDGE_OUTWARD_SHIFT = 30;

export const PLANT_INSTANCE_COORDINATE_BITS = 5;
export const PLANT_INSTANCE_Y_SHIFT = PLANT_INSTANCE_COORDINATE_BITS;
export const PLANT_INSTANCE_Z_SHIFT = PLANT_INSTANCE_COORDINATE_BITS * 2;
export const PLANT_INSTANCE_LIGHT_SHIFT = PLANT_INSTANCE_COORDINATE_BITS * 3;
export const PLANT_INSTANCE_MASK_SHIFT =
  PLANT_INSTANCE_LIGHT_SHIFT + SURFACE_LIGHT_BITS;
export const PLANT_NEIGHBOR_COUNT = 6;

/** Bit i of an instance's neighbor mask is set when the block in direction i is solid. */
export const PLANT_NEIGHBOR_DIRECTIONS: ReadonlyArray<
  readonly [number, number, number]
> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export function packPositionWord(
  x16: number,
  y16: number,
  z16: number,
): number {
  return x16 | (y16 << POSITION_Y_SHIFT) | (z16 << POSITION_Z_SHIFT);
}

export function packSurfaceWord(
  u: number,
  v: number,
  textureIndex: number,
  ambientOcclusion: number,
  lightSteps: number,
): number {
  return (
    u |
    (v << SURFACE_V_SHIFT) |
    (textureIndex << SURFACE_TEXTURE_SHIFT) |
    (ambientOcclusion << SURFACE_OCCLUSION_SHIFT) |
    (lightSteps << SURFACE_LIGHT_SHIFT)
  );
}

export function packPlantInstance(
  blockX: number,
  blockY: number,
  blockZ: number,
  light: number,
  neighborMask: number,
): number {
  return (
    blockX |
    (blockY << PLANT_INSTANCE_Y_SHIFT) |
    (blockZ << PLANT_INSTANCE_Z_SHIFT) |
    (light << PLANT_INSTANCE_LIGHT_SHIFT) |
    (neighborMask << PLANT_INSTANCE_MASK_SHIFT)
  );
}

/**
 * The outward direction of a vertex in the plane of its face, as the vertex
 * shader reads it (each component -1, 0 or 1), or null when it never expands.
 */
export function unpackEdgeOutward(
  positionWord: number,
  surfaceWord: number,
): [number, number, number] | null {
  const normalAxisCode = (positionWord >>> EDGE_NORMAL_AXIS_SHIFT) & 3;
  if (normalAxisCode === 0) return null;
  const normalAxis = normalAxisCode - 1;
  const outward: [number, number, number] = [0, 0, 0];
  const outwardBits = (surfaceWord >>> EDGE_OUTWARD_SHIFT) & 3;
  outward[(normalAxis + 1) % 3] = outwardBits & 1 ? 1 : -1;
  outward[(normalAxis + 2) % 3] = outwardBits & 2 ? 1 : -1;
  return outward;
}

export interface UnpackedVertex {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
  textureIndex: number;
  ambientOcclusion: number;
  light: number;
}

/** Block-unit vertex values, for tests and debugging. */
export function unpackVertex(
  positionWord: number,
  surfaceWord: number,
  uvUnitsPerTexture: number = CHUNK_UV_UNITS_PER_BLOCK,
): UnpackedVertex {
  const axisMask = (1 << POSITION_AXIS_BITS) - 1;
  const uvMask = (1 << UV_BITS) - 1;
  return {
    x: (positionWord & axisMask) / POSITION_UNITS_PER_BLOCK,
    y:
      ((positionWord >>> POSITION_Y_SHIFT) & axisMask) /
      POSITION_UNITS_PER_BLOCK,
    z:
      ((positionWord >>> POSITION_Z_SHIFT) & axisMask) /
      POSITION_UNITS_PER_BLOCK,
    u: (surfaceWord & uvMask) / uvUnitsPerTexture,
    v: ((surfaceWord >>> SURFACE_V_SHIFT) & uvMask) / uvUnitsPerTexture,
    textureIndex:
      (surfaceWord >>> SURFACE_TEXTURE_SHIFT) &
      ((1 << SURFACE_TEXTURE_BITS) - 1),
    ambientOcclusion:
      (surfaceWord >>> SURFACE_OCCLUSION_SHIFT) &
      ((1 << SURFACE_OCCLUSION_BITS) - 1),
    light:
      ((surfaceWord >>> SURFACE_LIGHT_SHIFT) &
        ((1 << SURFACE_LIGHT_STEP_BITS) - 1)) /
      LIGHT_STEPS_PER_LEVEL,
  };
}
