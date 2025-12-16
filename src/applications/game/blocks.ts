// This file is auto-generated. Do not edit manually.
// Edit the JSON files in src/applications/game/data/blocks/ instead.

export enum BlockType {
  AIR = 0,
  DIRT = 1,
  HUMUS = 2,
  SILT = 3,
  CLAY = 4,
  GRAVEL = 5,
  GRANITE = 6,
  CALCITE = 7,
  COMPACT_GRAVEL = 8,
  PHYLLITE = 9,
  SHALE = 10,
  STONE = 11,
  COBBLESTONE = 12,
  SAND = 13,
  MARBLE = 14,
  LEAVES = 15,
  WATER = 16,
  DECORATIVE_GLASS = 17,
  GLASS = 18,
  GRASS = 19,
  PLANKS = 20,
  LOG = 21,
  PLANKS_SLAB = 22,
  COBBLESTONE_SLAB = 23,
  STONE_SLAB = 24,
  PLANKS_SLAB_TOP = 25,
  COBBLESTONE_SLAB_TOP = 26,
  STONE_SLAB_TOP = 27,
  TALL_GRASS = 28,
  ANEMONE_FLOWER = 29,
  PONPON_FLOWER = 30,
  SAPLING = 31,
  BELLIS_FLOWER = 32,
  FORGETMENOTS_FLOWER = 33,
  WATER_LEVEL_1 = 34,
  WATER_LEVEL_2 = 35,
  WATER_LEVEL_3 = 36,
  WATER_LEVEL_4 = 37,
  WATER_LEVEL_5 = 38,
  WATER_LEVEL_6 = 39,
  WATER_LEVEL_7 = 40,
  WATER_FALLING = 41,
  PLANKS_STAIRS_NORTH = 50,
  PLANKS_STAIRS_SOUTH = 51,
  PLANKS_STAIRS_EAST = 52,
  PLANKS_STAIRS_WEST = 53,
  GLOWSTONE = 54,
}

export function isWater(block: BlockType): boolean {
  return (
    block === BlockType.WATER ||
    block === BlockType.WATER_LEVEL_1 ||
    block === BlockType.WATER_LEVEL_2 ||
    block === BlockType.WATER_LEVEL_3 ||
    block === BlockType.WATER_LEVEL_4 ||
    block === BlockType.WATER_LEVEL_5 ||
    block === BlockType.WATER_LEVEL_6 ||
    block === BlockType.WATER_LEVEL_7 ||
    block === BlockType.WATER_FALLING
  );
}

export function getWaterLevel(block: BlockType): number {
  if (block === BlockType.WATER) return 8;
  if (block === BlockType.WATER_LEVEL_1) return 1;
  if (block === BlockType.WATER_LEVEL_2) return 2;
  if (block === BlockType.WATER_LEVEL_3) return 3;
  if (block === BlockType.WATER_LEVEL_4) return 4;
  if (block === BlockType.WATER_LEVEL_5) return 5;
  if (block === BlockType.WATER_LEVEL_6) return 6;
  if (block === BlockType.WATER_LEVEL_7) return 7;
  if (block === BlockType.WATER_FALLING) return 8;
  return 0;
}

export function getBlockLightLevel(block: BlockType): number {
  if (block === BlockType.GLOWSTONE) return 15;
  return 0;
}

export function isReplaceable(block: BlockType): boolean {
  return (
    block === BlockType.WATER ||
    block === BlockType.TALL_GRASS ||
    block === BlockType.WATER_LEVEL_1 ||
    block === BlockType.WATER_LEVEL_2 ||
    block === BlockType.WATER_LEVEL_3 ||
    block === BlockType.WATER_LEVEL_4 ||
    block === BlockType.WATER_LEVEL_5 ||
    block === BlockType.WATER_LEVEL_6 ||
    block === BlockType.WATER_LEVEL_7 ||
    block === BlockType.WATER_FALLING
  );
}

export function isSlab(block: BlockType): boolean {
  return (
    block === BlockType.PLANKS_SLAB ||
    block === BlockType.COBBLESTONE_SLAB ||
    block === BlockType.STONE_SLAB ||
    block === BlockType.PLANKS_SLAB_TOP ||
    block === BlockType.COBBLESTONE_SLAB_TOP ||
    block === BlockType.STONE_SLAB_TOP
  );
}

export function isTopSlab(block: BlockType): boolean {
  return (
    block === BlockType.PLANKS_SLAB_TOP ||
    block === BlockType.COBBLESTONE_SLAB_TOP ||
    block === BlockType.STONE_SLAB_TOP
  );
}

export function isCrossBlock(block: BlockType): boolean {
  return (
    block === BlockType.TALL_GRASS ||
    block === BlockType.ANEMONE_FLOWER ||
    block === BlockType.PONPON_FLOWER ||
    block === BlockType.SAPLING
  );
}

export function isFlatQuad(block: BlockType): boolean {
  return (
    block === BlockType.BELLIS_FLOWER
  );
}

export function isCrop(block: BlockType): boolean {
  return (
    block === BlockType.FORGETMENOTS_FLOWER
  );
}

export function isStairs(block: BlockType): boolean {
  return (
    block === BlockType.PLANKS_STAIRS_NORTH ||
    block === BlockType.PLANKS_STAIRS_SOUTH ||
    block === BlockType.PLANKS_STAIRS_EAST ||
    block === BlockType.PLANKS_STAIRS_WEST
  );
}

export function getDirection(block: BlockType): "NORTH" | "SOUTH" | "EAST" | "WEST" | null {
  switch (block) {
    case BlockType.PLANKS_STAIRS_NORTH: return "NORTH";
    case BlockType.PLANKS_STAIRS_SOUTH: return "SOUTH";
    case BlockType.PLANKS_STAIRS_EAST: return "EAST";
    case BlockType.PLANKS_STAIRS_WEST: return "WEST";
    default: return null;
  }
}

export function getHitboxes(block: BlockType): { scale: [number, number, number]; offset: [number, number, number] }[] {
  switch (block) {
    case BlockType.PLANKS_SLAB: return [{"scale":[1.002,0.502,1.002],"offset":[0,-0.25,0]}];
    case BlockType.COBBLESTONE_SLAB: return [{"scale":[1.002,0.502,1.002],"offset":[0,-0.25,0]}];
    case BlockType.STONE_SLAB: return [{"scale":[1.002,0.502,1.002],"offset":[0,-0.25,0]}];
    case BlockType.PLANKS_SLAB_TOP: return [{"scale":[1.002,0.502,1.002],"offset":[0,0.25,0]}];
    case BlockType.COBBLESTONE_SLAB_TOP: return [{"scale":[1.002,0.502,1.002],"offset":[0,0.25,0]}];
    case BlockType.STONE_SLAB_TOP: return [{"scale":[1.002,0.502,1.002],"offset":[0,0.25,0]}];
    case BlockType.ANEMONE_FLOWER: return [{"scale":[0.6,1.002,0.6],"offset":[0,0,0]}];
    case BlockType.SAPLING: return [{"scale":[0.6,1.002,0.6],"offset":[0,0,0]}];
    case BlockType.BELLIS_FLOWER: return [{"scale":[1.002,0.08,1.002],"offset":[0,-0.46,0]}];
    case BlockType.FORGETMENOTS_FLOWER: return [{"scale":[0.6,1.002,0.6],"offset":[0,0,0]}];
    case BlockType.PLANKS_STAIRS_NORTH: return [{"scale":[1.002,0.502,1.002],"offset":[0,-0.25,0]},{"scale":[1.002,0.502,0.502],"offset":[0,0.25,-0.25]}];
    case BlockType.PLANKS_STAIRS_SOUTH: return [{"scale":[1.002,0.502,1.002],"offset":[0,-0.25,0]},{"scale":[1.002,0.502,0.502],"offset":[0,0.25,0.25]}];
    case BlockType.PLANKS_STAIRS_EAST: return [{"scale":[1.002,0.502,1.002],"offset":[0,-0.25,0]},{"scale":[0.502,0.502,1.002],"offset":[0.25,0.25,0]}];
    case BlockType.PLANKS_STAIRS_WEST: return [{"scale":[1.002,0.502,1.002],"offset":[0,-0.25,0]},{"scale":[0.502,0.502,1.002],"offset":[-0.25,0.25,0]}];
    default: return [{ scale: [1.002, 1.002, 1.002], offset: [0, 0, 0] }];
  }
}

export function getBoundingBox(block: BlockType): { scale: [number, number, number]; offset: [number, number, number] } {
  const boxes = getHitboxes(block);
  if (boxes.length === 0) return { scale: [1.002, 1.002, 1.002], offset: [0, 0, 0] };
  // Return full block for simplicity in highlighter for now
  return { scale: [1.002, 1.002, 1.002], offset: [0, 0, 0] };
}

export const Texture = {
  INVALID: "invalid.png",
  DIRT: "dirt.png",
  HUMUS: "humus.png",
  SILT: "silt.png",
  CLAY: "clay.png",
  GRAVEL: "gravel.png",
  GRANITE: "granite.png",
  CALCITE: "calcite.png",
  COMPACT_GRAVEL: "compact_gravel.png",
  PHYLLITE: "phyllite.png",
  SHALE: "shale.png",
  STONE: "stone.png",
  COBBLESTONE: "cobblestone.png",
  SAND: "sand.png",
  MARBLE: "marble.png",
  LEAVES: "leaves.png",
  WATER: "water.png",
  DECORATIVE_GLASS: "decorative_glass.png",
  GLASS: "glass.png",
  GRASS_SIDE: "grass_side.png",
  GRASS_TOP: "grass_top.png",
  PLANKS: "planks.png",
  LOG_TOP_BOTTOM: "log_top_bottom.png",
  LOG_SIDE: "log_side.png",
  TALL_GRASS: "tall_grass.png",
  FLOWER_ANEMONE: "flower_anemone.png",
  FLOWER_PONPON: "flower_ponpon.png",
  SAPLING: "sapling.png",
  FLOWER_BELLIS: "flower_bellis.png",
  FLOWER_FORGETMENOTS: "flower_forgetmenots.png",
};

export const LOADING_SCREEN_TEXTURES = [

  "dirt.png",
  "humus.png",
  "silt.png",
  "clay.png",
  "gravel.png",
  "granite.png",
  "calcite.png",
  "compact_gravel.png",
  "phyllite.png",
  "shale.png",
  "stone.png",
  "cobblestone.png",
  "sand.png",
  "marble.png",
  "leaves.png",
  "water.png",
  "decorative_glass.png",
  "glass.png",
  "grass_side.png",
  "grass_top.png",
  "planks.png",
  "log_top_bottom.png",
  "log_side.png",
  "tall_grass.png",
  "flower_anemone.png",
  "flower_ponpon.png",
  "sapling.png",
  "flower_bellis.png",
  "flower_forgetmenots.png",
];

function getTextureIndexByName(name: string): number {
  const keys = Object.keys(Texture);

  for (let i = 0; i < keys.length; i++) {
    if (keys[i] === name.toUpperCase()) return i;
  }

  return 0;
}

export let BLOCK_TEXTURES: {
  [type: number]: {
    DEFAULT: number;
    SIDES?: number;
    TOP_FACE?: number;
    BOTTOM_FACE?: number;
    LEFT_FACE?: number;
    RIGHT_FACE?: number;
    FRONT_FACE?: number;
    BACK_FACE?: number;
  };
} = {};

BLOCK_TEXTURES[BlockType.AIR] = {
  DEFAULT: getTextureIndexByName("INVALID"),
};

BLOCK_TEXTURES[BlockType.DIRT] = {
  DEFAULT: getTextureIndexByName("DIRT"),
};

BLOCK_TEXTURES[BlockType.HUMUS] = {
  DEFAULT: getTextureIndexByName("HUMUS"),
};

BLOCK_TEXTURES[BlockType.SILT] = {
  DEFAULT: getTextureIndexByName("SILT"),
};

BLOCK_TEXTURES[BlockType.CLAY] = {
  DEFAULT: getTextureIndexByName("CLAY"),
};

BLOCK_TEXTURES[BlockType.GRAVEL] = {
  DEFAULT: getTextureIndexByName("GRAVEL"),
};

BLOCK_TEXTURES[BlockType.GRANITE] = {
  DEFAULT: getTextureIndexByName("GRANITE"),
};

BLOCK_TEXTURES[BlockType.CALCITE] = {
  DEFAULT: getTextureIndexByName("CALCITE"),
};

BLOCK_TEXTURES[BlockType.COMPACT_GRAVEL] = {
  DEFAULT: getTextureIndexByName("COMPACT_GRAVEL"),
};

BLOCK_TEXTURES[BlockType.PHYLLITE] = {
  DEFAULT: getTextureIndexByName("PHYLLITE"),
};

BLOCK_TEXTURES[BlockType.SHALE] = {
  DEFAULT: getTextureIndexByName("SHALE"),
};

BLOCK_TEXTURES[BlockType.STONE] = {
  DEFAULT: getTextureIndexByName("STONE"),
};

BLOCK_TEXTURES[BlockType.COBBLESTONE] = {
  DEFAULT: getTextureIndexByName("COBBLESTONE"),
};

BLOCK_TEXTURES[BlockType.SAND] = {
  DEFAULT: getTextureIndexByName("SAND"),
};

BLOCK_TEXTURES[BlockType.MARBLE] = {
  DEFAULT: getTextureIndexByName("MARBLE"),
};

BLOCK_TEXTURES[BlockType.LEAVES] = {
  DEFAULT: getTextureIndexByName("LEAVES"),
};

BLOCK_TEXTURES[BlockType.WATER] = {
  DEFAULT: getTextureIndexByName("WATER"),
};

BLOCK_TEXTURES[BlockType.DECORATIVE_GLASS] = {
  DEFAULT: getTextureIndexByName("DECORATIVE_GLASS"),
};

BLOCK_TEXTURES[BlockType.GLASS] = {
  DEFAULT: getTextureIndexByName("GLASS"),
};

BLOCK_TEXTURES[BlockType.GRASS] = {
  DEFAULT: getTextureIndexByName("DIRT"),
  SIDES: getTextureIndexByName("GRASS_SIDE"),
  TOP_FACE: getTextureIndexByName("GRASS_TOP"),
};

BLOCK_TEXTURES[BlockType.PLANKS] = {
  DEFAULT: getTextureIndexByName("PLANKS"),
};

BLOCK_TEXTURES[BlockType.LOG] = {
  DEFAULT: getTextureIndexByName("LOG_TOP_BOTTOM"),
  SIDES: getTextureIndexByName("LOG_SIDE"),
};

BLOCK_TEXTURES[BlockType.PLANKS_SLAB] = {
  DEFAULT: getTextureIndexByName("PLANKS"),
};

BLOCK_TEXTURES[BlockType.COBBLESTONE_SLAB] = {
  DEFAULT: getTextureIndexByName("COBBLESTONE"),
};

BLOCK_TEXTURES[BlockType.STONE_SLAB] = {
  DEFAULT: getTextureIndexByName("STONE"),
};

BLOCK_TEXTURES[BlockType.PLANKS_SLAB_TOP] = {
  DEFAULT: getTextureIndexByName("PLANKS"),
};

BLOCK_TEXTURES[BlockType.COBBLESTONE_SLAB_TOP] = {
  DEFAULT: getTextureIndexByName("COBBLESTONE"),
};

BLOCK_TEXTURES[BlockType.STONE_SLAB_TOP] = {
  DEFAULT: getTextureIndexByName("STONE"),
};

BLOCK_TEXTURES[BlockType.TALL_GRASS] = {
  DEFAULT: getTextureIndexByName("TALL_GRASS"),
};

BLOCK_TEXTURES[BlockType.ANEMONE_FLOWER] = {
  DEFAULT: getTextureIndexByName("FLOWER_ANEMONE"),
};

BLOCK_TEXTURES[BlockType.PONPON_FLOWER] = {
  DEFAULT: getTextureIndexByName("FLOWER_PONPON"),
};

BLOCK_TEXTURES[BlockType.SAPLING] = {
  DEFAULT: getTextureIndexByName("SAPLING"),
};

BLOCK_TEXTURES[BlockType.BELLIS_FLOWER] = {
  DEFAULT: getTextureIndexByName("FLOWER_BELLIS"),
};

BLOCK_TEXTURES[BlockType.FORGETMENOTS_FLOWER] = {
  DEFAULT: getTextureIndexByName("FLOWER_FORGETMENOTS"),
};

BLOCK_TEXTURES[BlockType.WATER_LEVEL_1] = {
  DEFAULT: getTextureIndexByName("WATER"),
};

BLOCK_TEXTURES[BlockType.WATER_LEVEL_2] = {
  DEFAULT: getTextureIndexByName("WATER"),
};

BLOCK_TEXTURES[BlockType.WATER_LEVEL_3] = {
  DEFAULT: getTextureIndexByName("WATER"),
};

BLOCK_TEXTURES[BlockType.WATER_LEVEL_4] = {
  DEFAULT: getTextureIndexByName("WATER"),
};

BLOCK_TEXTURES[BlockType.WATER_LEVEL_5] = {
  DEFAULT: getTextureIndexByName("WATER"),
};

BLOCK_TEXTURES[BlockType.WATER_LEVEL_6] = {
  DEFAULT: getTextureIndexByName("WATER"),
};

BLOCK_TEXTURES[BlockType.WATER_LEVEL_7] = {
  DEFAULT: getTextureIndexByName("WATER"),
};

BLOCK_TEXTURES[BlockType.WATER_FALLING] = {
  DEFAULT: getTextureIndexByName("WATER"),
};

BLOCK_TEXTURES[BlockType.PLANKS_STAIRS_NORTH] = {
  DEFAULT: getTextureIndexByName("PLANKS"),
};

BLOCK_TEXTURES[BlockType.PLANKS_STAIRS_SOUTH] = {
  DEFAULT: getTextureIndexByName("PLANKS"),
};

BLOCK_TEXTURES[BlockType.PLANKS_STAIRS_EAST] = {
  DEFAULT: getTextureIndexByName("PLANKS"),
};

BLOCK_TEXTURES[BlockType.PLANKS_STAIRS_WEST] = {
  DEFAULT: getTextureIndexByName("PLANKS"),
};

BLOCK_TEXTURES[BlockType.GLOWSTONE] = {
  DEFAULT: getTextureIndexByName("INVALID"),
};

export const TRANSPARENT_BLOCKS = [
  BlockType.AIR,
  BlockType.LEAVES,
  BlockType.WATER,
  BlockType.DECORATIVE_GLASS,
  BlockType.GLASS,
  BlockType.PLANKS_SLAB,
  BlockType.COBBLESTONE_SLAB,
  BlockType.STONE_SLAB,
  BlockType.PLANKS_SLAB_TOP,
  BlockType.COBBLESTONE_SLAB_TOP,
  BlockType.STONE_SLAB_TOP,
  BlockType.TALL_GRASS,
  BlockType.ANEMONE_FLOWER,
  BlockType.PONPON_FLOWER,
  BlockType.SAPLING,
  BlockType.BELLIS_FLOWER,
  BlockType.FORGETMENOTS_FLOWER,
  BlockType.WATER_LEVEL_1,
  BlockType.WATER_LEVEL_2,
  BlockType.WATER_LEVEL_3,
  BlockType.WATER_LEVEL_4,
  BlockType.WATER_LEVEL_5,
  BlockType.WATER_LEVEL_6,
  BlockType.WATER_LEVEL_7,
  BlockType.WATER_FALLING,
  BlockType.PLANKS_STAIRS_NORTH,
  BlockType.PLANKS_STAIRS_SOUTH,
  BlockType.PLANKS_STAIRS_EAST,
  BlockType.PLANKS_STAIRS_WEST,
];

export const TRANSLUCENT_BLOCKS = [
  BlockType.WATER,
  BlockType.DECORATIVE_GLASS,
  BlockType.GLASS,
  BlockType.WATER_LEVEL_1,
  BlockType.WATER_LEVEL_2,
  BlockType.WATER_LEVEL_3,
  BlockType.WATER_LEVEL_4,
  BlockType.WATER_LEVEL_5,
  BlockType.WATER_LEVEL_6,
  BlockType.WATER_LEVEL_7,
  BlockType.WATER_FALLING,
];

export const NON_COLLIDABLE_BLOCKS = [
  BlockType.AIR,
  BlockType.WATER,
  BlockType.TALL_GRASS,
  BlockType.ANEMONE_FLOWER,
  BlockType.PONPON_FLOWER,
  BlockType.SAPLING,
  BlockType.BELLIS_FLOWER,
  BlockType.FORGETMENOTS_FLOWER,
  BlockType.WATER_LEVEL_1,
  BlockType.WATER_LEVEL_2,
  BlockType.WATER_LEVEL_3,
  BlockType.WATER_LEVEL_4,
  BlockType.WATER_LEVEL_5,
  BlockType.WATER_LEVEL_6,
  BlockType.WATER_LEVEL_7,
  BlockType.WATER_FALLING,
];

export const BLOCK_ITEM_TEXTURES: Record<
  BlockType,
  (typeof Texture)[keyof typeof Texture]
> = {
  [BlockType.AIR]: Texture.INVALID,
  [BlockType.DIRT]: Texture.DIRT,
  [BlockType.HUMUS]: Texture.HUMUS,
  [BlockType.SILT]: Texture.SILT,
  [BlockType.CLAY]: Texture.CLAY,
  [BlockType.GRAVEL]: Texture.GRAVEL,
  [BlockType.GRANITE]: Texture.GRANITE,
  [BlockType.CALCITE]: Texture.CALCITE,
  [BlockType.COMPACT_GRAVEL]: Texture.COMPACT_GRAVEL,
  [BlockType.PHYLLITE]: Texture.PHYLLITE,
  [BlockType.SHALE]: Texture.SHALE,
  [BlockType.STONE]: Texture.STONE,
  [BlockType.COBBLESTONE]: Texture.COBBLESTONE,
  [BlockType.SAND]: Texture.SAND,
  [BlockType.MARBLE]: Texture.MARBLE,
  [BlockType.LEAVES]: Texture.LEAVES,
  [BlockType.WATER]: Texture.WATER,
  [BlockType.DECORATIVE_GLASS]: Texture.DECORATIVE_GLASS,
  [BlockType.GLASS]: Texture.GLASS,
  [BlockType.GRASS]: Texture.GRASS_SIDE,
  [BlockType.PLANKS]: Texture.PLANKS,
  [BlockType.LOG]: Texture.LOG_SIDE,
  [BlockType.PLANKS_SLAB]: Texture.PLANKS,
  [BlockType.COBBLESTONE_SLAB]: Texture.COBBLESTONE,
  [BlockType.STONE_SLAB]: Texture.STONE,
  [BlockType.PLANKS_SLAB_TOP]: Texture.PLANKS,
  [BlockType.COBBLESTONE_SLAB_TOP]: Texture.COBBLESTONE,
  [BlockType.STONE_SLAB_TOP]: Texture.STONE,
  [BlockType.TALL_GRASS]: Texture.TALL_GRASS,
  [BlockType.ANEMONE_FLOWER]: Texture.FLOWER_ANEMONE,
  [BlockType.PONPON_FLOWER]: Texture.FLOWER_PONPON,
  [BlockType.SAPLING]: Texture.SAPLING,
  [BlockType.BELLIS_FLOWER]: Texture.FLOWER_BELLIS,
  [BlockType.FORGETMENOTS_FLOWER]: Texture.FLOWER_FORGETMENOTS,
  [BlockType.WATER_LEVEL_1]: Texture.WATER,
  [BlockType.WATER_LEVEL_2]: Texture.WATER,
  [BlockType.WATER_LEVEL_3]: Texture.WATER,
  [BlockType.WATER_LEVEL_4]: Texture.WATER,
  [BlockType.WATER_LEVEL_5]: Texture.WATER,
  [BlockType.WATER_LEVEL_6]: Texture.WATER,
  [BlockType.WATER_LEVEL_7]: Texture.WATER,
  [BlockType.WATER_FALLING]: Texture.WATER,
  [BlockType.PLANKS_STAIRS_NORTH]: Texture.PLANKS,
  [BlockType.PLANKS_STAIRS_SOUTH]: Texture.PLANKS,
  [BlockType.PLANKS_STAIRS_EAST]: Texture.PLANKS,
  [BlockType.PLANKS_STAIRS_WEST]: Texture.PLANKS,
  [BlockType.GLOWSTONE]: Texture.INVALID,
};
