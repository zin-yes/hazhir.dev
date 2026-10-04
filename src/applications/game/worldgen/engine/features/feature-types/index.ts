// Every registered feature type. Adding a type = one new file in this folder + one line in this list.

import { type AnyFeatureType, FeatureTypeRegistry } from "../feature/feature-type";
import { blockColumnFeature } from "./block-column";
import { CAVE_FEATURE_TYPES } from "./cave";
import { GROUND_FEATURE_TYPES } from "./ground";
import { noOpFeature } from "./no-op";
import { randomBooleanSelectorFeature } from "./random-boolean-selector";
import { flowerFeature, noBonemealFlowerFeature, randomPatchFeature } from "./random-patch";
import { randomSelectorFeature } from "./random-selector";
import { simpleBlockFeature } from "./simple-block";
import { simpleRandomSelectorFeature } from "./simple-random-selector";
import { SURFACE_FEATURE_TYPES } from "./surface";
import { TREE_FEATURE_TYPES } from "./trees";

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

export const ALL_FEATURE_TYPES: readonly AnyFeatureType[] = [
  ...CORE_FEATURE_TYPES,
  ...TREE_FEATURE_TYPES,
  ...GROUND_FEATURE_TYPES,
  ...CAVE_FEATURE_TYPES,
  ...SURFACE_FEATURE_TYPES,
];

export function createDefaultFeatureTypeRegistry(): FeatureTypeRegistry {
  return new FeatureTypeRegistry(ALL_FEATURE_TYPES);
}
