// Mirrors levelgen.feature.rootplacers: RootPlacer and MangroveRootPlacer (mangrove_root_placer), the only root
// placer type in vanilla 1.20.6 and Terralith.

import type { RandomSource } from "../../../random";
import { BlockPos } from "../../core/block-pos";
import { Direction } from "../../core/direction";
import type { FeatureParser } from "../../feature/feature-parser";
import type { WorldGenLevel } from "../../level/world-gen-level";
import type { BlockSet } from "../../providers/block-predicates";
import type { BlockStateProvider } from "../../providers/block-state-providers";
import { asObject, type JsonValue, requireNumber, typeOf } from "../../providers/json-fields";
import type { IntProvider } from "../../providers/value-providers";
import { manhattanDistance } from "./java-math";
import type { TreeBlockSetter, TreeConfig } from "./tree-placement";
import { isValidTreePosition, withWaterloggedFromFluid } from "./tree-world";
import { parseTreeStateProvider } from "./tree-world";

const fround = Math.fround;

export interface RootPlacementContext {
  readonly level: WorldGenLevel;
  readonly random: RandomSource;
  readonly config: TreeConfig;
  readonly setRootBlock: TreeBlockSetter;
}

interface AboveRootPlacement {
  readonly aboveRootProvider: BlockStateProvider;
  readonly aboveRootPlacementChance: number;
}

export abstract class RootPlacer {
  constructor(
    protected readonly trunkOffsetY: IntProvider,
    protected readonly rootProvider: BlockStateProvider,
    protected readonly aboveRootPlacement: AboveRootPlacement | undefined,
  ) {}

  abstract placeRoots(context: RootPlacementContext, origin: BlockPos, trunkOrigin: BlockPos): boolean;

  getTrunkOrigin(origin: BlockPos, random: RandomSource): BlockPos {
    return origin.above(this.trunkOffsetY.sample(random));
  }

  protected canPlaceRoot(level: WorldGenLevel, x: number, y: number, z: number): boolean {
    return isValidTreePosition(level, x, y, z);
  }

  protected placeRoot(context: RootPlacementContext, x: number, y: number, z: number): void {
    const { level, random } = context;
    if (!this.canPlaceRoot(level, x, y, z)) return;
    context.setRootBlock(x, y, z, withWaterloggedFromFluid(level, this.rootProvider.getState(random, x, y, z), x, y, z, true));
    if (!this.aboveRootPlacement) return;
    const aboveY = y + 1;
    if (random.nextFloat() < this.aboveRootPlacement.aboveRootPlacementChance && level.getBlockInfo(x, aboveY, z).isAir) {
      context.setRootBlock(x, aboveY, z, withWaterloggedFromFluid(level, this.aboveRootPlacement.aboveRootProvider.getState(random, x, aboveY, z), x, aboveY, z, true));
    }
  }
}

interface MangroveRootPlacement {
  readonly canGrowThrough: BlockSet;
  readonly muddyRootsIn: BlockSet;
  readonly muddyRootsProvider: BlockStateProvider;
  readonly maxRootWidth: number;
  readonly maxRootLength: number;
  readonly randomSkewChance: number;
}

export class MangroveRootPlacer extends RootPlacer {
  constructor(
    trunkOffsetY: IntProvider,
    rootProvider: BlockStateProvider,
    aboveRootPlacement: AboveRootPlacement | undefined,
    private readonly mangroveRootPlacement: MangroveRootPlacement,
  ) {
    super(trunkOffsetY, rootProvider, aboveRootPlacement);
  }

  placeRoots(context: RootPlacementContext, origin: BlockPos, trunkOrigin: BlockPos): boolean {
    const { level, random } = context;
    const rootPositions: BlockPos[] = [];
    for (let y = origin.y; y < trunkOrigin.y; y++) {
      if (!this.canPlaceRoot(level, origin.x, y, origin.z)) return false;
    }
    rootPositions.push(trunkOrigin.below());
    for (const direction of Direction.HORIZONTAL) {
      const start = trunkOrigin.relative(direction);
      const simulated: BlockPos[] = [];
      if (!this.simulateRoots(level, random, start, direction, trunkOrigin, simulated, 0)) return false;
      rootPositions.push(...simulated);
      rootPositions.push(trunkOrigin.relative(direction));
    }
    for (const position of rootPositions) this.placeRoot(context, position.x, position.y, position.z);
    return true;
  }

  private simulateRoots(level: WorldGenLevel, random: RandomSource, position: BlockPos, direction: Direction, trunkOrigin: BlockPos, accumulated: BlockPos[], depth: number): boolean {
    const maxRootLength = this.mangroveRootPlacement.maxRootLength;
    if (depth === maxRootLength || accumulated.length > maxRootLength) return false;
    for (const candidate of this.potentialRootPositions(position, direction, random, trunkOrigin)) {
      if (!this.canPlaceRoot(level, candidate.x, candidate.y, candidate.z)) continue;
      accumulated.push(candidate);
      if (!this.simulateRoots(level, random, candidate, direction, trunkOrigin, accumulated, depth + 1)) return false;
    }
    return true;
  }

  private potentialRootPositions(position: BlockPos, direction: Direction, random: RandomSource, trunkOrigin: BlockPos): BlockPos[] {
    const below = position.below();
    const sideways = position.relative(direction);
    const distance = manhattanDistance(position.x, position.y, position.z, trunkOrigin.x, trunkOrigin.y, trunkOrigin.z);
    const { maxRootWidth, randomSkewChance } = this.mangroveRootPlacement;
    if (distance > maxRootWidth - 3 && distance <= maxRootWidth) {
      return random.nextFloat() < randomSkewChance ? [below, sideways.below()] : [below];
    }
    if (distance > maxRootWidth) return [below];
    if (random.nextFloat() < randomSkewChance) return [below];
    return random.nextBoolean() ? [sideways] : [below];
  }

  protected override canPlaceRoot(level: WorldGenLevel, x: number, y: number, z: number): boolean {
    return super.canPlaceRoot(level, x, y, z) || this.mangroveRootPlacement.canGrowThrough.contains(level, level.getBlockInfo(x, y, z).name);
  }

  protected override placeRoot(context: RootPlacementContext, x: number, y: number, z: number): void {
    const { level, random } = context;
    if (this.mangroveRootPlacement.muddyRootsIn.contains(level, level.getBlockInfo(x, y, z).name)) {
      const state = this.mangroveRootPlacement.muddyRootsProvider.getState(random, x, y, z);
      context.setRootBlock(x, y, z, withWaterloggedFromFluid(level, state, x, y, z, true));
    } else {
      super.placeRoot(context, x, y, z);
    }
  }
}

function parseAboveRootPlacement(json: JsonValue | undefined, parser: FeatureParser): AboveRootPlacement | undefined {
  if (json === undefined) return undefined;
  const object = asObject(json, "above_root_placement");
  return {
    aboveRootProvider: parseTreeStateProvider(parser, object.above_root_provider, "above_root_placement.above_root_provider"),
    aboveRootPlacementChance: fround(requireNumber(object, "above_root_placement_chance", "above_root_placement")),
  };
}

export function parseRootPlacer(json: JsonValue | undefined, parser: FeatureParser): RootPlacer {
  const object = asObject(json, "root_placer");
  const type = typeOf(object, "root_placer");
  if (type !== "minecraft:mangrove_root_placer") throw new Error(`Unknown root placer type ${type}`);
  const placement = asObject(object.mangrove_root_placement, "mangrove_root_placement");
  return new MangroveRootPlacer(
    parser.intProvider(object.trunk_offset_y, `${type}.trunk_offset_y`),
    parseTreeStateProvider(parser, object.root_provider, `${type}.root_provider`),
    parseAboveRootPlacement(object.above_root_placement, parser),
    {
      canGrowThrough: parser.blockSet(placement.can_grow_through, "mangrove_root_placement.can_grow_through"),
      muddyRootsIn: parser.blockSet(placement.muddy_roots_in, "mangrove_root_placement.muddy_roots_in"),
      muddyRootsProvider: parseTreeStateProvider(parser, placement.muddy_roots_provider, "mangrove_root_placement.muddy_roots_provider"),
      maxRootWidth: requireNumber(placement, "max_root_width", "mangrove_root_placement"),
      maxRootLength: requireNumber(placement, "max_root_length", "mangrove_root_placement"),
      randomSkewChance: fround(requireNumber(placement, "random_skew_chance", "mangrove_root_placement")),
    },
  );
}
