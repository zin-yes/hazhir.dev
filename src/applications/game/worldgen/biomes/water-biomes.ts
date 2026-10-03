// Oceans, shores, rivers and wetlands.

import { BlockType } from "@/applications/game/blocks";
import { BiomeId } from "./biome-types";
import { defineBiome } from "./define-biome";

export const WATER_BIOMES = [
  defineBiome({
    id: BiomeId.DeepOcean,
    name: "Deep Ocean",
    shallowWaterFloor: BlockType.GRAVEL,
    deepWaterFloor: BlockType.SILT,
  }),
  defineBiome({ id: BiomeId.Ocean, name: "Ocean", deepWaterFloor: BlockType.GRAVEL }),
  defineBiome({
    id: BiomeId.WarmOcean,
    name: "Warm Ocean",
    deepWaterFloor: BlockType.SAND,
  }),
  defineBiome({
    id: BiomeId.FrozenOcean,
    name: "Frozen Ocean",
    shallowWaterFloor: BlockType.GRAVEL,
    deepWaterFloor: BlockType.SILT,
  }),
  defineBiome({
    id: BiomeId.Beach,
    name: "Beach",
    topBlock: BlockType.SAND,
    topDepth: 5,
    fillerBlock: BlockType.SANDSTONE,
    fillerDepth: 6,
    rockBlock: BlockType.SANDSTONE,
    trees: [
      { species: "palm", weight: 1 },
      { species: "bush_oak", weight: 0.2 },
    ],
    treeDensity: 0.02,
    groundCover: [{ block: BlockType.DEAD_BUSH, chance: 0.003 }],
  }),
  defineBiome({
    id: BiomeId.ColdBeach,
    name: "Cold Beach",
    topBlock: BlockType.GRAVEL,
    topDepth: 3,
    fillerBlock: BlockType.COMPACT_GRAVEL,
    fillerDepth: 4,
    shallowWaterFloor: BlockType.GRAVEL,
  }),
  defineBiome({
    id: BiomeId.RockyShore,
    name: "Rocky Shore",
    topBlock: BlockType.GRAVEL,
    topDepth: 1,
    fillerBlock: BlockType.STONE,
    fillerDepth: 4,
    rockBlock: BlockType.GRANITE,
    shallowWaterFloor: BlockType.GRAVEL,
  }),
  defineBiome({
    id: BiomeId.River,
    name: "River",
    deepWaterFloor: BlockType.GRAVEL,
  }),
  defineBiome({
    id: BiomeId.FrozenRiver,
    name: "Frozen River",
    shallowWaterFloor: BlockType.GRAVEL,
  }),
  defineBiome({
    id: BiomeId.MangroveSwamp,
    name: "Mangrove Swamp",
    topBlock: BlockType.MUD,
    topDepth: 3,
    fillerBlock: BlockType.CLAY,
    fillerDepth: 4,
    shallowWaterFloor: BlockType.MUD,
    deepWaterFloor: BlockType.CLAY,
    trees: [
      { species: "mangrove", weight: 6 },
      { species: "bush_oak", weight: 1 },
    ],
    treeDensity: 0.4,
    groundCover: [
      { block: BlockType.REEDS, chance: 0.1, patch: { scale: 9, threshold: 0.45 } },
      { block: BlockType.LILY_PAD, chance: 0.08, patch: { scale: 12, threshold: 0.5 } },
    ],
  }),
  defineBiome({
    id: BiomeId.Swamp,
    name: "Swamp",
    topBlock: BlockType.GRASS_LUSH,
    fillerBlock: BlockType.MUD,
    fillerDepth: 3,
    shallowWaterFloor: BlockType.MUD,
    deepWaterFloor: BlockType.CLAY,
    trees: [
      { species: "oak", weight: 3 },
      { species: "dead", weight: 1 },
      { species: "bush_oak", weight: 2 },
    ],
    treeDensity: 0.14,
    groundCover: [
      { block: BlockType.TALL_GRASS, chance: 0.22 },
      { block: BlockType.REEDS, chance: 0.14, patch: { scale: 8, threshold: 0.5 } },
      { block: BlockType.FERN, chance: 0.05, shadeAffinity: 1 },
      { block: BlockType.BROWN_MUSHROOM, chance: 0.006, shadeAffinity: 1 },
      { block: BlockType.RED_MUSHROOM, chance: 0.004, shadeAffinity: 1 },
      { block: BlockType.LILY_PAD, chance: 0.1, patch: { scale: 10, threshold: 0.5 } },
    ],
  }),
  defineBiome({
    id: BiomeId.Bog,
    name: "Bog",
    topBlock: BlockType.MOSS,
    fillerBlock: BlockType.PEAT,
    fillerDepth: 4,
    shallowWaterFloor: BlockType.PEAT,
    deepWaterFloor: BlockType.CLAY,
    trees: [
      { species: "spruce", weight: 2 },
      { species: "dead", weight: 2 },
      { species: "bush_spruce", weight: 2 },
    ],
    treeDensity: 0.07,
    groundCover: [
      { block: BlockType.HEATHER, chance: 0.1, patch: { scale: 9, threshold: 0.55 } },
      { block: BlockType.FERN, chance: 0.08 },
      { block: BlockType.REEDS, chance: 0.06, patch: { scale: 8, threshold: 0.5 } },
      { block: BlockType.BROWN_MUSHROOM, chance: 0.01, shadeAffinity: 1 },
    ],
  }),
];
