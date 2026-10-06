// Mirrors UnderwaterMagmaFeature (minecraft:underwater_magma) with UnderwaterMagmaConfiguration.

import { Direction } from "../../core/direction";
import { defineFeatureType } from "../../feature/feature-type";
import type { WorldGenLevel } from "../../level/world-gen-level";
import { asObject, requireNumber } from "../../providers/json-fields";
import { addFeatureCounter, endFeatureStep, noteFeatureRejection, startFeatureStep } from "../../profiling/feature-profiling";
import { betweenClosed } from "./block-iteration";
import { Column } from "./column";
import { requireInt } from "./config-fields";
import { fround } from "./java-math";

export interface UnderwaterMagmaConfig {
  readonly floorSearchRange: number;
  readonly placementRadiusAroundFloor: number;
  readonly placementProbabilityPerValidPosition: number;
}

function isWaterOrAir(level: WorldGenLevel, x: number, y: number, z: number): boolean {
  const info = level.getBlockInfo(x, y, z);
  return info.name === "minecraft:water" || info.isAir;
}

function isValidPlacement(level: WorldGenLevel, x: number, y: number, z: number): boolean {
  if (isWaterOrAir(level, x, y, z) || isWaterOrAir(level, x, y - 1, z)) return false;
  for (const direction of Direction.HORIZONTAL) {
    if (isWaterOrAir(level, x + direction.stepX, y, z + direction.stepZ)) return false;
  }
  return true;
}

function findFloorY(level: WorldGenLevel, x: number, y: number, z: number, config: UnderwaterMagmaConfig): number | undefined {
  const column = Column.scan(
    (scanX, scanY, scanZ) => level.getBlockState(scanX, scanY, scanZ),
    { x, y, z },
    config.floorSearchRange,
    (state) => level.blockStates.info(state).name === "minecraft:water",
    (state) => level.blockStates.info(state).name !== "minecraft:water",
  );
  return column?.floor;
}

export const underwaterMagmaFeature = defineFeatureType<UnderwaterMagmaConfig>({
  id: "minecraft:underwater_magma",
  parseConfig(json) {
    const config = asObject(json, "underwater_magma config");
    return {
      floorSearchRange: requireInt(config, "floor_search_range", "underwater_magma"),
      placementRadiusAroundFloor: requireInt(config, "placement_radius_around_floor", "underwater_magma"),
      placementProbabilityPerValidPosition: fround(requireNumber(config, "placement_probability_per_valid_position", "underwater_magma")),
    };
  },
  place({ level, random, origin, config }) {
    const floorY = findFloorY(level, origin.x, origin.y, origin.z, config);
    if (floorY === undefined) {
      noteFeatureRejection("noFloor");
      return false;
    }
    const radius = config.placementRadiusAroundFloor;
    let placedCount = 0;
    let candidateCellCount = 0;
    const placeMark = startFeatureStep("feature.underwater_magma.place", level);
    for (const position of betweenClosed(origin.x - radius, floorY - radius, origin.z - radius, origin.x + radius, floorY + radius, origin.z + radius)) {
      candidateCellCount++;
      if (!(random.nextFloat() < config.placementProbabilityPerValidPosition)) continue;
      if (!isValidPlacement(level, position.x, position.y, position.z)) continue;
      level.setBlock(position.x, position.y, position.z, "minecraft:magma_block", 2);
      placedCount++;
    }
    endFeatureStep("feature.underwater_magma.place", level, placeMark);
    addFeatureCounter("feature.underwater_magma.candidateCells", candidateCellCount);
    return placedCount > 0;
  },
});
