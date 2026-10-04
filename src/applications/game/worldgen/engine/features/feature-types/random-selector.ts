// Mirrors RandomSelectorFeature (minecraft:random_selector): the first entry whose chance roll succeeds is placed,
// otherwise the default feature.

import { defineFeatureType } from "../feature/feature-type";
import type { PlacedFeature } from "../feature/placed-feature";
import { asArray, asObject } from "../providers/json-fields";

export interface RandomSelectorConfig {
  readonly features: ReadonlyArray<{ readonly feature: PlacedFeature; readonly chance: number }>;
  readonly defaultFeature: PlacedFeature;
}

export const randomSelectorFeature = defineFeatureType<RandomSelectorConfig>({
  id: "minecraft:random_selector",
  parseConfig(json, parser) {
    const config = asObject(json, "random_selector config");
    const features = asArray(config.features, "random_selector.features").map((entryJson, index) => {
      const entry = asObject(entryJson, `random_selector.features[${index}]`);
      const chance = Math.fround(Number(entry.chance));
      if (!(chance >= 0 && chance <= 1)) throw new Error("random_selector chance must be within [0, 1]");
      return { feature: parser.placedFeature(entry.feature, `random_selector.features[${index}].feature`), chance };
    });
    return { features, defaultFeature: parser.placedFeature(config.default, "random_selector.default") };
  },
  place({ config, random, level, generator, origin }) {
    for (const entry of config.features) {
      if (random.nextFloat() < entry.chance) return entry.feature.place(level, generator, random, origin);
    }
    return config.defaultFeature.place(level, generator, random, origin);
  },
});
