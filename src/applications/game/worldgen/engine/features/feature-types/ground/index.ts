// Ground-level vegetation and terrain-surface feature types: disks, vegetation patches, multiface growth, vines,
// bamboo, seagrass, kelp, sea pickles, corals, springs, sculk patches and block piles.

import type { AnyFeatureType } from "../../feature/feature-type";
import { bambooFeature } from "./bamboo";
import { blockPileFeature } from "./block-pile";
import { coralClawFeature } from "./coral-claw";
import { coralMushroomFeature } from "./coral-mushroom";
import { coralTreeFeature } from "./coral-tree";
import { diskFeature } from "./disk";
import { kelpFeature } from "./kelp";
import { multifaceGrowthFeature } from "./multiface-growth";
import { seaPickleFeature } from "./sea-pickle";
import { seagrassFeature } from "./seagrass";
import { sculkPatchFeature } from "./sculk-patch";
import { springFeature } from "./spring";
import { vegetationPatchFeature, waterloggedVegetationPatchFeature } from "./vegetation-patch";
import { vinesFeature } from "./vines";

export const GROUND_FEATURE_TYPES: readonly AnyFeatureType[] = [
  vegetationPatchFeature,
  waterloggedVegetationPatchFeature,
  diskFeature,
  multifaceGrowthFeature,
  vinesFeature,
  bambooFeature,
  seagrassFeature,
  kelpFeature,
  seaPickleFeature,
  coralTreeFeature,
  coralClawFeature,
  coralMushroomFeature,
  springFeature,
  sculkPatchFeature,
  blockPileFeature,
];
