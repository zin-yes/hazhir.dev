// Savanna, steppe, desert, badlands and tropical biomes.

import { BlockType } from "@/applications/game/blocks";
import { BiomeId } from "./biome-types";
import { defineBiome } from "./define-biome";

const DESERT_VEGETATION = {
  trees: [
    { species: "saguaro" as const, weight: 2 },
    { species: "barrel_cactus" as const, weight: 2 },
    { species: "dead" as const, weight: 1 },
  ],
  treeDensity: 0.02,
  groundCover: [
    { block: BlockType.DEAD_BUSH, chance: 0.012 },
    { block: BlockType.AGAVE, chance: 0.01 },
  ],
};

export const WARM_BIOMES = [
  defineBiome({
    id: BiomeId.Savanna,
    name: "Savanna",
    topBlock: BlockType.GRASS_DRY,
    trees: [
      { species: "acacia", weight: 3 },
      { species: "bush_oak", weight: 1 },
    ],
    treeDensity: 0.05,
    groundCover: [
      { block: BlockType.SAVANNA_GRASS, chance: 0.36 },
      { block: BlockType.TALL_GRASS, chance: 0.05 },
      { block: BlockType.DEAD_BUSH, chance: 0.004 },
      { block: BlockType.POPPY, chance: 0.1, patch: { scale: 12, threshold: 0.7 } },
    ],
  }),
  defineBiome({
    id: BiomeId.SavannaWoodland,
    name: "Savanna Woodland",
    topBlock: BlockType.GRASS_DRY,
    trees: [
      { species: "acacia", weight: 6 },
      { species: "baobab", weight: 0.8 },
      { species: "bush_oak", weight: 1 },
    ],
    treeDensity: 0.17,
    groundCover: [{ block: BlockType.SAVANNA_GRASS, chance: 0.32 }],
  }),
  defineBiome({
    id: BiomeId.Steppe,
    name: "Steppe",
    topBlock: BlockType.GRASS_DRY,
    trees: [
      { species: "heath_mat", weight: 2 },
      { species: "bush_oak", weight: 1 },
    ],
    treeDensity: 0.03,
    groundCover: [
      { block: BlockType.SAVANNA_GRASS, chance: 0.26 },
      { block: BlockType.HEATHER, chance: 0.1, patch: { scale: 10, threshold: 0.65 } },
      { block: BlockType.POPPY, chance: 0.08, patch: { scale: 12, threshold: 0.7 } },
    ],
  }),
  defineBiome({
    id: BiomeId.Desert,
    name: "Desert",
    topBlock: BlockType.SAND,
    topDepth: 4,
    fillerBlock: BlockType.SANDSTONE,
    fillerDepth: 14,
    rockBlock: BlockType.SANDSTONE,
    ...DESERT_VEGETATION,
  }),
  defineBiome({
    id: BiomeId.RedDesert,
    name: "Red Desert",
    topBlock: BlockType.RED_SAND,
    topDepth: 4,
    fillerBlock: BlockType.RED_SANDSTONE,
    fillerDepth: 14,
    rockBlock: BlockType.RED_SANDSTONE,
    shallowWaterFloor: BlockType.RED_SAND,
    ...DESERT_VEGETATION,
  }),
  defineBiome({
    id: BiomeId.Badlands,
    name: "Badlands",
    topBlock: BlockType.RED_SAND,
    fillerBlock: BlockType.TERRACOTTA,
    fillerDepth: 6,
    rockBlock: BlockType.TERRACOTTA,
    strataStyle: "badlands",
    trees: [
      { species: "dead", weight: 1 },
      { species: "saguaro", weight: 1 },
      { species: "barrel_cactus", weight: 1 },
    ],
    treeDensity: 0.01,
    groundCover: [{ block: BlockType.DEAD_BUSH, chance: 0.01 }],
  }),
  defineBiome({
    id: BiomeId.Canyon,
    name: "Canyon",
    topBlock: BlockType.RED_SAND,
    topDepth: 3,
    fillerBlock: BlockType.RED_SANDSTONE,
    fillerDepth: 6,
    rockBlock: BlockType.RED_SANDSTONE,
    strataStyle: "canyon",
    shallowWaterFloor: BlockType.RED_SAND,
    ...DESERT_VEGETATION,
    treeDensity: 0.012,
  }),
  defineBiome({
    id: BiomeId.SaltFlat,
    name: "Salt Flat",
    topBlock: BlockType.SALT,
    topDepth: 3,
    fillerBlock: BlockType.SILT,
    fillerDepth: 6,
    shallowWaterFloor: BlockType.SALT,
  }),
  defineBiome({
    id: BiomeId.Jungle,
    name: "Jungle",
    topBlock: BlockType.GRASS_LUSH,
    trees: [
      { species: "jungle", weight: 7 },
      { species: "jungle_giant", weight: 0.9 },
      { species: "bush_oak", weight: 3 },
    ],
    treeDensity: 0.72,
    groundCover: [
      { block: BlockType.FERN, chance: 0.15, shadeAffinity: 1 },
      { block: BlockType.TALL_GRASS, chance: 0.25 },
      { block: BlockType.RED_MUSHROOM, chance: 0.006, shadeAffinity: 1 },
      { block: BlockType.POPPY, chance: 0.06, patch: { scale: 10, threshold: 0.7 } },
    ],
  }),
  defineBiome({
    id: BiomeId.Rainforest,
    name: "Rainforest",
    topBlock: BlockType.GRASS_LUSH,
    trees: [
      { species: "jungle", weight: 5 },
      { species: "jungle_giant", weight: 2.5 },
      { species: "bush_oak", weight: 2 },
    ],
    treeDensity: 0.88,
    groundCover: [
      { block: BlockType.FERN, chance: 0.24, shadeAffinity: 1 },
      { block: BlockType.TALL_GRASS, chance: 0.18 },
      { block: BlockType.BROWN_MUSHROOM, chance: 0.01, shadeAffinity: 1 },
      { block: BlockType.RED_MUSHROOM, chance: 0.01, shadeAffinity: 1 },
    ],
  }),
];
