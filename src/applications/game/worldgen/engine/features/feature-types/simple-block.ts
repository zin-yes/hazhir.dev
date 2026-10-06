// Mirrors SimpleBlockFeature (minecraft:simple_block): place the provided state if it can survive; double plants
// go through DoublePlantBlock.placeAt (lower and upper half, each copying water into `waterlogged`).

import { isFluidWater } from "../../block-state";
import type { BlockStateProvider } from "../providers/block-state-providers";
import { defineFeatureType } from "../feature/feature-type";
import type { WorldGenLevel } from "../level/world-gen-level";
import { asObject } from "../providers/json-fields";
import { noteFeatureRejection } from "../profiling/feature-profiling";

export interface SimpleBlockConfig {
  readonly toPlace: BlockStateProvider;
}

/** DoublePlantBlock.copyWaterloggedFrom. */
function copyWaterloggedFrom(level: WorldGenLevel, x: number, y: number, z: number, state: string): string {
  if (!level.blockStates.hasProperty(state, "waterlogged")) return state;
  const isWater = isFluidWater(level.getBlockInfo(x, y, z).fluid);
  return level.blockStates.withProperty(state, "waterlogged", String(isWater));
}

/** DoublePlantBlock.placeAt. */
export function placeDoublePlant(level: WorldGenLevel, state: string, x: number, y: number, z: number, flags: number): void {
  const lower = copyWaterloggedFrom(level, x, y, z, level.blockStates.withProperty(state, "half", "lower"));
  level.setBlock(x, y, z, lower, flags);
  const upper = copyWaterloggedFrom(level, x, y + 1, z, level.blockStates.withProperty(state, "half", "upper"));
  level.setBlock(x, y + 1, z, upper, flags);
}

export const simpleBlockFeature = defineFeatureType<SimpleBlockConfig>({
  id: "minecraft:simple_block",
  parseConfig(json, parser) {
    const config = asObject(json, "simple_block config");
    return { toPlace: parser.blockStateProvider(config.to_place, "simple_block.to_place") };
  },
  place({ config, level, random, origin }) {
    const state = config.toPlace.getState(random, origin.x, origin.y, origin.z);
    if (!level.survival.canSurvive(state, level, origin.x, origin.y, origin.z)) {
      noteFeatureRejection("cannotSurvive");
      return false;
    }
    if (level.blockStates.info(state).isDoublePlant) {
      if (!level.isEmptyBlock(origin.x, origin.y + 1, origin.z)) {
        noteFeatureRejection("upperHalfBlocked");
        return false;
      }
      placeDoublePlant(level, state, origin.x, origin.y, origin.z, 2);
      return true;
    }
    level.setBlock(origin.x, origin.y, origin.z, state, 2);
    return true;
  },
});
