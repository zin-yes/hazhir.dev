// Mirrors SeaPickleFeature (minecraft:sea_pickle): `count` attempts, each placing a sea pickle of 1..4 pickles on
// the ocean floor within 7 blocks of the origin.

import { defineFeatureType } from "../../feature/feature-type";
import { asObject } from "../../providers/json-fields";
import type { IntProvider } from "../../providers/value-providers";

export const seaPickleFeature = defineFeatureType<{ readonly count: IntProvider }>({
  id: "minecraft:sea_pickle",
  parseConfig(json, parser) {
    return { count: parser.intProvider(asObject(json, "sea_pickle config").count, "sea_pickle.count") };
  },
  place({ config, level, random, origin }) {
    let placedCount = 0;
    const attempts = config.count.sample(random);
    for (let attempt = 0; attempt < attempts; attempt++) {
      const x = origin.x + (random.nextIntBounded(8) - random.nextIntBounded(8));
      const z = origin.z + (random.nextIntBounded(8) - random.nextIntBounded(8));
      const y = level.getHeight("OCEAN_FLOOR", x, z);
      const pickles = random.nextIntBounded(4) + 1;
      const state = level.blockStates.withProperty(level.blockStates.defaultState("minecraft:sea_pickle"), "pickles", String(pickles));
      if (level.getBlockInfo(x, y, z).name !== "minecraft:water" || !level.survival.canSurvive(state, level, x, y, z)) continue;
      level.setBlock(x, y, z, state, 2);
      placedCount++;
    }
    return placedCount > 0;
  },
});
