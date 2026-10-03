// Lowland biomes of the mild mid-latitudes, from dry steppe to wet old growth.

import { BlockType } from "@/applications/game/blocks";
import { BiomeId } from "./biome-types";
import { defineBiome } from "./define-biome";

const MEADOW_FLOWERS = [
  BlockType.DANDELION,
  BlockType.POPPY,
  BlockType.ANEMONE_FLOWER,
  BlockType.PONPON_FLOWER,
  BlockType.BELLIS_FLOWER,
  BlockType.FORGETMENOTS_FLOWER,
];

export const TEMPERATE_BIOMES = [
  defineBiome({
    id: BiomeId.Plains,
    name: "Plains",
    trees: [
      { species: "oak", weight: 3 },
      { species: "bush_oak", weight: 4 },
    ],
    treeDensity: 0.05,
    groundCover: [
      { block: BlockType.TALL_GRASS, chance: 0.24 },
      { block: BlockType.DANDELION, chance: 0.1, patch: { scale: 14, threshold: 0.62 } },
      { block: BlockType.POPPY, chance: 0.08, patch: { scale: 16, threshold: 0.66 } },
      { block: BlockType.BELLIS_FLOWER, chance: 0.1, patch: { scale: 12, threshold: 0.66 } },
    ],
  }),
  defineBiome({
    id: BiomeId.Meadow,
    name: "Meadow",
    topBlock: BlockType.GRASS_MEADOW,
    trees: [
      { species: "bush_oak", weight: 2 },
      { species: "birch", weight: 1 },
    ],
    treeDensity: 0.03,
    groundCover: [
      { block: BlockType.TALL_GRASS, chance: 0.2 },
      ...MEADOW_FLOWERS.map((flower, flowerIndex) => ({
        block: flower,
        chance: 0.22,
        patch: { scale: 9 + flowerIndex, threshold: 0.6 },
      })),
      { block: BlockType.LAVENDER, chance: 0.2, patch: { scale: 11, threshold: 0.68 } },
    ],
  }),
  defineBiome({
    id: BiomeId.Forest,
    name: "Forest",
    trees: [
      { species: "oak", weight: 5 },
      { species: "tall_oak", weight: 2 },
      { species: "birch", weight: 2 },
      { species: "bush_oak", weight: 2 },
    ],
    treeDensity: 0.55,
    groundCover: [
      { block: BlockType.TALL_GRASS, chance: 0.12 },
      { block: BlockType.FERN, chance: 0.06, shadeAffinity: 1 },
      { block: BlockType.BROWN_MUSHROOM, chance: 0.004, shadeAffinity: 1 },
      { block: BlockType.DANDELION, chance: 0.06, patch: { scale: 10, threshold: 0.66 }, shadeAffinity: -1 },
      { block: BlockType.POPPY, chance: 0.05, patch: { scale: 12, threshold: 0.68 }, shadeAffinity: -1 },
    ],
  }),
  defineBiome({
    id: BiomeId.BirchForest,
    name: "Birch Forest",
    trees: [
      { species: "birch", weight: 8 },
      { species: "oak", weight: 1 },
      { species: "bush_oak", weight: 1 },
    ],
    treeDensity: 0.5,
    groundCover: [
      { block: BlockType.TALL_GRASS, chance: 0.16 },
      { block: BlockType.FERN, chance: 0.05, shadeAffinity: 1 },
      { block: BlockType.DANDELION, chance: 0.08, patch: { scale: 10, threshold: 0.62 }, shadeAffinity: -1 },
    ],
  }),
  defineBiome({
    id: BiomeId.AutumnForest,
    name: "Autumn Forest",
    topBlock: BlockType.GRASS_DRY,
    trees: [
      { species: "oak", weight: 3, leafVariant: BlockType.LEAVES_AUTUMN_ORANGE },
      { species: "oak", weight: 3, leafVariant: BlockType.LEAVES_AUTUMN_RED },
      { species: "tall_oak", weight: 2, leafVariant: BlockType.LEAVES_AUTUMN_YELLOW },
      { species: "birch", weight: 2 },
      { species: "bush_autumn", weight: 3, leafVariant: BlockType.LEAVES_AUTUMN_ORANGE },
    ],
    treeDensity: 0.5,
    groundCover: [
      { block: BlockType.SAVANNA_GRASS, chance: 0.08 },
      { block: BlockType.FERN, chance: 0.08, shadeAffinity: 1 },
      { block: BlockType.BROWN_MUSHROOM, chance: 0.008, shadeAffinity: 1 },
      { block: BlockType.RED_MUSHROOM, chance: 0.006, shadeAffinity: 1 },
    ],
  }),
  defineBiome({
    id: BiomeId.CherryGrove,
    name: "Cherry Grove",
    topBlock: BlockType.GRASS_MEADOW,
    trees: [
      { species: "cherry", weight: 8 },
      { species: "birch", weight: 1 },
    ],
    treeDensity: 0.38,
    groundCover: [
      { block: BlockType.TALL_GRASS, chance: 0.18 },
      { block: BlockType.PONPON_FLOWER, chance: 0.16, patch: { scale: 8, threshold: 0.55 } },
      { block: BlockType.FORGETMENOTS_FLOWER, chance: 0.14, patch: { scale: 10, threshold: 0.58 } },
      { block: BlockType.BELLIS_FLOWER, chance: 0.12, patch: { scale: 9, threshold: 0.6 } },
    ],
  }),
  defineBiome({
    id: BiomeId.OldGrowthForest,
    name: "Old Growth Forest",
    topBlock: BlockType.GRASS_LUSH,
    trees: [
      { species: "big_oak", weight: 3 },
      { species: "tall_oak", weight: 3 },
      { species: "oak", weight: 2 },
      { species: "bush_oak", weight: 2 },
    ],
    treeDensity: 0.6,
    groundCover: [
      { block: BlockType.FERN, chance: 0.16, shadeAffinity: 1 },
      { block: BlockType.TALL_GRASS, chance: 0.1 },
      { block: BlockType.BROWN_MUSHROOM, chance: 0.01, shadeAffinity: 1 },
      { block: BlockType.RED_MUSHROOM, chance: 0.007, shadeAffinity: 1 },
    ],
  }),
  defineBiome({
    id: BiomeId.Shrubland,
    name: "Shrubland",
    topBlock: BlockType.GRASS_DRY,
    trees: [
      { species: "bush_oak", weight: 5 },
      { species: "heath_mat", weight: 3 },
      { species: "oak", weight: 1 },
    ],
    treeDensity: 0.14,
    groundCover: [
      { block: BlockType.LAVENDER, chance: 0.16, patch: { scale: 10, threshold: 0.62 } },
      { block: BlockType.HEATHER, chance: 0.14, patch: { scale: 8, threshold: 0.6 } },
      { block: BlockType.TALL_GRASS, chance: 0.1 },
      { block: BlockType.DEAD_BUSH, chance: 0.006 },
    ],
  }),
  defineBiome({
    id: BiomeId.RedwoodForest,
    name: "Redwood Forest",
    topBlock: BlockType.PODZOL,
    fillerBlock: BlockType.DIRT,
    trees: [
      { species: "redwood", weight: 3 },
      { species: "spruce", weight: 2 },
      { species: "bush_spruce", weight: 2 },
    ],
    treeDensity: 0.45,
    groundCover: [
      { block: BlockType.FERN, chance: 0.22, shadeAffinity: 1 },
      { block: BlockType.BROWN_MUSHROOM, chance: 0.008, shadeAffinity: 1 },
      { block: BlockType.RED_MUSHROOM, chance: 0.006, shadeAffinity: 1 },
    ],
  }),
];
