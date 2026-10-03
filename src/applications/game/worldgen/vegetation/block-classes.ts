// Lookup tables over block ids, used to decide what plants and trees may
// overwrite while they are stamped into freshly generated terrain.

import {
  BlockType,
  isCrop,
  isCrossBlock,
  isFlatQuad,
} from "@/applications/game/blocks";

function buildLookup(predicate: (block: BlockType) => boolean): Uint8Array {
  const lookup = new Uint8Array(256);
  for (let block = 0; block < 256; block++) lookup[block] = predicate(block) ? 1 : 0;
  return lookup;
}

const LEAF_BLOCK_IDS = Object.entries(BlockType)
  .filter(([name, id]) => typeof id === "number" && name.startsWith("LEAVES"))
  .map(([, id]) => id as number);

const SOIL_BLOCK_IDS: number[] = [
  BlockType.DIRT, BlockType.HUMUS, BlockType.COARSE_DIRT, BlockType.PODZOL, BlockType.MOSS,
  BlockType.MUD, BlockType.PEAT, BlockType.GRASS, BlockType.GRASS_LUSH, BlockType.GRASS_DRY,
  BlockType.GRASS_COLD, BlockType.GRASS_SNOWY, BlockType.GRASS_MEADOW,
];

const GRASSY_BLOCK_IDS: number[] = [
  BlockType.GRASS, BlockType.GRASS_LUSH, BlockType.GRASS_DRY, BlockType.GRASS_COLD,
  BlockType.GRASS_SNOWY, BlockType.GRASS_MEADOW, BlockType.PODZOL, BlockType.MOSS,
  BlockType.DIRT, BlockType.COARSE_DIRT, BlockType.HUMUS, BlockType.MUD, BlockType.PEAT,
];

const SANDY_BLOCK_IDS: number[] = [BlockType.SAND, BlockType.RED_SAND];

export const IS_LEAF = buildLookup((block) => LEAF_BLOCK_IDS.includes(block));
export const IS_SOIL = buildLookup((block) => SOIL_BLOCK_IDS.includes(block));
export const IS_PLANT = buildLookup((block) => isCrossBlock(block) || isFlatQuad(block) || isCrop(block));
export const IS_PLANTABLE_GROUND = buildLookup((block) => GRASSY_BLOCK_IDS.includes(block));
export const IS_SANDY = buildLookup((block) => SANDY_BLOCK_IDS.includes(block));
