// Mirrors DripstoneClusterFeature (minecraft:dripstone_cluster) with DripstoneClusterConfiguration.

import { isFluidWater } from "../../../../block-state";
import type { RandomSource } from "../../../../random";
import { Direction } from "../../../core/direction";
import { defineFeatureType } from "../../../feature/feature-type";
import type { WorldGenLevel } from "../../../level/world-gen-level";
import { asObject, requireNumber } from "../../../providers/json-fields";
import { type FloatProvider, type IntProvider, mthNormal, randomBetweenInclusive } from "../../../providers/value-providers";
import { Column } from "../column";
import { requireInt } from "../config-fields";
import { clampedMapDouble, clampedMapFloat, clampFloat, fround } from "../java-math";
import {
  BASE_STONE_OVERWORLD_TAG,
  growPointedDripstone,
  isBlockNamed,
  isEmptyOrWater,
  isEmptyOrWaterState,
  isNeitherEmptyNorWaterState,
  placeDripstoneBlockIfPossible,
} from "./dripstone-utils";

export interface DripstoneClusterConfig {
  readonly floorToCeilingSearchRange: number;
  readonly height: IntProvider;
  readonly radius: IntProvider;
  readonly maxStalagmiteStalactiteHeightDiff: number;
  readonly heightDeviation: number;
  readonly dripstoneBlockLayerThickness: IntProvider;
  readonly density: FloatProvider;
  readonly wetness: FloatProvider;
  readonly chanceOfDripstoneColumnAtMaxDistanceFromCenter: number;
  readonly maxDistanceFromEdgeAffectingChanceOfDripstoneColumn: number;
  readonly maxDistanceFromCenterAffectingHeightBias: number;
}

function isLava(level: WorldGenLevel, x: number, y: number, z: number): boolean {
  return isBlockNamed(level, x, y, z, "minecraft:lava");
}

function canBeAdjacentToWater(level: WorldGenLevel, x: number, y: number, z: number): boolean {
  const info = level.getBlockInfo(x, y, z);
  return level.blockTags.is(info.name, BASE_STONE_OVERWORLD_TAG) || isFluidWater(info.fluid);
}

/** DripstoneClusterFeature.canPlacePool. */
function canPlacePool(level: WorldGenLevel, x: number, y: number, z: number): boolean {
  const name = level.getBlockInfo(x, y, z).name;
  if (name === "minecraft:water" || name === "minecraft:dripstone_block" || name === "minecraft:pointed_dripstone") return false;
  if (isFluidWater(level.getBlockInfo(x, y + 1, z).fluid)) return false;
  for (const direction of Direction.HORIZONTAL) {
    if (!canBeAdjacentToWater(level, x + direction.stepX, y, z + direction.stepZ)) return false;
  }
  return canBeAdjacentToWater(level, x, y - 1, z);
}

function replaceBlocksWithDripstoneBlocks(level: WorldGenLevel, x: number, startY: number, z: number, thickness: number, direction: Direction): void {
  let y = startY;
  for (let layer = 0; layer < thickness; layer++) {
    if (!placeDripstoneBlockIfPossible(level, x, y, z)) return;
    y += direction.stepY;
  }
}

/** DripstoneClusterFeature.getChanceOfStalagmiteOrStalactite: the float overload of Mth.clampedMap. */
function getChanceOfStalagmiteOrStalactite(radiusX: number, radiusZ: number, offsetX: number, offsetZ: number, config: DripstoneClusterConfig): number {
  const distanceFromEdgeX = radiusX - Math.abs(offsetX);
  const distanceFromEdgeZ = radiusZ - Math.abs(offsetZ);
  const distanceFromEdge = Math.min(distanceFromEdgeX, distanceFromEdgeZ);
  return clampedMapFloat(distanceFromEdge, 0, config.maxDistanceFromEdgeAffectingChanceOfDripstoneColumn, config.chanceOfDripstoneColumnAtMaxDistanceFromCenter, 1);
}

/** DripstoneClusterFeature.getDripstoneHeight. */
function getDripstoneHeight(random: RandomSource, offsetX: number, offsetZ: number, density: number, maxHeight: number, config: DripstoneClusterConfig): number {
  if (random.nextFloat() > density) return 0;
  const distanceFromCenter = Math.abs(offsetX) + Math.abs(offsetZ);
  const mean = fround(clampedMapDouble(distanceFromCenter, 0, config.maxDistanceFromCenterAffectingHeightBias, maxHeight / 2, 0));
  // ClampedNormalFloat.sample(random, mean, heightDeviation, 0, maxHeight)
  return Math.trunc(clampFloat(mthNormal(random, mean, fround(config.heightDeviation)), 0, fround(maxHeight)));
}

function placeColumn(
  level: WorldGenLevel,
  random: RandomSource,
  x: number,
  y: number,
  z: number,
  offsetX: number,
  offsetZ: number,
  wetness: number,
  chanceOfColumn: number,
  height: number,
  density: number,
  config: DripstoneClusterConfig,
): void {
  const scanned = Column.scan(
    (scanX, scanY, scanZ) => level.getBlockState(scanX, scanY, scanZ),
    { x, y, z },
    config.floorToCeilingSearchRange,
    (state) => isEmptyOrWaterState(level, state),
    (state) => isNeitherEmptyNorWaterState(level, state),
  );
  if (scanned === undefined) return;
  const ceiling = scanned.ceiling;
  const floor = scanned.floor;
  if (ceiling === undefined && floor === undefined) return;
  const placePool = random.nextFloat() < wetness;
  let column: Column;
  if (placePool && floor !== undefined && canPlacePool(level, x, floor, z)) {
    column = scanned.withFloor(floor - 1);
    level.setBlock(x, floor, z, "minecraft:water[level=0]", 2);
  } else {
    column = scanned;
  }
  const columnFloor = column.floor;
  const placeStalactite = random.nextDouble() < chanceOfColumn;
  let stalactiteHeight: number;
  if (ceiling !== undefined && placeStalactite && !isLava(level, x, ceiling, z)) {
    const thickness = config.dripstoneBlockLayerThickness.sample(random);
    replaceBlocksWithDripstoneBlocks(level, x, ceiling, z, thickness, Direction.UP);
    const maxHeight = columnFloor !== undefined ? Math.min(height, ceiling - columnFloor) : height;
    stalactiteHeight = getDripstoneHeight(random, offsetX, offsetZ, density, maxHeight, config);
  } else {
    stalactiteHeight = 0;
  }
  const placeStalagmite = random.nextDouble() < chanceOfColumn;
  let stalagmiteHeight: number;
  if (columnFloor !== undefined && placeStalagmite && !isLava(level, x, columnFloor, z)) {
    const thickness = config.dripstoneBlockLayerThickness.sample(random);
    replaceBlocksWithDripstoneBlocks(level, x, columnFloor, z, thickness, Direction.DOWN);
    if (ceiling !== undefined) {
      const maxDifference = config.maxStalagmiteStalactiteHeightDiff;
      stalagmiteHeight = Math.max(0, stalactiteHeight + randomBetweenInclusive(random, -maxDifference, maxDifference));
    } else {
      stalagmiteHeight = getDripstoneHeight(random, offsetX, offsetZ, density, height, config);
    }
  } else {
    stalagmiteHeight = 0;
  }
  let finalStalactiteHeight: number;
  let finalStalagmiteHeight: number;
  if (ceiling !== undefined && columnFloor !== undefined && ceiling - stalactiteHeight <= columnFloor + stalagmiteHeight) {
    const lowestStalactiteBottom = Math.max(ceiling - stalactiteHeight, columnFloor + 1);
    const highestStalagmiteTop = Math.min(columnFloor + stalagmiteHeight, ceiling - 1);
    const actualStalactiteBottom = randomBetweenInclusive(random, lowestStalactiteBottom, highestStalagmiteTop + 1);
    const actualStalagmiteTop = actualStalactiteBottom - 1;
    finalStalactiteHeight = ceiling - actualStalactiteBottom;
    finalStalagmiteHeight = actualStalagmiteTop - columnFloor;
  } else {
    finalStalactiteHeight = stalactiteHeight;
    finalStalagmiteHeight = stalagmiteHeight;
  }
  const columnHeight = column.height;
  const mergeTips =
    random.nextBoolean() && finalStalactiteHeight > 0 && finalStalagmiteHeight > 0 && columnHeight !== undefined && finalStalactiteHeight + finalStalagmiteHeight === columnHeight;
  if (ceiling !== undefined) growPointedDripstone(level, x, ceiling - 1, z, Direction.DOWN, finalStalactiteHeight, mergeTips);
  if (columnFloor !== undefined) growPointedDripstone(level, x, columnFloor + 1, z, Direction.UP, finalStalagmiteHeight, mergeTips);
}

export const dripstoneClusterFeature = defineFeatureType<DripstoneClusterConfig>({
  id: "minecraft:dripstone_cluster",
  parseConfig(json, parser) {
    const config = asObject(json, "dripstone_cluster config");
    return {
      floorToCeilingSearchRange: requireInt(config, "floor_to_ceiling_search_range", "dripstone_cluster"),
      height: parser.intProvider(config.height, "dripstone_cluster.height"),
      radius: parser.intProvider(config.radius, "dripstone_cluster.radius"),
      maxStalagmiteStalactiteHeightDiff: requireInt(config, "max_stalagmite_stalactite_height_diff", "dripstone_cluster"),
      heightDeviation: requireInt(config, "height_deviation", "dripstone_cluster"),
      dripstoneBlockLayerThickness: parser.intProvider(config.dripstone_block_layer_thickness, "dripstone_cluster.dripstone_block_layer_thickness"),
      density: parser.floatProvider(config.density, "dripstone_cluster.density"),
      wetness: parser.floatProvider(config.wetness, "dripstone_cluster.wetness"),
      chanceOfDripstoneColumnAtMaxDistanceFromCenter: fround(requireNumber(config, "chance_of_dripstone_column_at_max_distance_from_center", "dripstone_cluster")),
      maxDistanceFromEdgeAffectingChanceOfDripstoneColumn: requireInt(config, "max_distance_from_edge_affecting_chance_of_dripstone_column", "dripstone_cluster"),
      maxDistanceFromCenterAffectingHeightBias: requireInt(config, "max_distance_from_center_affecting_height_bias", "dripstone_cluster"),
    };
  },
  place({ level, random, origin, config }) {
    if (!isEmptyOrWater(level, origin.x, origin.y, origin.z)) return false;
    const height = config.height.sample(random);
    const wetness = config.wetness.sample(random);
    const density = config.density.sample(random);
    const radiusX = config.radius.sample(random);
    const radiusZ = config.radius.sample(random);
    for (let offsetX = -radiusX; offsetX <= radiusX; offsetX++) {
      for (let offsetZ = -radiusZ; offsetZ <= radiusZ; offsetZ++) {
        const chanceOfColumn = getChanceOfStalagmiteOrStalactite(radiusX, radiusZ, offsetX, offsetZ, config);
        placeColumn(level, random, origin.x + offsetX, origin.y, origin.z + offsetZ, offsetX, offsetZ, wetness, chanceOfColumn, height, density, config);
      }
    }
    return true;
  },
});
