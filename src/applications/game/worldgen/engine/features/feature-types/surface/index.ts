// Surface feature types: top layer snow and ice, icebergs, ice spikes, forest rocks and the desert well.
// `minecraft:no_op` already lives in CORE_FEATURE_TYPES.

import type { AnyFeatureType } from "../../feature/feature-type";
import { blueIceFeature } from "./blue-ice";
import { desertWellFeature } from "./desert-well";
import { forestRockFeature } from "./forest-rock";
import { freezeTopLayerFeature } from "./freeze-top-layer";
import { iceSpikeFeature } from "./ice-spike";
import { icebergFeature } from "./iceberg";

export const SURFACE_FEATURE_TYPES: readonly AnyFeatureType[] = [
  freezeTopLayerFeature,
  icebergFeature,
  blueIceFeature,
  iceSpikeFeature,
  forestRockFeature,
  desertWellFeature,
];
