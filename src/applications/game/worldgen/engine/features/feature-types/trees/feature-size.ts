// Mirrors levelgen.feature.featuresize: two_layers_feature_size and three_layers_feature_size, the width of the
// space a tree needs free at each height (TreeFeature.getMaxFreeTreeHeight).

import type { FeatureParser } from "../../feature/feature-parser";
import { asObject, type JsonValue, optionalNumber, typeOf } from "../../providers/json-fields";

export interface FeatureSize {
  /** OptionalInt minClippedHeight; undefined when absent. */
  readonly minClippedHeight: number | undefined;
  getSizeAtHeight(treeHeight: number, y: number): number;
}

export function parseFeatureSize(json: JsonValue | undefined, _parser: FeatureParser): FeatureSize {
  const object = asObject(json, "minimum_size");
  const type = typeOf(object, "minimum_size");
  const minClippedHeight = object.min_clipped_height === undefined ? undefined : optionalNumber(object, "min_clipped_height", 0);
  switch (type) {
    case "minecraft:two_layers_feature_size": {
      const limit = optionalNumber(object, "limit", 1);
      const lowerSize = optionalNumber(object, "lower_size", 0);
      const upperSize = optionalNumber(object, "upper_size", 1);
      return { minClippedHeight, getSizeAtHeight: (_treeHeight, y) => (y < limit ? lowerSize : upperSize) };
    }
    case "minecraft:three_layers_feature_size": {
      const limit = optionalNumber(object, "limit", 1);
      const upperLimit = optionalNumber(object, "upper_limit", 1);
      const lowerSize = optionalNumber(object, "lower_size", 0);
      const middleSize = optionalNumber(object, "middle_size", 1);
      const upperSize = optionalNumber(object, "upper_size", 1);
      return {
        minClippedHeight,
        getSizeAtHeight: (treeHeight, y) => {
          if (y < limit) return lowerSize;
          if (y >= treeHeight - upperLimit) return upperSize;
          return middleSize;
        },
      };
    }
    default:
      throw new Error(`Unknown feature size type ${type}`);
  }
}
