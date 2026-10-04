// Block queries and small helpers shared by the tree feature, trunk/foliage/root placers and tree decorators.
// They mirror TreeFeature.validTreePos / isAirOrLeaves, Feature.isDirt and the fluid checks the placers use.

import { type BlockStateCatalog, type BlockStateInfo, type BlockTagIndex, isFluidWater } from "../../../block-state";
import { parseBlockState } from "../../../chunk";
import type { FeatureParser } from "../../feature/feature-parser";
import type { BlockStateProvider } from "../../providers/block-state-providers";
import type { JsonValue } from "../../providers/json-fields";
import type { WorldGenLevel } from "../../level/world-gen-level";

interface TreeTagSets {
  readonly replaceableByTrees: ReadonlySet<string>;
  readonly logs: ReadonlySet<string>;
  readonly leaves: ReadonlySet<string>;
  readonly dirt: ReadonlySet<string>;
  readonly mushroomGrowBlock: ReadonlySet<string>;
}

const tagSetsByIndex = new WeakMap<BlockTagIndex, TreeTagSets>();

function tagSetsOf(level: WorldGenLevel): TreeTagSets {
  let tagSets = tagSetsByIndex.get(level.blockTags);
  if (!tagSets) {
    tagSets = {
      replaceableByTrees: level.blockTags.members("minecraft:replaceable_by_trees"),
      logs: level.blockTags.members("minecraft:logs"),
      leaves: level.blockTags.members("minecraft:leaves"),
      dirt: level.blockTags.members("minecraft:dirt"),
      mushroomGrowBlock: level.blockTags.members("minecraft:mushroom_grow_block"),
    };
    tagSetsByIndex.set(level.blockTags, tagSets);
  }
  return tagSets;
}

/** TreeFeature.validTreePos: air or a block in #replaceable_by_trees. */
export function isValidTreePosition(level: WorldGenLevel, x: number, y: number, z: number): boolean {
  const info = level.getBlockInfo(x, y, z);
  return info.isAir || tagSetsOf(level).replaceableByTrees.has(info.name);
}

/** TreeFeature.isAirOrLeaves. */
export function isAirOrLeaves(level: WorldGenLevel, x: number, y: number, z: number): boolean {
  const info = level.getBlockInfo(x, y, z);
  return info.isAir || tagSetsOf(level).leaves.has(info.name);
}

export function isLogBlock(level: WorldGenLevel, blockName: string): boolean {
  return tagSetsOf(level).logs.has(blockName);
}

export function isLeavesBlock(level: WorldGenLevel, blockName: string): boolean {
  return tagSetsOf(level).leaves.has(blockName);
}

/** Feature.isDirt: block tag #dirt (grass block, podzol, mycelium, ...). */
export function isDirtBlock(level: WorldGenLevel, blockName: string): boolean {
  return tagSetsOf(level).dirt.has(blockName);
}

export function isMushroomGrowBlock(level: WorldGenLevel, blockName: string): boolean {
  return tagSetsOf(level).mushroomGrowBlock.has(blockName);
}

export function isVine(info: BlockStateInfo): boolean {
  return info.name === "minecraft:vine";
}

/** The foliage and root placers' waterlogging rule: the block is waterlogged when a water fluid sits at the position. */
export function withWaterloggedFromFluid(level: WorldGenLevel, state: string, x: number, y: number, z: number, anyWaterFluid: boolean): string {
  if (!level.blockStates.hasProperty(state, "waterlogged")) return state;
  const fluid = level.getBlockInfo(x, y, z).fluid;
  const wet = anyWaterFluid ? isFluidWater(fluid) : fluid === "water";
  return level.blockStates.withProperty(state, "waterlogged", wet ? "true" : "false");
}

const sanitizedStatesByCatalog = new WeakMap<BlockStateCatalog, Map<string, string>>();

/**
 * BlockState.CODEC ignores properties the block does not have (Terralith writes `snowy` on moss_block); the shared
 * state parser keeps them, so providers used by tree features drop them here.
 */
function dropUnknownProperties(catalog: BlockStateCatalog, state: string): string {
  if (!state.includes("[")) return state;
  let cache = sanitizedStatesByCatalog.get(catalog);
  if (!cache) {
    cache = new Map();
    sanitizedStatesByCatalog.set(catalog, cache);
  }
  let sanitized = cache.get(state);
  if (sanitized === undefined) {
    const { name, properties } = parseBlockState(state);
    if (catalog.isKnownBlock(name)) {
      const known = catalog.defaultProperties(name);
      const kept = Object.keys(properties).filter((property) => property in known);
      sanitized = kept.length === Object.keys(properties).length ? state : catalog.normalize(kept.length === 0 ? name : `${name}[${kept.map((property) => `${property}=${properties[property]}`).join(",")}]`);
    } else {
      sanitized = state;
    }
    cache.set(state, sanitized);
  }
  return sanitized;
}

/** parser.blockStateProvider whose states never carry properties the block does not define. */
export function parseTreeStateProvider(parser: FeatureParser, json: JsonValue | undefined, what: string): BlockStateProvider {
  const provider = parser.blockStateProvider(json, what);
  return { getState: (random, x, y, z) => dropUnknownProperties(parser.blockStates, provider.getState(random, x, y, z)) };
}
