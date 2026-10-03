// Fills in the common defaults so each biome only states what makes it unique.

import { BlockType } from "@/applications/game/blocks";
import type { BiomeDefinition } from "./biome-types";

type BiomeOverrides = Pick<BiomeDefinition, "id" | "name"> & Partial<BiomeDefinition>;

export function defineBiome(overrides: BiomeOverrides): BiomeDefinition {
  return {
    topBlock: BlockType.GRASS,
    topDepth: 1,
    fillerBlock: BlockType.DIRT,
    fillerDepth: 3,
    rockBlock: BlockType.STONE,
    shallowWaterFloor: BlockType.SAND,
    deepWaterFloor: BlockType.GRAVEL,
    trees: [],
    treeDensity: 0,
    groundCover: [],
    ...overrides,
  };
}
