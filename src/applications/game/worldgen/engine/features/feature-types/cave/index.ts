// Cave and ore feature types: ores, geodes, dripstone, magma, replace blobs, lava lakes (plus documented no-ops for
// fossils and monster rooms). Add to a registry with `new FeatureTypeRegistry([...CORE_FEATURE_TYPES, ...CAVE_FEATURE_TYPES])`.

import type { AnyFeatureType } from "../../feature/feature-type";
import { dripstoneClusterFeature } from "./dripstone/dripstone-cluster";
import { largeDripstoneFeature } from "./dripstone/large-dripstone";
import { pointedDripstoneFeature } from "./dripstone/pointed-dripstone";
import { geodeFeature } from "./geode";
import { lakeFeature } from "./lake";
import { oreFeature, scatteredOreFeature } from "./ore";
import { replaceBlobsFeature } from "./replace-blobs";
import { fossilFeature, monsterRoomFeature } from "./unported";
import { underwaterMagmaFeature } from "./underwater-magma";

export const CAVE_FEATURE_TYPES: readonly AnyFeatureType[] = [
  oreFeature,
  scatteredOreFeature,
  geodeFeature,
  dripstoneClusterFeature,
  largeDripstoneFeature,
  pointedDripstoneFeature,
  underwaterMagmaFeature,
  replaceBlobsFeature,
  lakeFeature,
  fossilFeature,
  monsterRoomFeature,
];
