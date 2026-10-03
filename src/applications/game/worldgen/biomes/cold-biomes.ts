// Boreal and polar biomes.

import { BlockType } from "@/applications/game/blocks";
import { BiomeId } from "./biome-types";
import { defineBiome } from "./define-biome";

export const COLD_BIOMES = [
  defineBiome({
    id: BiomeId.Taiga,
    name: "Taiga",
    topBlock: BlockType.GRASS_COLD,
    trees: [
      { species: "spruce", weight: 6 },
      { species: "pine", weight: 2 },
      { species: "bush_spruce", weight: 2 },
      { species: "birch", weight: 0.5 },
    ],
    treeDensity: 0.5,
    groundCover: [
      { block: BlockType.FERN, chance: 0.08, shadeAffinity: 1 },
      { block: BlockType.TALL_GRASS, chance: 0.06 },
      { block: BlockType.BROWN_MUSHROOM, chance: 0.004, shadeAffinity: 1 },
    ],
  }),
  defineBiome({
    id: BiomeId.SnowyTaiga,
    name: "Snowy Taiga",
    topBlock: BlockType.GRASS_SNOWY,
    trees: [
      { species: "spruce", weight: 6 },
      { species: "pine", weight: 2 },
      { species: "bush_spruce", weight: 1 },
    ],
    treeDensity: 0.4,
    groundCover: [{ block: BlockType.FERN, chance: 0.02, shadeAffinity: 1 }],
  }),
  defineBiome({
    id: BiomeId.Tundra,
    name: "Tundra",
    topBlock: BlockType.GRASS_COLD,
    fillerBlock: BlockType.COARSE_DIRT,
    trees: [
      { species: "krummholz", weight: 3 },
      { species: "bush_spruce", weight: 2 },
      { species: "heath_mat", weight: 3 },
    ],
    treeDensity: 0.06,
    groundCover: [
      { block: BlockType.HEATHER, chance: 0.1, patch: { scale: 9, threshold: 0.6 } },
      { block: BlockType.TALL_GRASS, chance: 0.06 },
    ],
  }),
  defineBiome({
    id: BiomeId.SnowyPlains,
    name: "Snowy Plains",
    topBlock: BlockType.GRASS_SNOWY,
    trees: [
      { species: "spruce", weight: 1 },
      { species: "bush_spruce", weight: 1 },
      { species: "dead", weight: 1 },
    ],
    treeDensity: 0.02,
  }),
  defineBiome({
    id: BiomeId.Glacier,
    name: "Glacier",
    topBlock: BlockType.SNOW_BLOCK,
    topDepth: 2,
    fillerBlock: BlockType.ICE,
    fillerDepth: 14,
    rockBlock: BlockType.PACKED_ICE,
    shallowWaterFloor: BlockType.GRAVEL,
  }),
];
