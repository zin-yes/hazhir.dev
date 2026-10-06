// trunk_placer codec: the nine trunk placer types vanilla and Terralith use.

import type { FeatureParser } from "../../../feature/feature-parser";
import { asObject, type JsonValue, optionalNumber, requireNumber, typeOf } from "../../../providers/json-fields";
import { type IntProvider, randomBetweenInclusive } from "../../../providers/value-providers";
import { BendingTrunkPlacer } from "./bending-trunk-placer";
import { CherryTrunkPlacer } from "./cherry-trunk-placer";
import { FancyTrunkPlacer } from "./fancy-trunk-placer";
import { DarkOakTrunkPlacer, ForkingTrunkPlacer, GiantTrunkPlacer, MegaJungleTrunkPlacer, StraightTrunkPlacer } from "./simple-trunk-placers";
import type { TrunkPlacer } from "./trunk-placer";
import { UpwardsBranchingTrunkPlacer } from "./upwards-branching-trunk-placer";

export type { TrunkPlacementContext, TrunkPlacer } from "./trunk-placer";

/** UniformInt.CODEC as the cherry trunk placer uses it: {min_inclusive, max_inclusive} without a type field. */
function parseUniformInt(json: JsonValue | undefined, what: string): IntProvider {
  const object = asObject(json, what);
  const minInclusive = requireNumber(object, "min_inclusive", what);
  const maxInclusive = requireNumber(object, "max_inclusive", what);
  return { sample: (random) => randomBetweenInclusive(random, minInclusive, maxInclusive), minValue: minInclusive, maxValue: maxInclusive };
}

export function parseTrunkPlacer(json: JsonValue | undefined, parser: FeatureParser): TrunkPlacer {
  const placer = createTrunkPlacer(json, parser);
  placer.typeId = typeOf(asObject(json, "trunk_placer"), "trunk_placer");
  return placer;
}

function createTrunkPlacer(json: JsonValue | undefined, parser: FeatureParser): TrunkPlacer {
  const object = asObject(json, "trunk_placer");
  const type = typeOf(object, "trunk_placer");
  const baseHeight = requireNumber(object, "base_height", type);
  const heightRandomA = requireNumber(object, "height_rand_a", type);
  const heightRandomB = requireNumber(object, "height_rand_b", type);
  switch (type) {
    case "minecraft:straight_trunk_placer":
      return new StraightTrunkPlacer(baseHeight, heightRandomA, heightRandomB);
    case "minecraft:forking_trunk_placer":
      return new ForkingTrunkPlacer(baseHeight, heightRandomA, heightRandomB);
    case "minecraft:giant_trunk_placer":
      return new GiantTrunkPlacer(baseHeight, heightRandomA, heightRandomB);
    case "minecraft:mega_jungle_trunk_placer":
      return new MegaJungleTrunkPlacer(baseHeight, heightRandomA, heightRandomB);
    case "minecraft:dark_oak_trunk_placer":
      return new DarkOakTrunkPlacer(baseHeight, heightRandomA, heightRandomB);
    case "minecraft:fancy_trunk_placer":
      return new FancyTrunkPlacer(baseHeight, heightRandomA, heightRandomB);
    case "minecraft:bending_trunk_placer":
      return new BendingTrunkPlacer(baseHeight, heightRandomA, heightRandomB, optionalNumber(object, "min_height_for_leaves", 1), parser.intProvider(object.bend_length, `${type}.bend_length`));
    case "minecraft:upwards_branching_trunk_placer":
      return new UpwardsBranchingTrunkPlacer(
        baseHeight,
        heightRandomA,
        heightRandomB,
        parser.intProvider(object.extra_branch_steps, `${type}.extra_branch_steps`),
        Math.fround(requireNumber(object, "place_branch_per_log_probability", type)),
        parser.intProvider(object.extra_branch_length, `${type}.extra_branch_length`),
        parser.blockSet(object.can_grow_through, `${type}.can_grow_through`),
      );
    case "minecraft:cherry_trunk_placer":
      return new CherryTrunkPlacer(
        baseHeight,
        heightRandomA,
        heightRandomB,
        parser.intProvider(object.branch_count, `${type}.branch_count`),
        parser.intProvider(object.branch_horizontal_length, `${type}.branch_horizontal_length`),
        parseUniformInt(object.branch_start_offset_from_top, `${type}.branch_start_offset_from_top`),
        parser.intProvider(object.branch_end_offset_from_top, `${type}.branch_end_offset_from_top`),
      );
    default:
      throw new Error(`Unknown trunk placer type ${type}`);
  }
}
