// LOD vertex: 8 bytes, two uint32 words read by the shader as one `uvec2` attribute.
//   word 0: x (6 bits, tile cells 0..32) | z (6 bits) | y + Y_BIAS (10 bits, blocks) | face (3) | ambient occlusion (2) | sky light (4)
//   word 1: sRGB colour 0xRRGGBB (24 bits) | material (8 bits)
// Positions are in cells; the tile mesh's object transform scales x and z by the cell size and moves it to the tile
// origin, so one format serves every level.

export const LOD_VERTEX_WORDS = 2;
export const LOD_VERTEX_BYTES = LOD_VERTEX_WORDS * 4;

export const POSITION_BITS = 6;
export const Z_SHIFT = 6;
export const Y_SHIFT = 12;
export const Y_BITS = 10;
export const Y_BIAS = 64;
export const FACE_SHIFT = 22;
export const FACE_BITS = 3;
export const OCCLUSION_SHIFT = 25;
export const OCCLUSION_BITS = 2;
export const LIGHT_SHIFT = 27;
export const LIGHT_BITS = 4;
export const MATERIAL_SHIFT = 24;

export enum LodFace {
  Up = 0,
  PositiveX = 1,
  NegativeX = 2,
  PositiveZ = 3,
  NegativeZ = 4,
}

export enum LodMaterial {
  Terrain = 0,
  Water = 1,
}

export const MAXIMUM_SKY_LIGHT = 15;
export const MAXIMUM_OCCLUSION = 3;

export function encodeVertexWord0(cellX: number, blockY: number, cellZ: number, face: LodFace, occlusion: number, light: number): number {
  return (
    (cellX |
      (cellZ << Z_SHIFT) |
      ((blockY + Y_BIAS) << Y_SHIFT) |
      (face << FACE_SHIFT) |
      (occlusion << OCCLUSION_SHIFT) |
      (light << LIGHT_SHIFT)) >>>
    0
  );
}

export function encodeVertexWord1(color: number, material: LodMaterial): number {
  return ((color & 0xffffff) | (material << MATERIAL_SHIFT)) >>> 0;
}

export interface DecodedLodVertex {
  cellX: number;
  cellZ: number;
  blockY: number;
  face: LodFace;
  occlusion: number;
  light: number;
  color: number;
  material: LodMaterial;
}

export function decodeLodVertex(word0: number, word1: number): DecodedLodVertex {
  const mask = (bits: number) => (1 << bits) - 1;
  return {
    cellX: word0 & mask(POSITION_BITS),
    cellZ: (word0 >>> Z_SHIFT) & mask(POSITION_BITS),
    blockY: ((word0 >>> Y_SHIFT) & mask(Y_BITS)) - Y_BIAS,
    face: (word0 >>> FACE_SHIFT) & mask(FACE_BITS),
    occlusion: (word0 >>> OCCLUSION_SHIFT) & mask(OCCLUSION_BITS),
    light: (word0 >>> LIGHT_SHIFT) & mask(LIGHT_BITS),
    color: word1 & 0xffffff,
    material: word1 >>> MATERIAL_SHIFT,
  };
}
