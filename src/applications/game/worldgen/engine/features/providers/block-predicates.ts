// Mirrors net.minecraft.world.level.levelgen.blockpredicates. `has_sturdy_face` reads the recorded sturdy faces of
// the block's default state (isFaceSturdy on an empty getter), an approximation for the few blocks whose faces
// depend on state; `would_survive` uses the probe-derived SurvivalRules (see engine/block-state).

import type { BlockStateCatalog, FluidKind } from "../../block-state";
import { normalizeBlockId, normalizeTagId } from "../../block-state";
import { Direction } from "../core/direction";
import type { WorldGenLevel } from "../level/world-gen-level";
import { parseBlockState } from "./block-state-providers";
import { asArray, asObject, type JsonValue, requireString, typeOf } from "./json-fields";

export interface BlockPredicate {
  test(level: WorldGenLevel, x: number, y: number, z: number): boolean;
}

/** A HolderSet<Block>: "#tag", a single id, or a list of ids. */
export interface BlockSet {
  contains(level: WorldGenLevel, blockName: string): boolean;
}

export function parseBlockSet(json: JsonValue | undefined, catalog: BlockStateCatalog, what = "block set"): BlockSet {
  if (typeof json === "string" && json.startsWith("#")) {
    const tagId = normalizeTagId(json);
    return { contains: (level, blockName) => level.blockTags.is(blockName, tagId) };
  }
  const ids = (typeof json === "string" ? [json] : asArray(json, what)).map((id) => normalizeBlockId(String(id)));
  for (const id of ids) if (!catalog.isKnownBlock(id)) catalog.reportUnknownBlock(id, what);
  const idSet = new Set(ids);
  return { contains: (_level, blockName) => idSet.has(blockName) };
}

const FLUID_IDS: Record<string, FluidKind> = {
  "minecraft:empty": "empty",
  "minecraft:water": "water",
  "minecraft:flowing_water": "flowing_water",
  "minecraft:lava": "lava",
  "minecraft:flowing_lava": "flowing_lava",
};

function parseFluidSet(json: JsonValue | undefined, what: string): Set<FluidKind> {
  const ids = typeof json === "string" ? [json] : asArray(json, what).map(String);
  return new Set(
    ids.map((id) => {
      const fluid = FLUID_IDS[normalizeBlockId(id)];
      if (!fluid) throw new Error(`${what}: unsupported fluid ${id}`);
      return fluid;
    }),
  );
}

/** Vec3i.offsetCodec(16): optional [x, y, z]. */
function parseOffset(json: JsonValue | undefined, what: string): readonly [number, number, number] {
  if (json === undefined) return [0, 0, 0];
  const values = asArray(json, what).map(Number);
  if (values.length !== 3 || values.some((value) => Math.abs(value) > 16)) throw new Error(`${what} must be three ints within 16`);
  return [values[0]!, values[1]!, values[2]!];
}

export const TRUE_PREDICATE: BlockPredicate = { test: () => true };

/** BlockPredicate.ONLY_IN_AIR_PREDICATE: matching_blocks [minecraft:air]. */
export const ONLY_IN_AIR_PREDICATE: BlockPredicate = { test: (level, x, y, z) => level.getBlockInfo(x, y, z).name === "minecraft:air" };

export function parseBlockPredicate(json: JsonValue | undefined, catalog: BlockStateCatalog, what = "block predicate"): BlockPredicate {
  const object = asObject(json, what);
  const type = typeOf(object, what);
  const [offsetX, offsetY, offsetZ] = parseOffset(object.offset, `${what}.offset`);
  switch (type) {
    case "minecraft:true":
      return TRUE_PREDICATE;
    case "minecraft:not": {
      const inner = parseBlockPredicate(object.predicate, catalog, `${what}.predicate`);
      return { test: (level, x, y, z) => !inner.test(level, x, y, z) };
    }
    case "minecraft:all_of":
    case "minecraft:any_of": {
      const predicates = asArray(object.predicates, `${what}.predicates`).map((inner, index) => parseBlockPredicate(inner, catalog, `${what}.predicates[${index}]`));
      if (type === "minecraft:all_of") return { test: (level, x, y, z) => predicates.every((predicate) => predicate.test(level, x, y, z)) };
      return { test: (level, x, y, z) => predicates.some((predicate) => predicate.test(level, x, y, z)) };
    }
    case "minecraft:matching_blocks": {
      const blocks = parseBlockSet(object.blocks, catalog, `${what}.blocks`);
      return { test: (level, x, y, z) => blocks.contains(level, level.getBlockInfo(x + offsetX, y + offsetY, z + offsetZ).name) };
    }
    case "minecraft:matching_block_tag": {
      const tagId = normalizeTagId(requireString(object, "tag", what));
      return { test: (level, x, y, z) => level.blockTags.is(level.getBlockInfo(x + offsetX, y + offsetY, z + offsetZ).name, tagId) };
    }
    case "minecraft:matching_fluids": {
      const fluids = parseFluidSet(object.fluids, `${what}.fluids`);
      return { test: (level, x, y, z) => fluids.has(level.getBlockInfo(x + offsetX, y + offsetY, z + offsetZ).fluid) };
    }
    case "minecraft:solid":
      return { test: (level, x, y, z) => level.getBlockInfo(x + offsetX, y + offsetY, z + offsetZ).isSolid };
    case "minecraft:replaceable":
      return { test: (level, x, y, z) => level.getBlockInfo(x + offsetX, y + offsetY, z + offsetZ).isReplaceable };
    case "minecraft:has_sturdy_face": {
      const direction = Direction.fromName(requireString(object, "direction", what));
      const faceBit = 1 << direction.ordinal;
      return { test: (level, x, y, z) => (level.getBlockInfo(x + offsetX, y + offsetY, z + offsetZ).sturdyFaces & faceBit) !== 0 };
    }
    case "minecraft:would_survive": {
      const state = parseBlockState(object.state, catalog, `${what}.state`);
      return { test: (level, x, y, z) => level.survival.canSurvive(state, level, x + offsetX, y + offsetY, z + offsetZ) };
    }
    case "minecraft:inside_world_bounds":
      return { test: (level, _x, y) => !level.isOutsideBuildHeight(y + offsetY) };
    default:
      throw new Error(`Unknown block predicate type ${type}`);
  }
}
