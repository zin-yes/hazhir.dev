// Mirrors levelgen.feature.trunkplacers.TrunkPlacer: shared height roll, dirt placement and log placement.

import type { RandomSource } from "../../../../random";
import type { BlockPos } from "../../../core/block-pos";
import type { WorldGenLevel } from "../../../level/world-gen-level";
import { isDirtBlock, isLogBlock, isValidTreePosition } from "../tree-world";
import type { FoliageAttachment, TreeBlockSetter, TreeConfig } from "../tree-placement";

export interface TrunkPlacementContext {
  readonly level: WorldGenLevel;
  readonly random: RandomSource;
  readonly config: TreeConfig;
  readonly setTrunkBlock: TreeBlockSetter;
}

export abstract class TrunkPlacer {
  constructor(
    protected readonly baseHeight: number,
    protected readonly heightRandomA: number,
    protected readonly heightRandomB: number,
  ) {}

  abstract placeTrunk(context: TrunkPlacementContext, freeTreeHeight: number, origin: BlockPos): FoliageAttachment[];

  getTreeHeight(random: RandomSource): number {
    return this.baseHeight + random.nextIntBounded(this.heightRandomA + 1) + random.nextIntBounded(this.heightRandomB + 1);
  }

  /** TreeFeature.validTreePos; UpwardsBranchingTrunkPlacer widens it. */
  validTreePosition(level: WorldGenLevel, x: number, y: number, z: number): boolean {
    return isValidTreePosition(level, x, y, z);
  }

  isFree(level: WorldGenLevel, x: number, y: number, z: number): boolean {
    return this.validTreePosition(level, x, y, z) || isLogBlock(level, level.getBlockInfo(x, y, z).name);
  }

  /** TrunkPlacer.setDirtAt: dirt under the trunk unless the block already is dirt (grass and mycelium do not count). */
  protected setDirtAt(context: TrunkPlacementContext, x: number, y: number, z: number): void {
    const { level, config } = context;
    if (config.forceDirt || !this.isPlainDirt(level, x, y, z)) {
      context.setTrunkBlock(x, y, z, config.dirtProvider.getState(context.random, x, y, z));
    }
  }

  private isPlainDirt(level: WorldGenLevel, x: number, y: number, z: number): boolean {
    const name = level.getBlockInfo(x, y, z).name;
    return isDirtBlock(level, name) && name !== "minecraft:grass_block" && name !== "minecraft:mycelium";
  }

  protected placeLog(context: TrunkPlacementContext, x: number, y: number, z: number, stateTransform?: (state: string) => string): boolean {
    if (!this.validTreePosition(context.level, x, y, z)) return false;
    const state = context.config.trunkProvider.getState(context.random, x, y, z);
    context.setTrunkBlock(x, y, z, stateTransform ? stateTransform(state) : state);
    return true;
  }

  protected placeLogIfFree(context: TrunkPlacementContext, x: number, y: number, z: number): void {
    if (this.isFree(context.level, x, y, z)) this.placeLog(context, x, y, z);
  }
}
