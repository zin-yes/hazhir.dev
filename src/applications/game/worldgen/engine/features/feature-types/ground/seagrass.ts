// Mirrors SeagrassFeature (minecraft:seagrass): one seagrass (or tall seagrass with the configured probability) on
// the ocean floor within 7 blocks of the origin.

import { defineFeatureType } from "../../feature/feature-type";
import { asObject, requireNumber } from "../../providers/json-fields";

const fround = Math.fround;

export const seagrassFeature = defineFeatureType<{ readonly probability: number }>({
  id: "minecraft:seagrass",
  parseConfig(json) {
    return { probability: fround(requireNumber(asObject(json, "seagrass config"), "probability", "seagrass")) };
  },
  place({ config, level, random, origin }) {
    const offsetX = random.nextIntBounded(8) - random.nextIntBounded(8);
    const offsetZ = random.nextIntBounded(8) - random.nextIntBounded(8);
    const x = origin.x + offsetX;
    const z = origin.z + offsetZ;
    const y = level.getHeight("OCEAN_FLOOR", x, z);
    if (level.getBlockInfo(x, y, z).name !== "minecraft:water") return false;
    const isTall = random.nextDouble() < config.probability;
    const state = level.blockStates.defaultState(isTall ? "minecraft:tall_seagrass" : "minecraft:seagrass");
    if (!level.survival.canSurvive(state, level, x, y, z)) return false;
    if (isTall) {
      if (level.getBlockInfo(x, y + 1, z).name === "minecraft:water") {
        level.setBlock(x, y, z, state, 2);
        level.setBlock(x, y + 1, z, level.blockStates.withProperty(state, "half", "upper"), 2);
      }
    } else {
      level.setBlock(x, y, z, state, 2);
    }
    return true;
  },
});
