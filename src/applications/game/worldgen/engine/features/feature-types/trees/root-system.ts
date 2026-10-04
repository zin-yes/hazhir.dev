// Mirrors RootSystemFeature (minecraft:root_system, the azalea tree): a column of rooted dirt under a tree placed
// through a nested placed feature, plus hanging roots on the ceiling above the origin.

import { isFluidLava, isFluidWater, normalizeTagId, SturdyFace } from "../../../block-state";
import type { RandomSource } from "../../../random";
import { BlockPos, MutableBlockPos } from "../../core/block-pos";
import { defineFeatureType, type FeatureChunkGenerator } from "../../feature/feature-type";
import type { PlacedFeature } from "../../feature/placed-feature";
import type { WorldGenLevel } from "../../level/world-gen-level";
import type { BlockPredicate } from "../../providers/block-predicates";
import type { BlockStateProvider } from "../../providers/block-state-providers";
import { asObject, requireNumber, requireString } from "../../providers/json-fields";
import { parseTreeStateProvider } from "./tree-world";

export interface RootSystemConfig {
  readonly treeFeature: PlacedFeature;
  readonly requiredVerticalSpaceForTree: number;
  readonly rootRadius: number;
  readonly rootReplaceableTag: string;
  readonly rootStateProvider: BlockStateProvider;
  readonly rootPlacementAttempts: number;
  readonly rootColumnMaxHeight: number;
  readonly hangingRootRadius: number;
  readonly hangingRootsVerticalSpan: number;
  readonly hangingRootStateProvider: BlockStateProvider;
  readonly hangingRootPlacementAttempts: number;
  readonly allowedVerticalWaterForTree: number;
  readonly allowedTreePosition: BlockPredicate;
}

function isAllowedTreeSpace(level: WorldGenLevel, x: number, y: number, z: number, heightAboveOrigin: number, allowedVerticalWater: number): boolean {
  const info = level.getBlockInfo(x, y, z);
  if (info.isAir) return true;
  return heightAboveOrigin + 1 <= allowedVerticalWater && isFluidWater(info.fluid);
}

function hasSpaceForTree(level: WorldGenLevel, config: RootSystemConfig, x: number, y: number, z: number): boolean {
  for (let step = 1; step <= config.requiredVerticalSpaceForTree; step++) {
    if (!isAllowedTreeSpace(level, x, y + step, z, step, config.allowedVerticalWaterForTree)) return false;
  }
  return true;
}

function placeRootedDirt(level: WorldGenLevel, config: RootSystemConfig, random: RandomSource, baseX: number, baseZ: number, y: number): void {
  const radius = config.rootRadius;
  const replaceable = level.blockTags.members(config.rootReplaceableTag);
  let x = baseX;
  let z = baseZ;
  for (let attempt = 0; attempt < config.rootPlacementAttempts; attempt++) {
    x += random.nextIntBounded(radius) - random.nextIntBounded(radius);
    const zOffset = random.nextIntBounded(radius) - random.nextIntBounded(radius);
    z += zOffset;
    if (replaceable.has(level.getBlockInfo(x, y, z).name)) level.setBlock(x, y, z, config.rootStateProvider.getState(random, x, y, z), 2);
    x = baseX;
    z = baseZ;
  }
}

function placeDirt(origin: BlockPos, topY: number, level: WorldGenLevel, config: RootSystemConfig, random: RandomSource): void {
  for (let y = origin.y; y < topY; y++) placeRootedDirt(level, config, random, origin.x, origin.z, y);
}

function placeDirtAndTree(level: WorldGenLevel, generator: FeatureChunkGenerator, config: RootSystemConfig, random: RandomSource, position: MutableBlockPos, origin: BlockPos): boolean {
  for (let column = 0; column < config.rootColumnMaxHeight; column++) {
    position.setY(position.y + 1);
    if (!config.allowedTreePosition.test(level, position.x, position.y, position.z) || !hasSpaceForTree(level, config, position.x, position.y, position.z)) continue;
    const below = level.getBlockInfo(position.x, position.y - 1, position.z);
    if (isFluidLava(below.fluid) || !below.isSolid) return false;
    if (!config.treeFeature.place(level, generator, random, position.immutable())) continue;
    placeDirt(origin, origin.y + column, level, config, random);
    return true;
  }
  return false;
}

function placeHangingRoots(level: WorldGenLevel, config: RootSystemConfig, random: RandomSource, origin: BlockPos): void {
  const radius = config.hangingRootRadius;
  const verticalSpan = config.hangingRootsVerticalSpan;
  for (let attempt = 0; attempt < config.hangingRootPlacementAttempts; attempt++) {
    const x = origin.x + (random.nextIntBounded(radius) - random.nextIntBounded(radius));
    const y = origin.y + (random.nextIntBounded(verticalSpan) - random.nextIntBounded(verticalSpan));
    const z = origin.z + (random.nextIntBounded(radius) - random.nextIntBounded(radius));
    if (!level.isEmptyBlock(x, y, z)) continue;
    const state = config.hangingRootStateProvider.getState(random, x, y, z);
    if (!level.survival.canSurvive(state, level, x, y, z)) continue;
    if ((level.getBlockInfo(x, y + 1, z).sturdyFaces & SturdyFace.down) === 0) continue;
    level.setBlock(x, y, z, state, 2);
  }
}

export const rootSystemFeature = defineFeatureType<RootSystemConfig>({
  id: "minecraft:root_system",
  parseConfig(json, parser) {
    const config = asObject(json, "root_system config");
    const what = "root_system";
    return {
      treeFeature: parser.placedFeature(config.feature, `${what}.feature`),
      requiredVerticalSpaceForTree: requireNumber(config, "required_vertical_space_for_tree", what),
      rootRadius: requireNumber(config, "root_radius", what),
      rootReplaceableTag: normalizeTagId(requireString(config, "root_replaceable", what)),
      rootStateProvider: parseTreeStateProvider(parser, config.root_state_provider, `${what}.root_state_provider`),
      rootPlacementAttempts: requireNumber(config, "root_placement_attempts", what),
      rootColumnMaxHeight: requireNumber(config, "root_column_max_height", what),
      hangingRootRadius: requireNumber(config, "hanging_root_radius", what),
      hangingRootsVerticalSpan: requireNumber(config, "hanging_roots_vertical_span", what),
      hangingRootStateProvider: parseTreeStateProvider(parser, config.hanging_root_state_provider, `${what}.hanging_root_state_provider`),
      hangingRootPlacementAttempts: requireNumber(config, "hanging_root_placement_attempts", what),
      allowedVerticalWaterForTree: requireNumber(config, "allowed_vertical_water_for_tree", what),
      allowedTreePosition: parser.blockPredicate(config.allowed_tree_position, `${what}.allowed_tree_position`),
    };
  },
  place({ level, generator, random, origin, config }) {
    if (!level.getBlockInfo(origin.x, origin.y, origin.z).isAir) return false;
    const originPosition = BlockPos.of(origin);
    const position = new MutableBlockPos(origin.x, origin.y, origin.z);
    if (placeDirtAndTree(level, generator, config, random, position, originPosition)) placeHangingRoots(level, config, random, originPosition);
    return true;
  },
});
