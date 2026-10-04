// Mirrors RandomBooleanSelectorFeature (minecraft:random_boolean_selector): one nextBoolean picks the feature.

import { defineFeatureType } from "../feature/feature-type";
import type { PlacedFeature } from "../feature/placed-feature";
import { asObject } from "../providers/json-fields";

export interface RandomBooleanSelectorConfig {
  readonly featureTrue: PlacedFeature;
  readonly featureFalse: PlacedFeature;
}

export const randomBooleanSelectorFeature = defineFeatureType<RandomBooleanSelectorConfig>({
  id: "minecraft:random_boolean_selector",
  parseConfig(json, parser) {
    const config = asObject(json, "random_boolean_selector config");
    return {
      featureTrue: parser.placedFeature(config.feature_true, "random_boolean_selector.feature_true"),
      featureFalse: parser.placedFeature(config.feature_false, "random_boolean_selector.feature_false"),
    };
  },
  place({ config, random, level, generator, origin }) {
    const chosen = random.nextBoolean() ? config.featureTrue : config.featureFalse;
    return chosen.place(level, generator, random, origin);
  },
});
