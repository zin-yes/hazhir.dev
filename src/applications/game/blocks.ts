export enum BlockType {
  AIR,
  DIRT,
  HUMUS,
  SILT,
  CLAY,
  GRAVEL,
  GRANITE,
  CALCITE,
  COMPACT_GRAVEL,
  PHYLLITE,
  SHALE,
  STONE,
  COBBLESTONE,
  SAND,
  MARBLE,
  LEAVES,
  WATER,
  DECORATIVE_GLASS,
  GLASS,
  GRASS,
  PLANKS,
  LOG,
  PLANKS_SLAB,
  COBBLESTONE_SLAB,
  STONE_SLAB,
  PLANKS_SLAB_TOP,
  COBBLESTONE_SLAB_TOP,
  STONE_SLAB_TOP,
  TALL_GRASS,
  ANEMONE_FLOWER,
  SAPLING,
  BELLIS_FLOWER,
  FORGETMENOTS_FLOWER,
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
  GRASS_TOP: "grass_top.png",
  GRASS_SIDE: "grass_side.png",
  PLANKS: "planks.png",
  LOG_TOP_BOTTOM: "log_top_bottom.png",
  LOG_SIDE: "log_side.png",
  ANEMONE_FLOWER: "flower_anemone.png",
  SAPLING: "sapling.png",
  BELLIS_FLOWER: "flower_bellis.png",
  FORGETMENOTS_FLOWER: "flower_forgetmenots.png",
  TALL_GRASS: "tall_grass.png",
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
  "grass_top.png",
  "grass_side.png",
  "planks.png",
  "log_top_bottom.png",
  "log_side.png",
  "flower_anemone.png",
  "sapling.png",
  "flower_bellis.png",
  "flower_forgetmenots.png",
  "tall_grass.png",
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
BLOCK_TEXTURES[BlockType.ANEMONE_FLOWER] = {
  DEFAULT: getTextureIndexByName("ANEMONE_FLOWER"),
};
BLOCK_TEXTURES[BlockType.SAPLING] = {
  DEFAULT: getTextureIndexByName("SAPLING"),
};
BLOCK_TEXTURES[BlockType.BELLIS_FLOWER] = {
  DEFAULT: getTextureIndexByName("BELLIS_FLOWER"),
};
BLOCK_TEXTURES[BlockType.FORGETMENOTS_FLOWER] = {
  DEFAULT: getTextureIndexByName("FORGETMENOTS_FLOWER"),
};

BLOCK_TEXTURES[BlockType.TALL_GRASS] = {
  DEFAULT: getTextureIndexByName("TALL_GRASS"),
};

export const TRANSPARENT_BLOCKS = [
  BlockType.AIR,
  BlockType.GLASS,
  BlockType.LEAVES,
  BlockType.DECORATIVE_GLASS,
  BlockType.WATER,
  BlockType.PLANKS_SLAB,
  BlockType.COBBLESTONE_SLAB,
  BlockType.STONE_SLAB,
  BlockType.PLANKS_SLAB_TOP,
  BlockType.COBBLESTONE_SLAB_TOP,
  BlockType.STONE_SLAB_TOP,
  BlockType.ANEMONE_FLOWER,
  BlockType.SAPLING,
  BlockType.BELLIS_FLOWER,
  BlockType.FORGETMENOTS_FLOWER,
  BlockType.TALL_GRASS,
  // BlockType.PUMPOM_FLOWER,
];

export const TRANSLUCENT_BLOCKS = [
  BlockType.WATER,
  BlockType.GLASS,
  BlockType.DECORATIVE_GLASS,
];

export const NON_COLLIDABLE_BLOCKS = [
  BlockType.AIR,
  BlockType.WATER,
  BlockType.ANEMONE_FLOWER,
  BlockType.SAPLING,
  BlockType.BELLIS_FLOWER,
  BlockType.FORGETMENOTS_FLOWER,
  BlockType.TALL_GRASS,
  // BlockType.PUMPOM_FLOWER,
];
