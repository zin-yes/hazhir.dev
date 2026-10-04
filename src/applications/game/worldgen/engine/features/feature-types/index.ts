// Every registered feature type. Adding a type = one new file in this folder + one line in this list.

import { type AnyFeatureType, FeatureTypeRegistry } from "../feature/feature-type";
import { blockColumnFeature } from "./block-column";
import { noOpFeature } from "./no-op";
import { randomBooleanSelectorFeature } from "./random-boolean-selector";
import { flowerFeature, noBonemealFlowerFeature, randomPatchFeature } from "./random-patch";
import { randomSelectorFeature } from "./random-selector";
import { simpleBlockFeature } from "./simple-block";
import { simpleRandomSelectorFeature } from "./simple-random-selector";

export const CORE_FEATURE_TYPES: readonly AnyFeatureType[] = [
  noOpFeature,
  randomSelectorFeature,
  simpleRandomSelectorFeature,
  randomBooleanSelectorFeature,
  simpleBlockFeature,
  randomPatchFeature,
  flowerFeature,
  noBonemealFlowerFeature,
  blockColumnFeature,
];

export function createDefaultFeatureTypeRegistry(): FeatureTypeRegistry {
  return new FeatureTypeRegistry(CORE_FEATURE_TYPES);
}
