// Per block type LOD colours (sRGB 0xRRGGBB): the average of the texture the main renderer puts on that face. The
// game textures are pre-coloured (no biome tint in the main shader), so neither is the LOD.

import { BLOCK_TEXTURES, BlockType, Texture } from "../../blocks";
import { TEXTURE_AVERAGE_COLORS } from "./texture-average-colors.generated";

const FALLBACK_COLOR = 0x808080;
const BLOCK_TYPE_SLOTS = 256;
const textureFileNames = Object.values(Texture);

function colorOfTextureIndex(textureIndex: number | undefined): number {
  if (textureIndex === undefined) return FALLBACK_COLOR;
  const fileName = textureFileNames[textureIndex];
  const color = fileName === undefined ? undefined : TEXTURE_AVERAGE_COLORS[fileName];
  return color === undefined || color < 0 ? FALLBACK_COLOR : color;
}

function buildColorTable(faceTexture: (textures: (typeof BLOCK_TEXTURES)[number]) => number | undefined): Uint32Array {
  const table = new Uint32Array(BLOCK_TYPE_SLOTS).fill(FALLBACK_COLOR);
  for (let blockType = 0; blockType < BLOCK_TYPE_SLOTS; blockType++) {
    const textures = BLOCK_TEXTURES[blockType];
    if (textures !== undefined) table[blockType] = colorOfTextureIndex(faceTexture(textures));
  }
  return table;
}

const TOP_COLORS = buildColorTable((textures) => textures.TOP_FACE ?? textures.DEFAULT);
const SIDE_COLORS = buildColorTable((textures) => textures.SIDES ?? textures.DEFAULT);

export function topColorOfBlock(block: BlockType): number {
  return TOP_COLORS[block] ?? FALLBACK_COLOR;
}

export function sideColorOfBlock(block: BlockType): number {
  return SIDE_COLORS[block] ?? FALLBACK_COLOR;
}

export const WATER_SURFACE_COLOR = topColorOfBlock(BlockType.WATER);
