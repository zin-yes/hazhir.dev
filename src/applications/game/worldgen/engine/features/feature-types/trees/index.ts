// Feature types for trees: minecraft:tree (all trunk, foliage and root placers and tree decorators),
// minecraft:root_system (azalea) and the two huge mushrooms.

import type { AnyFeatureType } from "../../feature/feature-type";
import { hugeBrownMushroomFeature, hugeRedMushroomFeature } from "./huge-mushroom";
import { rootSystemFeature } from "./root-system";
import { treeFeature } from "./tree-feature";

export const TREE_FEATURE_TYPES: readonly AnyFeatureType[] = [treeFeature, rootSystemFeature, hugeRedMushroomFeature, hugeBrownMushroomFeature];
