// Mirrors VegetationPatchFeature (minecraft:vegetation_patch) and WaterloggedVegetationPatchFeature
// (minecraft:waterlogged_vegetation_patch): a ground patch on a cave floor or ceiling, then vegetation placed on
// the patch columns in java.util.HashSet iteration order.

import { normalizeTagId } from "../../../block-state";
import type { RandomSource } from "../../../random";
import { Direction } from "../../core/direction";
import { defineFeatureType, type FeatureChunkGenerator, type FeatureType } from "../../feature/feature-type";
import type { FeatureParser } from "../../feature/feature-parser";
import type { PlacedFeature } from "../../feature/placed-feature";
import type { WorldGenLevel } from "../../level/world-gen-level";
import { endFeatureStep, noteFeatureRejection, startFeatureStep } from "../../profiling/feature-profiling";
import { BlockPos } from "../../core/block-pos";
import type { BlockStateProvider } from "../../providers/block-state-providers";
import { asObject, type JsonValue, requireNumber, requireString } from "../../providers/json-fields";
import type { IntProvider } from "../../providers/value-providers";
import { isFaceSturdy } from "./support/block-faces";
import { JavaBlockPosHashSet } from "./support/java-block-pos-hash-set";

const fround = Math.fround;

export interface VegetationPatchConfig {
  readonly replaceableTag: string;
  readonly groundState: BlockStateProvider;
  readonly vegetationFeature: PlacedFeature;
  /** CaveSurface.getDirection: CEILING is UP, FLOOR is DOWN. */
  readonly surfaceDirection: Direction;
  readonly depth: IntProvider;
  readonly extraBottomBlockChance: number;
  readonly verticalRange: number;
  readonly vegetationChance: number;
  readonly xzRadius: IntProvider;
  readonly extraEdgeColumnChance: number;
}

type PatchPositions = JavaBlockPosHashSet<null>;

function parseVegetationPatchConfig(json: JsonValue | undefined, parser: FeatureParser): VegetationPatchConfig {
  const config = asObject(json, "vegetation_patch config");
  const surfaceName = requireString(config, "surface", "vegetation_patch");
  if (surfaceName !== "ceiling" && surfaceName !== "floor") throw new Error(`vegetation_patch: unknown surface "${surfaceName}"`);
  return {
    replaceableTag: normalizeTagId(requireString(config, "replaceable", "vegetation_patch")),
    groundState: parser.blockStateProvider(config.ground_state, "vegetation_patch.ground_state"),
    vegetationFeature: parser.placedFeature(config.vegetation_feature, "vegetation_patch.vegetation_feature"),
    surfaceDirection: surfaceName === "ceiling" ? Direction.UP : Direction.DOWN,
    depth: parser.intProvider(config.depth, "vegetation_patch.depth"),
    extraBottomBlockChance: fround(requireNumber(config, "extra_bottom_block_chance", "vegetation_patch")),
    verticalRange: requireNumber(config, "vertical_range", "vegetation_patch"),
    vegetationChance: fround(requireNumber(config, "vegetation_chance", "vegetation_patch")),
    xzRadius: parser.intProvider(config.xz_radius, "vegetation_patch.xz_radius"),
    extraEdgeColumnChance: fround(requireNumber(config, "extra_edge_column_chance", "vegetation_patch")),
  };
}

/** VegetationPatchFeature.placeGround: false when the first ground block could not be placed. */
function placeGround(level: WorldGenLevel, config: VegetationPatchConfig, random: RandomSource, groundX: number, groundY: number, groundZ: number, depth: number): boolean {
  let y = groundY;
  for (let layer = 0; layer < depth; layer++) {
    const newState = config.groundState.getState(random, groundX, y, groundZ);
    const existing = level.getBlockInfo(groundX, y, groundZ);
    // BlockState.is(Block): the same block, whatever the state properties.
    if (existing.name === level.blockStates.info(newState).name) continue;
    if (!level.blockTags.is(existing.name, config.replaceableTag)) return layer !== 0;
    level.setBlock(groundX, y, groundZ, newState, 2);
    y += config.surfaceDirection.stepY;
  }
  return true;
}

/** VegetationPatchFeature.placeGroundPatch. */
function placeGroundPatch(level: WorldGenLevel, config: VegetationPatchConfig, random: RandomSource, origin: BlockPos, radiusX: number, radiusZ: number): PatchPositions {
  const surface = config.surfaceDirection;
  const awayFromSurface = surface.opposite;
  const patchPositions: PatchPositions = new JavaBlockPosHashSet();
  for (let offsetX = -radiusX; offsetX <= radiusX; offsetX++) {
    const isEdgeX = offsetX === -radiusX || offsetX === radiusX;
    for (let offsetZ = -radiusZ; offsetZ <= radiusZ; offsetZ++) {
      const isEdgeZ = offsetZ === -radiusZ || offsetZ === radiusZ;
      const isEdge = isEdgeX || isEdgeZ;
      const isCorner = isEdgeX && isEdgeZ;
      const isEdgeWithoutCorner = isEdge && !isCorner;
      if (isCorner || (isEdgeWithoutCorner && (config.extraEdgeColumnChance === 0 || random.nextFloat() > config.extraEdgeColumnChance))) continue;
      const x = origin.x + offsetX;
      const z = origin.z + offsetZ;
      let y = origin.y;
      for (let steps = 0; level.getBlockInfo(x, y, z).isAir && steps < config.verticalRange; steps++) y += surface.stepY;
      for (let steps = 0; !level.getBlockInfo(x, y, z).isAir && steps < config.verticalRange; steps++) y += awayFromSurface.stepY;
      const groundY = y + surface.stepY;
      if (!level.isEmptyBlock(x, y, z) || !isFaceSturdy(level, x, groundY, z, awayFromSurface)) continue;
      const depth = config.depth.sample(random) + (config.extraBottomBlockChance > 0 && random.nextFloat() < config.extraBottomBlockChance ? 1 : 0);
      if (!placeGround(level, config, random, x, groundY, z, depth)) continue;
      patchPositions.add(x, groundY, z, null);
    }
  }
  return patchPositions;
}

/** VegetationPatchFeature.placeVegetation: the placed feature at the block above the ground (away from the surface). */
function placeVegetation(level: WorldGenLevel, config: VegetationPatchConfig, generator: FeatureChunkGenerator, random: RandomSource, x: number, y: number, z: number): boolean {
  return config.vegetationFeature.place(level, generator, random, new BlockPos(x, y + config.surfaceDirection.opposite.stepY, z));
}

function defineVegetationPatchType(
  id: string,
  waterlogged: boolean,
): FeatureType<VegetationPatchConfig> {
  return defineFeatureType<VegetationPatchConfig>({
    id,
    parseConfig: parseVegetationPatchConfig,
    place({ config, level, generator, random, origin }) {
      const radiusX = config.xzRadius.sample(random) + 1;
      const radiusZ = config.xzRadius.sample(random) + 1;
      const groundMark = startFeatureStep("feature.vegetation_patch.ground", level);
      let patchPositions = placeGroundPatch(level, config, random, origin, radiusX, radiusZ);
      endFeatureStep("feature.vegetation_patch.ground", level, groundMark);
      if (waterlogged) {
        const waterlogMark = startFeatureStep("feature.vegetation_patch.waterlog", level);
        patchPositions = waterlogPatch(level, patchPositions);
        endFeatureStep("feature.vegetation_patch.waterlog", level, waterlogMark);
      }
      const vegetationMark = startFeatureStep("feature.vegetation_patch.vegetation", level);
      for (const { x, y, z } of patchPositions.entries()) {
        if (!(config.vegetationChance > 0) || !(random.nextFloat() < config.vegetationChance)) continue;
        if (waterlogged) placeWaterloggedVegetation(level, config, generator, random, x, y, z);
        else placeVegetation(level, config, generator, random, x, y, z);
      }
      endFeatureStep("feature.vegetation_patch.vegetation", level, vegetationMark);
      if (patchPositions.size === 0) noteFeatureRejection("emptyGroundPatch");
      return patchPositions.size > 0;
    },
  });
}

const EXPOSURE_DIRECTIONS = [Direction.NORTH, Direction.EAST, Direction.SOUTH, Direction.WEST, Direction.DOWN];

/** WaterloggedVegetationPatchFeature.placeGroundPatch: unexposed patch blocks become water. */
function waterlogPatch(level: WorldGenLevel, groundPositions: PatchPositions): PatchPositions {
  const waterPositions: PatchPositions = new JavaBlockPosHashSet();
  for (const { x, y, z } of groundPositions.entries()) {
    const exposed = EXPOSURE_DIRECTIONS.some((direction) => !isFaceSturdy(level, x + direction.stepX, y + direction.stepY, z + direction.stepZ, direction.opposite));
    if (!exposed) waterPositions.add(x, y, z, null);
  }
  for (const { x, y, z } of waterPositions.entries()) level.setBlock(x, y, z, "minecraft:water[level=0]", 2);
  return waterPositions;
}

/** WaterloggedVegetationPatchFeature.placeVegetation. */
function placeWaterloggedVegetation(level: WorldGenLevel, config: VegetationPatchConfig, generator: FeatureChunkGenerator, random: RandomSource, x: number, y: number, z: number): boolean {
  if (!placeVegetation(level, config, generator, random, x, y - 1, z)) return false;
  const state = level.getBlockState(x, y, z);
  if (level.blockStates.hasProperty(state, "waterlogged") && level.blockStates.propertiesOf(state).waterlogged === "false") {
    level.setBlock(x, y, z, level.blockStates.withProperty(state, "waterlogged", "true"), 2);
  }
  return true;
}

export const vegetationPatchFeature = defineVegetationPatchType("minecraft:vegetation_patch", false);
export const waterloggedVegetationPatchFeature = defineVegetationPatchType("minecraft:waterlogged_vegetation_patch", true);
