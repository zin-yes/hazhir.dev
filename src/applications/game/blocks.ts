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
  GRASS_LUSH = 55,
  GRASS_DRY = 56,
  GRASS_COLD = 57,
  GRASS_SNOWY = 58,
  GRASS_MEADOW = 59,
  PODZOL = 60,
  COARSE_DIRT = 61,
  MUD = 62,
  PEAT = 63,
  MOSS = 64,
  RED_SAND = 65,
  LIMESTONE = 66,
  SLATE = 67,
  ASH = 68,
  OBSIDIAN = 69,
  SULFUR = 70,
  SALT = 71,
  ICE = 72,
  PACKED_ICE = 73,
  SNOW_BLOCK = 74,
  TRAVERTINE = 75,
  BASALT = 76,
  SANDSTONE = 77,
  RED_SANDSTONE = 78,
  MAGMA = 79,
  SNOW_SLAB = 80,
  TERRACOTTA = 81,
  TERRACOTTA_RED = 82,
  TERRACOTTA_ORANGE = 83,
  TERRACOTTA_YELLOW = 84,
  TERRACOTTA_WHITE = 85,
  TERRACOTTA_BROWN = 86,
  TERRACOTTA_PURPLE = 87,
  CORAL_PINK = 88,
  CORAL_ORANGE = 89,
  CORAL_BLUE = 90,
  CACTUS = 91,
  LOG_BIRCH = 92,
  LOG_SPRUCE = 93,
  LOG_ACACIA = 94,
  LOG_JUNGLE = 95,
  LOG_CHERRY = 96,
  LOG_DEAD = 97,
  LOG_PALM = 98,
  LOG_MANGROVE = 99,
  LOG_REDWOOD = 100,
  LOG_BAOBAB = 101,
  LEAVES_BIRCH = 102,
  LEAVES_SPRUCE = 103,
  LEAVES_ACACIA = 104,
  LEAVES_JUNGLE = 105,
  LEAVES_AUTUMN_RED = 106,
  LEAVES_AUTUMN_ORANGE = 107,
  LEAVES_AUTUMN_YELLOW = 108,
  LEAVES_BLOSSOM = 109,
  LEAVES_PALM = 110,
  LEAVES_MANGROVE = 111,
  LEAVES_REDWOOD = 112,
  FERN = 113,
  DEAD_BUSH = 114,
  SAVANNA_GRASS = 115,
  REEDS = 116,
  LAVENDER = 117,
  DANDELION = 118,
  POPPY = 119,
  HEATHER = 120,
  AGAVE = 121,
  BROWN_MUSHROOM = 122,
  RED_MUSHROOM = 123,
  LILY_PAD = 124,
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
  if (block === BlockType.MAGMA) return 8;
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
    block === BlockType.STONE_SLAB_TOP ||
    block === BlockType.SNOW_SLAB
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
    block === BlockType.SAPLING ||
    block === BlockType.FERN ||
    block === BlockType.DEAD_BUSH ||
    block === BlockType.SAVANNA_GRASS ||
    block === BlockType.REEDS ||
    block === BlockType.LAVENDER ||
    block === BlockType.DANDELION ||
    block === BlockType.POPPY ||
    block === BlockType.HEATHER ||
    block === BlockType.AGAVE ||
    block === BlockType.BROWN_MUSHROOM ||
    block === BlockType.RED_MUSHROOM
  );
}

export function isFlatQuad(block: BlockType): boolean {
  return (
    block === BlockType.BELLIS_FLOWER ||
    block === BlockType.LILY_PAD
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
    case BlockType.SNOW_SLAB: return [{"scale":[1.002,0.502,1.002],"offset":[0,-0.25,0]}];
    case BlockType.FERN: return [{"scale":[0.6,1.002,0.6],"offset":[0,0,0]}];
    case BlockType.DEAD_BUSH: return [{"scale":[0.6,1.002,0.6],"offset":[0,0,0]}];
    case BlockType.SAVANNA_GRASS: return [{"scale":[0.6,1.002,0.6],"offset":[0,0,0]}];
    case BlockType.REEDS: return [{"scale":[0.6,1.002,0.6],"offset":[0,0,0]}];
    case BlockType.LAVENDER: return [{"scale":[0.6,1.002,0.6],"offset":[0,0,0]}];
    case BlockType.DANDELION: return [{"scale":[0.6,1.002,0.6],"offset":[0,0,0]}];
    case BlockType.POPPY: return [{"scale":[0.6,1.002,0.6],"offset":[0,0,0]}];
    case BlockType.HEATHER: return [{"scale":[0.6,1.002,0.6],"offset":[0,0,0]}];
    case BlockType.AGAVE: return [{"scale":[0.6,1.002,0.6],"offset":[0,0,0]}];
    case BlockType.BROWN_MUSHROOM: return [{"scale":[0.6,1.002,0.6],"offset":[0,0,0]}];
    case BlockType.RED_MUSHROOM: return [{"scale":[0.6,1.002,0.6],"offset":[0,0,0]}];
    case BlockType.LILY_PAD: return [{"scale":[1.002,0.08,1.002],"offset":[0,-0.46,0]}];
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
  GRASS_LUSH_SIDE: "grass_lush_side.png",
  GRASS_LUSH_TOP: "grass_lush_top.png",
  GRASS_DRY_SIDE: "grass_dry_side.png",
  GRASS_DRY_TOP: "grass_dry_top.png",
  GRASS_COLD_SIDE: "grass_cold_side.png",
  GRASS_COLD_TOP: "grass_cold_top.png",
  GRASS_SNOWY_SIDE: "grass_snowy_side.png",
  GRASS_SNOWY_TOP: "grass_snowy_top.png",
  GRASS_MEADOW_SIDE: "grass_meadow_side.png",
  GRASS_MEADOW_TOP: "grass_meadow_top.png",
  PODZOL_SIDE: "podzol_side.png",
  PODZOL_TOP: "podzol_top.png",
  COARSE_DIRT: "coarse_dirt.png",
  MUD: "mud.png",
  PEAT: "peat.png",
  MOSS: "moss.png",
  RED_SAND: "red_sand.png",
  LIMESTONE: "limestone.png",
  SLATE: "slate.png",
  ASH: "ash.png",
  OBSIDIAN: "obsidian.png",
  SULFUR: "sulfur.png",
  SALT: "salt.png",
  ICE: "ice.png",
  PACKED_ICE: "packed_ice.png",
  SNOW_BLOCK: "snow_block.png",
  TRAVERTINE: "travertine.png",
  BASALT_TOP: "basalt_top.png",
  BASALT_SIDE: "basalt_side.png",
  SANDSTONE_TOP: "sandstone_top.png",
  SANDSTONE_SIDE: "sandstone_side.png",
  RED_SANDSTONE_TOP: "red_sandstone_top.png",
  RED_SANDSTONE_SIDE: "red_sandstone_side.png",
  MAGMA: "magma.png",
  TERRACOTTA: "terracotta.png",
  TERRACOTTA_RED: "terracotta_red.png",
  TERRACOTTA_ORANGE: "terracotta_orange.png",
  TERRACOTTA_YELLOW: "terracotta_yellow.png",
  TERRACOTTA_WHITE: "terracotta_white.png",
  TERRACOTTA_BROWN: "terracotta_brown.png",
  TERRACOTTA_PURPLE: "terracotta_purple.png",
  CORAL_PINK: "coral_pink.png",
  CORAL_ORANGE: "coral_orange.png",
  CORAL_BLUE: "coral_blue.png",
  CACTUS_TOP: "cactus_top.png",
  CACTUS_SIDE: "cactus_side.png",
  LOG_BIRCH_TOP: "log_birch_top.png",
  LOG_BIRCH_SIDE: "log_birch_side.png",
  LOG_SPRUCE_TOP: "log_spruce_top.png",
  LOG_SPRUCE_SIDE: "log_spruce_side.png",
  LOG_ACACIA_TOP: "log_acacia_top.png",
  LOG_ACACIA_SIDE: "log_acacia_side.png",
  LOG_JUNGLE_TOP: "log_jungle_top.png",
  LOG_JUNGLE_SIDE: "log_jungle_side.png",
  LOG_CHERRY_TOP: "log_cherry_top.png",
  LOG_CHERRY_SIDE: "log_cherry_side.png",
  LOG_DEAD_TOP: "log_dead_top.png",
  LOG_DEAD_SIDE: "log_dead_side.png",
  LOG_PALM_TOP: "log_palm_top.png",
  LOG_PALM_SIDE: "log_palm_side.png",
  LOG_MANGROVE_TOP: "log_mangrove_top.png",
  LOG_MANGROVE_SIDE: "log_mangrove_side.png",
  LOG_REDWOOD_TOP: "log_redwood_top.png",
  LOG_REDWOOD_SIDE: "log_redwood_side.png",
  LOG_BAOBAB_TOP: "log_baobab_top.png",
  LOG_BAOBAB_SIDE: "log_baobab_side.png",
  LEAVES_BIRCH: "leaves_birch.png",
  LEAVES_SPRUCE: "leaves_spruce.png",
  LEAVES_ACACIA: "leaves_acacia.png",
  LEAVES_JUNGLE: "leaves_jungle.png",
  LEAVES_AUTUMN_RED: "leaves_autumn_red.png",
  LEAVES_AUTUMN_ORANGE: "leaves_autumn_orange.png",
  LEAVES_AUTUMN_YELLOW: "leaves_autumn_yellow.png",
  LEAVES_BLOSSOM: "leaves_blossom.png",
  LEAVES_PALM: "leaves_palm.png",
  LEAVES_MANGROVE: "leaves_mangrove.png",
  LEAVES_REDWOOD: "leaves_redwood.png",
  FERN: "fern.png",
  DEAD_BUSH: "dead_bush.png",
  SAVANNA_GRASS: "savanna_grass.png",
  REEDS: "reeds.png",
  LAVENDER: "lavender.png",
  DANDELION: "dandelion.png",
  POPPY: "poppy.png",
  HEATHER: "heather.png",
  AGAVE: "agave.png",
  BROWN_MUSHROOM: "brown_mushroom.png",
  RED_MUSHROOM: "red_mushroom.png",
  LILY_PAD: "lily_pad.png",
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
  "grass_lush_side.png",
  "grass_lush_top.png",
  "grass_dry_side.png",
  "grass_dry_top.png",
  "grass_cold_side.png",
  "grass_cold_top.png",
  "grass_snowy_side.png",
  "grass_snowy_top.png",
  "grass_meadow_side.png",
  "grass_meadow_top.png",
  "podzol_side.png",
  "podzol_top.png",
  "coarse_dirt.png",
  "mud.png",
  "peat.png",
  "moss.png",
  "red_sand.png",
  "limestone.png",
  "slate.png",
  "ash.png",
  "obsidian.png",
  "sulfur.png",
  "salt.png",
  "ice.png",
  "packed_ice.png",
  "snow_block.png",
  "travertine.png",
  "basalt_top.png",
  "basalt_side.png",
  "sandstone_top.png",
  "sandstone_side.png",
  "red_sandstone_top.png",
  "red_sandstone_side.png",
  "magma.png",
  "terracotta.png",
  "terracotta_red.png",
  "terracotta_orange.png",
  "terracotta_yellow.png",
  "terracotta_white.png",
  "terracotta_brown.png",
  "terracotta_purple.png",
  "coral_pink.png",
  "coral_orange.png",
  "coral_blue.png",
  "cactus_top.png",
  "cactus_side.png",
  "log_birch_top.png",
  "log_birch_side.png",
  "log_spruce_top.png",
  "log_spruce_side.png",
  "log_acacia_top.png",
  "log_acacia_side.png",
  "log_jungle_top.png",
  "log_jungle_side.png",
  "log_cherry_top.png",
  "log_cherry_side.png",
  "log_dead_top.png",
  "log_dead_side.png",
  "log_palm_top.png",
  "log_palm_side.png",
  "log_mangrove_top.png",
  "log_mangrove_side.png",
  "log_redwood_top.png",
  "log_redwood_side.png",
  "log_baobab_top.png",
  "log_baobab_side.png",
  "leaves_birch.png",
  "leaves_spruce.png",
  "leaves_acacia.png",
  "leaves_jungle.png",
  "leaves_autumn_red.png",
  "leaves_autumn_orange.png",
  "leaves_autumn_yellow.png",
  "leaves_blossom.png",
  "leaves_palm.png",
  "leaves_mangrove.png",
  "leaves_redwood.png",
  "fern.png",
  "dead_bush.png",
  "savanna_grass.png",
  "reeds.png",
  "lavender.png",
  "dandelion.png",
  "poppy.png",
  "heather.png",
  "agave.png",
  "brown_mushroom.png",
  "red_mushroom.png",
  "lily_pad.png",
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

BLOCK_TEXTURES[BlockType.GRASS_LUSH] = {
  DEFAULT: getTextureIndexByName("DIRT"),
  SIDES: getTextureIndexByName("GRASS_LUSH_SIDE"),
  TOP_FACE: getTextureIndexByName("GRASS_LUSH_TOP"),
};

BLOCK_TEXTURES[BlockType.GRASS_DRY] = {
  DEFAULT: getTextureIndexByName("DIRT"),
  SIDES: getTextureIndexByName("GRASS_DRY_SIDE"),
  TOP_FACE: getTextureIndexByName("GRASS_DRY_TOP"),
};

BLOCK_TEXTURES[BlockType.GRASS_COLD] = {
  DEFAULT: getTextureIndexByName("DIRT"),
  SIDES: getTextureIndexByName("GRASS_COLD_SIDE"),
  TOP_FACE: getTextureIndexByName("GRASS_COLD_TOP"),
};

BLOCK_TEXTURES[BlockType.GRASS_SNOWY] = {
  DEFAULT: getTextureIndexByName("DIRT"),
  SIDES: getTextureIndexByName("GRASS_SNOWY_SIDE"),
  TOP_FACE: getTextureIndexByName("GRASS_SNOWY_TOP"),
};

BLOCK_TEXTURES[BlockType.GRASS_MEADOW] = {
  DEFAULT: getTextureIndexByName("DIRT"),
  SIDES: getTextureIndexByName("GRASS_MEADOW_SIDE"),
  TOP_FACE: getTextureIndexByName("GRASS_MEADOW_TOP"),
};

BLOCK_TEXTURES[BlockType.PODZOL] = {
  DEFAULT: getTextureIndexByName("DIRT"),
  SIDES: getTextureIndexByName("PODZOL_SIDE"),
  TOP_FACE: getTextureIndexByName("PODZOL_TOP"),
};

BLOCK_TEXTURES[BlockType.COARSE_DIRT] = {
  DEFAULT: getTextureIndexByName("COARSE_DIRT"),
};

BLOCK_TEXTURES[BlockType.MUD] = {
  DEFAULT: getTextureIndexByName("MUD"),
};

BLOCK_TEXTURES[BlockType.PEAT] = {
  DEFAULT: getTextureIndexByName("PEAT"),
};

BLOCK_TEXTURES[BlockType.MOSS] = {
  DEFAULT: getTextureIndexByName("MOSS"),
};

BLOCK_TEXTURES[BlockType.RED_SAND] = {
  DEFAULT: getTextureIndexByName("RED_SAND"),
};

BLOCK_TEXTURES[BlockType.LIMESTONE] = {
  DEFAULT: getTextureIndexByName("LIMESTONE"),
};

BLOCK_TEXTURES[BlockType.SLATE] = {
  DEFAULT: getTextureIndexByName("SLATE"),
};

BLOCK_TEXTURES[BlockType.ASH] = {
  DEFAULT: getTextureIndexByName("ASH"),
};

BLOCK_TEXTURES[BlockType.OBSIDIAN] = {
  DEFAULT: getTextureIndexByName("OBSIDIAN"),
};

BLOCK_TEXTURES[BlockType.SULFUR] = {
  DEFAULT: getTextureIndexByName("SULFUR"),
};

BLOCK_TEXTURES[BlockType.SALT] = {
  DEFAULT: getTextureIndexByName("SALT"),
};

BLOCK_TEXTURES[BlockType.ICE] = {
  DEFAULT: getTextureIndexByName("ICE"),
};

BLOCK_TEXTURES[BlockType.PACKED_ICE] = {
  DEFAULT: getTextureIndexByName("PACKED_ICE"),
};

BLOCK_TEXTURES[BlockType.SNOW_BLOCK] = {
  DEFAULT: getTextureIndexByName("SNOW_BLOCK"),
};

BLOCK_TEXTURES[BlockType.TRAVERTINE] = {
  DEFAULT: getTextureIndexByName("TRAVERTINE"),
};

BLOCK_TEXTURES[BlockType.BASALT] = {
  DEFAULT: getTextureIndexByName("BASALT_TOP"),
  SIDES: getTextureIndexByName("BASALT_SIDE"),
};

BLOCK_TEXTURES[BlockType.SANDSTONE] = {
  DEFAULT: getTextureIndexByName("SANDSTONE_TOP"),
  SIDES: getTextureIndexByName("SANDSTONE_SIDE"),
  TOP_FACE: getTextureIndexByName("SANDSTONE_TOP"),
};

BLOCK_TEXTURES[BlockType.RED_SANDSTONE] = {
  DEFAULT: getTextureIndexByName("RED_SANDSTONE_TOP"),
  SIDES: getTextureIndexByName("RED_SANDSTONE_SIDE"),
  TOP_FACE: getTextureIndexByName("RED_SANDSTONE_TOP"),
};

BLOCK_TEXTURES[BlockType.MAGMA] = {
  DEFAULT: getTextureIndexByName("MAGMA"),
};

BLOCK_TEXTURES[BlockType.SNOW_SLAB] = {
  DEFAULT: getTextureIndexByName("SNOW_BLOCK"),
};

BLOCK_TEXTURES[BlockType.TERRACOTTA] = {
  DEFAULT: getTextureIndexByName("TERRACOTTA"),
};

BLOCK_TEXTURES[BlockType.TERRACOTTA_RED] = {
  DEFAULT: getTextureIndexByName("TERRACOTTA_RED"),
};

BLOCK_TEXTURES[BlockType.TERRACOTTA_ORANGE] = {
  DEFAULT: getTextureIndexByName("TERRACOTTA_ORANGE"),
};

BLOCK_TEXTURES[BlockType.TERRACOTTA_YELLOW] = {
  DEFAULT: getTextureIndexByName("TERRACOTTA_YELLOW"),
};

BLOCK_TEXTURES[BlockType.TERRACOTTA_WHITE] = {
  DEFAULT: getTextureIndexByName("TERRACOTTA_WHITE"),
};

BLOCK_TEXTURES[BlockType.TERRACOTTA_BROWN] = {
  DEFAULT: getTextureIndexByName("TERRACOTTA_BROWN"),
};

BLOCK_TEXTURES[BlockType.TERRACOTTA_PURPLE] = {
  DEFAULT: getTextureIndexByName("TERRACOTTA_PURPLE"),
};

BLOCK_TEXTURES[BlockType.CORAL_PINK] = {
  DEFAULT: getTextureIndexByName("CORAL_PINK"),
};

BLOCK_TEXTURES[BlockType.CORAL_ORANGE] = {
  DEFAULT: getTextureIndexByName("CORAL_ORANGE"),
};

BLOCK_TEXTURES[BlockType.CORAL_BLUE] = {
  DEFAULT: getTextureIndexByName("CORAL_BLUE"),
};

BLOCK_TEXTURES[BlockType.CACTUS] = {
  DEFAULT: getTextureIndexByName("CACTUS_TOP"),
  SIDES: getTextureIndexByName("CACTUS_SIDE"),
  TOP_FACE: getTextureIndexByName("CACTUS_TOP"),
};

BLOCK_TEXTURES[BlockType.LOG_BIRCH] = {
  DEFAULT: getTextureIndexByName("LOG_BIRCH_TOP"),
  SIDES: getTextureIndexByName("LOG_BIRCH_SIDE"),
};

BLOCK_TEXTURES[BlockType.LOG_SPRUCE] = {
  DEFAULT: getTextureIndexByName("LOG_SPRUCE_TOP"),
  SIDES: getTextureIndexByName("LOG_SPRUCE_SIDE"),
};

BLOCK_TEXTURES[BlockType.LOG_ACACIA] = {
  DEFAULT: getTextureIndexByName("LOG_ACACIA_TOP"),
  SIDES: getTextureIndexByName("LOG_ACACIA_SIDE"),
};

BLOCK_TEXTURES[BlockType.LOG_JUNGLE] = {
  DEFAULT: getTextureIndexByName("LOG_JUNGLE_TOP"),
  SIDES: getTextureIndexByName("LOG_JUNGLE_SIDE"),
};

BLOCK_TEXTURES[BlockType.LOG_CHERRY] = {
  DEFAULT: getTextureIndexByName("LOG_CHERRY_TOP"),
  SIDES: getTextureIndexByName("LOG_CHERRY_SIDE"),
};

BLOCK_TEXTURES[BlockType.LOG_DEAD] = {
  DEFAULT: getTextureIndexByName("LOG_DEAD_TOP"),
  SIDES: getTextureIndexByName("LOG_DEAD_SIDE"),
};

BLOCK_TEXTURES[BlockType.LOG_PALM] = {
  DEFAULT: getTextureIndexByName("LOG_PALM_TOP"),
  SIDES: getTextureIndexByName("LOG_PALM_SIDE"),
};

BLOCK_TEXTURES[BlockType.LOG_MANGROVE] = {
  DEFAULT: getTextureIndexByName("LOG_MANGROVE_TOP"),
  SIDES: getTextureIndexByName("LOG_MANGROVE_SIDE"),
};

BLOCK_TEXTURES[BlockType.LOG_REDWOOD] = {
  DEFAULT: getTextureIndexByName("LOG_REDWOOD_TOP"),
  SIDES: getTextureIndexByName("LOG_REDWOOD_SIDE"),
};

BLOCK_TEXTURES[BlockType.LOG_BAOBAB] = {
  DEFAULT: getTextureIndexByName("LOG_BAOBAB_TOP"),
  SIDES: getTextureIndexByName("LOG_BAOBAB_SIDE"),
};

BLOCK_TEXTURES[BlockType.LEAVES_BIRCH] = {
  DEFAULT: getTextureIndexByName("LEAVES_BIRCH"),
};

BLOCK_TEXTURES[BlockType.LEAVES_SPRUCE] = {
  DEFAULT: getTextureIndexByName("LEAVES_SPRUCE"),
};

BLOCK_TEXTURES[BlockType.LEAVES_ACACIA] = {
  DEFAULT: getTextureIndexByName("LEAVES_ACACIA"),
};

BLOCK_TEXTURES[BlockType.LEAVES_JUNGLE] = {
  DEFAULT: getTextureIndexByName("LEAVES_JUNGLE"),
};

BLOCK_TEXTURES[BlockType.LEAVES_AUTUMN_RED] = {
  DEFAULT: getTextureIndexByName("LEAVES_AUTUMN_RED"),
};

BLOCK_TEXTURES[BlockType.LEAVES_AUTUMN_ORANGE] = {
  DEFAULT: getTextureIndexByName("LEAVES_AUTUMN_ORANGE"),
};

BLOCK_TEXTURES[BlockType.LEAVES_AUTUMN_YELLOW] = {
  DEFAULT: getTextureIndexByName("LEAVES_AUTUMN_YELLOW"),
};

BLOCK_TEXTURES[BlockType.LEAVES_BLOSSOM] = {
  DEFAULT: getTextureIndexByName("LEAVES_BLOSSOM"),
};

BLOCK_TEXTURES[BlockType.LEAVES_PALM] = {
  DEFAULT: getTextureIndexByName("LEAVES_PALM"),
};

BLOCK_TEXTURES[BlockType.LEAVES_MANGROVE] = {
  DEFAULT: getTextureIndexByName("LEAVES_MANGROVE"),
};

BLOCK_TEXTURES[BlockType.LEAVES_REDWOOD] = {
  DEFAULT: getTextureIndexByName("LEAVES_REDWOOD"),
};

BLOCK_TEXTURES[BlockType.FERN] = {
  DEFAULT: getTextureIndexByName("FERN"),
};

BLOCK_TEXTURES[BlockType.DEAD_BUSH] = {
  DEFAULT: getTextureIndexByName("DEAD_BUSH"),
};

BLOCK_TEXTURES[BlockType.SAVANNA_GRASS] = {
  DEFAULT: getTextureIndexByName("SAVANNA_GRASS"),
};

BLOCK_TEXTURES[BlockType.REEDS] = {
  DEFAULT: getTextureIndexByName("REEDS"),
};

BLOCK_TEXTURES[BlockType.LAVENDER] = {
  DEFAULT: getTextureIndexByName("LAVENDER"),
};

BLOCK_TEXTURES[BlockType.DANDELION] = {
  DEFAULT: getTextureIndexByName("DANDELION"),
};

BLOCK_TEXTURES[BlockType.POPPY] = {
  DEFAULT: getTextureIndexByName("POPPY"),
};

BLOCK_TEXTURES[BlockType.HEATHER] = {
  DEFAULT: getTextureIndexByName("HEATHER"),
};

BLOCK_TEXTURES[BlockType.AGAVE] = {
  DEFAULT: getTextureIndexByName("AGAVE"),
};

BLOCK_TEXTURES[BlockType.BROWN_MUSHROOM] = {
  DEFAULT: getTextureIndexByName("BROWN_MUSHROOM"),
};

BLOCK_TEXTURES[BlockType.RED_MUSHROOM] = {
  DEFAULT: getTextureIndexByName("RED_MUSHROOM"),
};

BLOCK_TEXTURES[BlockType.LILY_PAD] = {
  DEFAULT: getTextureIndexByName("LILY_PAD"),
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
  BlockType.SNOW_SLAB,
  BlockType.LEAVES_BIRCH,
  BlockType.LEAVES_SPRUCE,
  BlockType.LEAVES_ACACIA,
  BlockType.LEAVES_JUNGLE,
  BlockType.LEAVES_AUTUMN_RED,
  BlockType.LEAVES_AUTUMN_ORANGE,
  BlockType.LEAVES_AUTUMN_YELLOW,
  BlockType.LEAVES_BLOSSOM,
  BlockType.LEAVES_PALM,
  BlockType.LEAVES_MANGROVE,
  BlockType.LEAVES_REDWOOD,
  BlockType.FERN,
  BlockType.DEAD_BUSH,
  BlockType.SAVANNA_GRASS,
  BlockType.REEDS,
  BlockType.LAVENDER,
  BlockType.DANDELION,
  BlockType.POPPY,
  BlockType.HEATHER,
  BlockType.AGAVE,
  BlockType.BROWN_MUSHROOM,
  BlockType.RED_MUSHROOM,
  BlockType.LILY_PAD,
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
  BlockType.FERN,
  BlockType.DEAD_BUSH,
  BlockType.SAVANNA_GRASS,
  BlockType.REEDS,
  BlockType.LAVENDER,
  BlockType.DANDELION,
  BlockType.POPPY,
  BlockType.HEATHER,
  BlockType.AGAVE,
  BlockType.BROWN_MUSHROOM,
  BlockType.RED_MUSHROOM,
  BlockType.LILY_PAD,
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
  [BlockType.GRASS_LUSH]: Texture.GRASS_LUSH_SIDE,
  [BlockType.GRASS_DRY]: Texture.GRASS_DRY_SIDE,
  [BlockType.GRASS_COLD]: Texture.GRASS_COLD_SIDE,
  [BlockType.GRASS_SNOWY]: Texture.GRASS_SNOWY_SIDE,
  [BlockType.GRASS_MEADOW]: Texture.GRASS_MEADOW_SIDE,
  [BlockType.PODZOL]: Texture.PODZOL_SIDE,
  [BlockType.COARSE_DIRT]: Texture.COARSE_DIRT,
  [BlockType.MUD]: Texture.MUD,
  [BlockType.PEAT]: Texture.PEAT,
  [BlockType.MOSS]: Texture.MOSS,
  [BlockType.RED_SAND]: Texture.RED_SAND,
  [BlockType.LIMESTONE]: Texture.LIMESTONE,
  [BlockType.SLATE]: Texture.SLATE,
  [BlockType.ASH]: Texture.ASH,
  [BlockType.OBSIDIAN]: Texture.OBSIDIAN,
  [BlockType.SULFUR]: Texture.SULFUR,
  [BlockType.SALT]: Texture.SALT,
  [BlockType.ICE]: Texture.ICE,
  [BlockType.PACKED_ICE]: Texture.PACKED_ICE,
  [BlockType.SNOW_BLOCK]: Texture.SNOW_BLOCK,
  [BlockType.TRAVERTINE]: Texture.TRAVERTINE,
  [BlockType.BASALT]: Texture.BASALT_SIDE,
  [BlockType.SANDSTONE]: Texture.SANDSTONE_SIDE,
  [BlockType.RED_SANDSTONE]: Texture.RED_SANDSTONE_SIDE,
  [BlockType.MAGMA]: Texture.MAGMA,
  [BlockType.SNOW_SLAB]: Texture.SNOW_BLOCK,
  [BlockType.TERRACOTTA]: Texture.TERRACOTTA,
  [BlockType.TERRACOTTA_RED]: Texture.TERRACOTTA_RED,
  [BlockType.TERRACOTTA_ORANGE]: Texture.TERRACOTTA_ORANGE,
  [BlockType.TERRACOTTA_YELLOW]: Texture.TERRACOTTA_YELLOW,
  [BlockType.TERRACOTTA_WHITE]: Texture.TERRACOTTA_WHITE,
  [BlockType.TERRACOTTA_BROWN]: Texture.TERRACOTTA_BROWN,
  [BlockType.TERRACOTTA_PURPLE]: Texture.TERRACOTTA_PURPLE,
  [BlockType.CORAL_PINK]: Texture.CORAL_PINK,
  [BlockType.CORAL_ORANGE]: Texture.CORAL_ORANGE,
  [BlockType.CORAL_BLUE]: Texture.CORAL_BLUE,
  [BlockType.CACTUS]: Texture.CACTUS_SIDE,
  [BlockType.LOG_BIRCH]: Texture.LOG_BIRCH_SIDE,
  [BlockType.LOG_SPRUCE]: Texture.LOG_SPRUCE_SIDE,
  [BlockType.LOG_ACACIA]: Texture.LOG_ACACIA_SIDE,
  [BlockType.LOG_JUNGLE]: Texture.LOG_JUNGLE_SIDE,
  [BlockType.LOG_CHERRY]: Texture.LOG_CHERRY_SIDE,
  [BlockType.LOG_DEAD]: Texture.LOG_DEAD_SIDE,
  [BlockType.LOG_PALM]: Texture.LOG_PALM_SIDE,
  [BlockType.LOG_MANGROVE]: Texture.LOG_MANGROVE_SIDE,
  [BlockType.LOG_REDWOOD]: Texture.LOG_REDWOOD_SIDE,
  [BlockType.LOG_BAOBAB]: Texture.LOG_BAOBAB_SIDE,
  [BlockType.LEAVES_BIRCH]: Texture.LEAVES_BIRCH,
  [BlockType.LEAVES_SPRUCE]: Texture.LEAVES_SPRUCE,
  [BlockType.LEAVES_ACACIA]: Texture.LEAVES_ACACIA,
  [BlockType.LEAVES_JUNGLE]: Texture.LEAVES_JUNGLE,
  [BlockType.LEAVES_AUTUMN_RED]: Texture.LEAVES_AUTUMN_RED,
  [BlockType.LEAVES_AUTUMN_ORANGE]: Texture.LEAVES_AUTUMN_ORANGE,
  [BlockType.LEAVES_AUTUMN_YELLOW]: Texture.LEAVES_AUTUMN_YELLOW,
  [BlockType.LEAVES_BLOSSOM]: Texture.LEAVES_BLOSSOM,
  [BlockType.LEAVES_PALM]: Texture.LEAVES_PALM,
  [BlockType.LEAVES_MANGROVE]: Texture.LEAVES_MANGROVE,
  [BlockType.LEAVES_REDWOOD]: Texture.LEAVES_REDWOOD,
  [BlockType.FERN]: Texture.FERN,
  [BlockType.DEAD_BUSH]: Texture.DEAD_BUSH,
  [BlockType.SAVANNA_GRASS]: Texture.SAVANNA_GRASS,
  [BlockType.REEDS]: Texture.REEDS,
  [BlockType.LAVENDER]: Texture.LAVENDER,
  [BlockType.DANDELION]: Texture.DANDELION,
  [BlockType.POPPY]: Texture.POPPY,
  [BlockType.HEATHER]: Texture.HEATHER,
  [BlockType.AGAVE]: Texture.AGAVE,
  [BlockType.BROWN_MUSHROOM]: Texture.BROWN_MUSHROOM,
  [BlockType.RED_MUSHROOM]: Texture.RED_MUSHROOM,
  [BlockType.LILY_PAD]: Texture.LILY_PAD,
};
