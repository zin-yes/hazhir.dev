// Mirrors KelpFeature (minecraft:kelp): a kelp column of up to 11 blocks on the ocean floor, topped by a kelp head.

import { defineFeatureType } from "../../feature/feature-type";

export const kelpFeature = defineFeatureType<undefined>({
  id: "minecraft:kelp",
  parseConfig: () => undefined,
  place({ level, random, origin }) {
    let placedHeads = 0;
    let y = level.getHeight("OCEAN_FLOOR", origin.x, origin.z);
    const { x, z } = origin;
    if (level.getBlockInfo(x, y, z).name !== "minecraft:water") return false;
    const kelpHead = level.blockStates.defaultState("minecraft:kelp");
    const kelpPlant = level.blockStates.defaultState("minecraft:kelp_plant");
    const topLayer = 1 + random.nextIntBounded(10);
    for (let layer = 0; layer <= topLayer; layer++) {
      if (level.getBlockInfo(x, y, z).name === "minecraft:water" && level.getBlockInfo(x, y + 1, z).name === "minecraft:water" && level.survival.canSurvive(kelpPlant, level, x, y, z)) {
        if (layer === topLayer) {
          level.setBlock(x, y, z, level.blockStates.withProperty(kelpHead, "age", String(random.nextIntBounded(4) + 20)), 2);
          placedHeads++;
        } else {
          level.setBlock(x, y, z, kelpPlant, 2);
        }
      } else if (layer > 0) {
        const belowY = y - 1;
        if (!level.survival.canSurvive(kelpHead, level, x, belowY, z) || level.getBlockInfo(x, belowY - 1, z).name === "minecraft:kelp") break;
        level.setBlock(x, belowY, z, level.blockStates.withProperty(kelpHead, "age", String(random.nextIntBounded(4) + 20)), 2);
        placedHeads++;
        break;
      }
      y++;
    }
    return placedHeads > 0;
  },
});
