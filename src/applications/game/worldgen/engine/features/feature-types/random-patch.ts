// Mirrors RandomPatchFeature, registered as minecraft:random_patch, minecraft:flower and
// minecraft:no_bonemeal_flower (the same class; the ids only differ for bonemeal lookups).

import { MutableBlockPos } from "../core/block-pos";
import { defineFeatureType, type FeatureType } from "../feature/feature-type";
import { addFeatureCounter, noteFeatureRejection } from "../profiling/feature-profiling";
import type { PlacedFeature } from "../feature/placed-feature";
import { asObject, optionalNumber } from "../providers/json-fields";

export interface RandomPatchConfig {
  readonly tries: number;
  readonly xzSpread: number;
  readonly ySpread: number;
  readonly feature: PlacedFeature;
}

function defineRandomPatchType(id: string): FeatureType<RandomPatchConfig> {
  return defineFeatureType<RandomPatchConfig>({
    id,
    parseConfig(json, parser) {
      const config = asObject(json, `${id} config`);
      return {
        tries: optionalNumber(config, "tries", 128),
        xzSpread: optionalNumber(config, "xz_spread", 7),
        ySpread: optionalNumber(config, "y_spread", 3),
        feature: parser.placedFeature(config.feature, `${id}.feature`),
      };
    },
    place({ config, random, origin, level, generator }) {
      let placedCount = 0;
      const position = new MutableBlockPos();
      const xzBound = config.xzSpread + 1;
      const yBound = config.ySpread + 1;
      for (let attempt = 0; attempt < config.tries; attempt++) {
        // Java evaluates the six nextInt calls left to right: x pair, y pair, z pair.
        const offsetX = random.nextIntBounded(xzBound) - random.nextIntBounded(xzBound);
        const offsetY = random.nextIntBounded(yBound) - random.nextIntBounded(yBound);
        const offsetZ = random.nextIntBounded(xzBound) - random.nextIntBounded(xzBound);
        position.setWithOffset(origin, offsetX, offsetY, offsetZ);
        if (config.feature.place(level, generator, random, position.immutable())) placedCount++;
      }
      addFeatureCounter("feature.randomPatch.tries", config.tries);
      addFeatureCounter("feature.randomPatch.placed", placedCount);
      if (placedCount === 0) noteFeatureRejection("noAttemptPlaced");
      return placedCount > 0;
    },
  });
}

export const randomPatchFeature = defineRandomPatchType("minecraft:random_patch");
export const flowerFeature = defineRandomPatchType("minecraft:flower");
export const noBonemealFlowerFeature = defineRandomPatchType("minecraft:no_bonemeal_flower");
