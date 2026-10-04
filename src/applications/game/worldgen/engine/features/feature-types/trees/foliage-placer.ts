// Mirrors levelgen.feature.foliageplacers.FoliagePlacer: the shared leaf row machinery (placeLeavesRow, hanging
// leaves, tryPlaceLeaf) every foliage placer type builds on.

import type { RandomSource } from "../../../random";
import { type BlockPosLike, MutableBlockPos } from "../../core/block-pos";
import { Direction } from "../../core/direction";
import type { WorldGenLevel } from "../../level/world-gen-level";
import type { IntProvider } from "../../providers/value-providers";
import { manhattanDistance } from "./java-math";
import type { FoliageAttachment, FoliageSetter, TreeConfig } from "./tree-placement";
import { isValidTreePosition, withWaterloggedFromFluid } from "./tree-world";

export interface FoliagePlacementContext {
  readonly level: WorldGenLevel;
  readonly random: RandomSource;
  readonly config: TreeConfig;
  readonly foliageSetter: FoliageSetter;
}

export abstract class FoliagePlacer {
  constructor(
    protected readonly radius: IntProvider,
    protected readonly offset: IntProvider,
  ) {}

  /** FoliagePlacer.createFoliage: the offset is rolled once per attachment before the shape is built. */
  createFoliage(context: FoliagePlacementContext, trunkHeight: number, attachment: FoliageAttachment, foliageHeight: number, foliageRadius: number): void {
    this.createFoliageWithOffset(context, trunkHeight, attachment, foliageHeight, foliageRadius, this.offset.sample(context.random));
  }

  protected abstract createFoliageWithOffset(
    context: FoliagePlacementContext,
    trunkHeight: number,
    attachment: FoliageAttachment,
    foliageHeight: number,
    foliageRadius: number,
    offset: number,
  ): void;

  abstract foliageHeight(random: RandomSource, treeHeight: number): number;

  foliageRadius(random: RandomSource, _trunkHeightMinusFoliageHeight: number): number {
    return this.radius.sample(random);
  }

  protected abstract shouldSkipLocation(random: RandomSource, localX: number, localY: number, localZ: number, range: number, doubleTrunk: boolean): boolean;

  protected shouldSkipLocationSigned(random: RandomSource, localX: number, localY: number, localZ: number, range: number, doubleTrunk: boolean): boolean {
    let distanceX: number;
    let distanceZ: number;
    if (doubleTrunk) {
      distanceX = Math.min(Math.abs(localX), Math.abs(localX - 1));
      distanceZ = Math.min(Math.abs(localZ), Math.abs(localZ - 1));
    } else {
      distanceX = Math.abs(localX);
      distanceZ = Math.abs(localZ);
    }
    return this.shouldSkipLocation(random, distanceX, localY, distanceZ, range, doubleTrunk);
  }

  protected placeLeavesRow(context: FoliagePlacementContext, origin: BlockPosLike, range: number, localY: number, doubleTrunk: boolean): void {
    const extra = doubleTrunk ? 1 : 0;
    for (let localX = -range; localX <= range + extra; localX++) {
      for (let localZ = -range; localZ <= range + extra; localZ++) {
        if (this.shouldSkipLocationSigned(context.random, localX, localY, localZ, range, doubleTrunk)) continue;
        tryPlaceLeaf(context, origin.x + localX, origin.y + localY, origin.z + localZ);
      }
    }
  }

  protected placeLeavesRowWithHangingLeavesBelow(
    context: FoliagePlacementContext,
    origin: BlockPosLike,
    range: number,
    localY: number,
    doubleTrunk: boolean,
    hangingChance: number,
    extensionChance: number,
  ): void {
    this.placeLeavesRow(context, origin, range, localY, doubleTrunk);
    const extra = doubleTrunk ? 1 : 0;
    const belowOrigin = { x: origin.x, y: origin.y - 1, z: origin.z };
    const position = new MutableBlockPos();
    for (const direction of Direction.HORIZONTAL) {
      const clockwise = clockWiseOf(direction);
      const alongClockwise = clockwise.stepX + clockwise.stepZ > 0 ? range + extra : range;
      position.set(origin.x, origin.y + localY - 1, origin.z).move(clockwise, alongClockwise).move(direction, -range);
      for (let index = -range; index < range + extra; index++) {
        const hasLeafAbove = context.foliageSetter.isSet(position.x, position.y + 1, position.z);
        if (hasLeafAbove && tryPlaceExtension(context, hangingChance, belowOrigin, position)) {
          position.move(Direction.DOWN);
          tryPlaceExtension(context, extensionChance, belowOrigin, position);
          position.move(Direction.UP);
        }
        position.move(direction);
      }
    }
  }
}

function clockWiseOf(direction: Direction): Direction {
  if (direction === Direction.NORTH) return Direction.EAST;
  if (direction === Direction.EAST) return Direction.SOUTH;
  if (direction === Direction.SOUTH) return Direction.WEST;
  return Direction.NORTH;
}

function tryPlaceExtension(context: FoliagePlacementContext, chance: number, belowOrigin: BlockPosLike, position: MutableBlockPos): boolean {
  if (manhattanDistance(position.x, position.y, position.z, belowOrigin.x, belowOrigin.y, belowOrigin.z) >= 7) return false;
  if (context.random.nextFloat() > chance) return false;
  return tryPlaceLeaf(context, position.x, position.y, position.z);
}

/** FoliagePlacer.tryPlaceLeaf. */
export function tryPlaceLeaf(context: FoliagePlacementContext, x: number, y: number, z: number): boolean {
  const { level, random, config } = context;
  if (!isValidTreePosition(level, x, y, z)) return false;
  const state = withWaterloggedFromFluid(level, config.foliageProvider.getState(random, x, y, z), x, y, z, false);
  context.foliageSetter.set(x, y, z, state);
  return true;
}
