// The shared vocabulary of one TreeFeature placement: the setters that record where logs, roots, leaves and
// decorations went, foliage attachments and the parsed TreeConfiguration.

import type { RandomSource } from "../../../random";
import type { BlockPos } from "../../core/block-pos";
import type { BlockStateProvider } from "../../providers/block-state-providers";
import type { WorldGenLevel } from "../../level/world-gen-level";
import type { FeatureSize } from "./feature-size";
import type { FoliagePlacer } from "./foliage-placer";
import type { RootPlacer } from "./root-placers";
import type { TreeDecorator } from "./tree-decorators";
import type { TrunkPlacer } from "./trunk-placers/trunk-placer";

/** Records the position and writes the block (flags 19); returns what WorldGenLevel.setBlock returned. */
export type TreeBlockSetter = (x: number, y: number, z: number, state: string) => boolean;

export interface FoliageSetter {
  set(x: number, y: number, z: number, state: string): boolean;
  isSet(x: number, y: number, z: number): boolean;
}

/** FoliagePlacer.FoliageAttachment. */
export class FoliageAttachment {
  constructor(
    readonly pos: BlockPos,
    readonly radiusOffset: number,
    readonly doubleTrunk: boolean,
  ) {}
}

/** TreeConfiguration. */
export interface TreeConfig {
  readonly trunkProvider: BlockStateProvider;
  readonly trunkPlacer: TrunkPlacer;
  readonly foliageProvider: BlockStateProvider;
  readonly foliagePlacer: FoliagePlacer;
  readonly rootPlacer: RootPlacer | undefined;
  readonly dirtProvider: BlockStateProvider;
  readonly minimumSize: FeatureSize;
  readonly decorators: readonly TreeDecorator[];
  readonly ignoreVines: boolean;
  readonly forceDirt: boolean;
}

export interface TreePlacementContext {
  readonly level: WorldGenLevel;
  readonly random: RandomSource;
  readonly config: TreeConfig;
}
