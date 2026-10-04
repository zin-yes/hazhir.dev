// Mirrors OreFeature (minecraft:ore) and ScatteredOreFeature (minecraft:scattered_ore) with OreConfiguration.
// OreFeature writes straight into chunk sections (LevelChunkSection.setBlockState) so heightmaps are not updated in
// Java; here the write goes through level.setBlock, which only differs from Java when an ore replaces an air or
// fluid block (no vanilla or Terralith target does).

import type { RandomSource } from "../../../random";
import { defineFeatureType } from "../../feature/feature-type";
import type { WorldGenLevel } from "../../level/world-gen-level";
import { asArray, asObject, requireNumber } from "../../providers/json-fields";
import { Direction } from "../../core/direction";
import { addFeatureCounter, endFeatureStep, startFeatureStep } from "../../profiling/feature-profiling";
import { fround, FLOAT_PI, javaRoundFloat, mthCeil, mthFloor, mthLerp, mthSin } from "./java-math";
import { parseBlockStateIgnoringUnknownProperties, requireInt } from "./config-fields";
import { parseRuleTest, type RuleTest } from "./rule-test";

export interface OreTarget {
  readonly target: RuleTest;
  readonly state: string;
}

export interface OreConfig {
  readonly targets: readonly OreTarget[];
  readonly size: number;
  /** Float in [0, 1]. */
  readonly discardChanceOnAirExposure: number;
}

function parseOreConfig(json: Parameters<typeof asObject>[0], parser: Parameters<typeof parseRuleTest>[1], id: string): OreConfig {
  const config = asObject(json, `${id} config`);
  const size = requireInt(config, "size", id);
  if (size < 0 || size > 64) throw new Error(`${id}: size ${size} outside 0..64`);
  return {
    targets: asArray(config.targets, `${id}.targets`).map((entry, index) => {
      const targetObject = asObject(entry, `${id}.targets[${index}]`);
      return {
        target: parseRuleTest(targetObject.target, parser, `${id}.targets[${index}].target`),
        state: parseBlockStateIgnoringUnknownProperties(targetObject.state, parser, `${id}.targets[${index}].state`),
      };
    }),
    size,
    discardChanceOnAirExposure: fround(requireNumber(config, "discard_chance_on_air_exposure", id)),
  };
}

function isAdjacentToAir(level: WorldGenLevel, x: number, y: number, z: number): boolean {
  for (const direction of Direction.VALUES) {
    if (level.getBlockInfo(x + direction.stepX, y + direction.stepY, z + direction.stepZ).isAir) return true;
  }
  return false;
}

function shouldSkipAirCheck(random: RandomSource, discardChance: number): boolean {
  if (discardChance <= 0) return true;
  if (discardChance >= 1) return false;
  return random.nextFloat() >= discardChance;
}

/** OreFeature.canPlaceOre. */
function canPlaceOre(level: WorldGenLevel, random: RandomSource, config: OreConfig, target: OreTarget, x: number, y: number, z: number): boolean {
  if (!target.target.test(level, level.getBlockInfo(x, y, z), random)) return false;
  if (shouldSkipAirCheck(random, config.discardChanceOnAirExposure)) return true;
  return !isAdjacentToAir(level, x, y, z);
}

function placeOreBlobs(
  level: WorldGenLevel,
  random: RandomSource,
  config: OreConfig,
  startX: number,
  endX: number,
  startZ: number,
  endZ: number,
  startY: number,
  endY: number,
  minBlockX: number,
  minBlockY: number,
  minBlockZ: number,
  widthX: number,
  heightY: number,
): boolean {
  startFeatureStep("feature.ore.shape");
  let placedCount = 0;
  const placedBits = new Uint8Array(widthX * heightY * widthX);
  const size = config.size;
  // Per point: x, y, z, radius.
  const points = new Float64Array(size * 4);
  for (let pointIndex = 0; pointIndex < size; pointIndex++) {
    const progress = fround(pointIndex / size);
    const pointX = mthLerp(progress, startX, endX);
    const pointY = mthLerp(progress, startY, endY);
    const pointZ = mthLerp(progress, startZ, endZ);
    const radiusSeed = (random.nextDouble() * size) / 16;
    const radius = ((fround(mthSin(fround(FLOAT_PI * progress)) + 1) * radiusSeed + 1) / 2);
    points[pointIndex * 4] = pointX;
    points[pointIndex * 4 + 1] = pointY;
    points[pointIndex * 4 + 2] = pointZ;
    points[pointIndex * 4 + 3] = radius;
  }
  for (let first = 0; first < size - 1; first++) {
    if (points[first * 4 + 3]! <= 0) continue;
    for (let second = first + 1; second < size; second++) {
      if (points[second * 4 + 3]! <= 0) continue;
      const radiusDifference = points[first * 4 + 3]! - points[second * 4 + 3]!;
      const deltaX = points[first * 4]! - points[second * 4]!;
      const deltaY = points[first * 4 + 1]! - points[second * 4 + 1]!;
      const deltaZ = points[first * 4 + 2]! - points[second * 4 + 2]!;
      if (radiusDifference * radiusDifference > deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ) {
        if (radiusDifference > 0) points[second * 4 + 3] = -1;
        else points[first * 4 + 3] = -1;
      }
    }
  }
  endFeatureStep("feature.ore.shape");
  const scanMark = startFeatureStep("feature.ore.scan", level);
  let candidateCellCount = 0;
  for (let pointIndex = 0; pointIndex < size; pointIndex++) {
    const radius = points[pointIndex * 4 + 3]!;
    if (radius < 0) continue;
    const centerX = points[pointIndex * 4]!;
    const centerY = points[pointIndex * 4 + 1]!;
    const centerZ = points[pointIndex * 4 + 2]!;
    const minX = Math.max(mthFloor(centerX - radius), minBlockX);
    const minY = Math.max(mthFloor(centerY - radius), minBlockY);
    const minZ = Math.max(mthFloor(centerZ - radius), minBlockZ);
    const maxX = Math.max(mthFloor(centerX + radius), minX);
    const maxY = Math.max(mthFloor(centerY + radius), minY);
    const maxZ = Math.max(mthFloor(centerZ + radius), minZ);
    for (let blockX = minX; blockX <= maxX; blockX++) {
      const normalizedX = (blockX + 0.5 - centerX) / radius;
      if (!(normalizedX * normalizedX < 1)) continue;
      for (let blockY = minY; blockY <= maxY; blockY++) {
        const normalizedY = (blockY + 0.5 - centerY) / radius;
        if (!(normalizedX * normalizedX + normalizedY * normalizedY < 1)) continue;
        for (let blockZ = minZ; blockZ <= maxZ; blockZ++) {
          const normalizedZ = (blockZ + 0.5 - centerZ) / radius;
          if (!(normalizedX * normalizedX + normalizedY * normalizedY + normalizedZ * normalizedZ < 1) || level.isOutsideBuildHeight(blockY)) continue;
          const bitIndex = blockX - minBlockX + (blockY - minBlockY) * widthX + (blockZ - minBlockZ) * widthX * heightY;
          if (placedBits[bitIndex]) continue;
          placedBits[bitIndex] = 1;
          candidateCellCount++;
          if (!level.ensureCanWrite(blockX, blockY, blockZ)) continue;
          for (const target of config.targets) {
            if (!canPlaceOre(level, random, config, target, blockX, blockY, blockZ)) continue;
            level.setBlock(blockX, blockY, blockZ, target.state, 0);
            placedCount++;
            break;
          }
        }
      }
    }
  }
  endFeatureStep("feature.ore.scan", level, scanMark);
  addFeatureCounter("feature.ore.veins", 1);
  addFeatureCounter("feature.ore.candidateCells", candidateCellCount);
  return placedCount > 0;
}

export const oreFeature = defineFeatureType<OreConfig>({
  id: "minecraft:ore",
  parseConfig: (json, parser) => parseOreConfig(json, parser, "minecraft:ore"),
  place({ level, random, origin, config }) {
    const angle = fround(random.nextFloat() * FLOAT_PI);
    const spread = fround(config.size / 8);
    const marginRadius = mthCeil(fround(fround(fround(fround(config.size / 16) * 2) + 1) / 2));
    const startX = origin.x + Math.sin(angle) * spread;
    const endX = origin.x - Math.sin(angle) * spread;
    const startZ = origin.z + Math.cos(angle) * spread;
    const endZ = origin.z - Math.cos(angle) * spread;
    const startY = origin.y + random.nextIntBounded(3) - 2;
    const endY = origin.y + random.nextIntBounded(3) - 2;
    const minBlockX = origin.x - mthCeil(spread) - marginRadius;
    const minBlockY = origin.y - 2 - marginRadius;
    const minBlockZ = origin.z - mthCeil(spread) - marginRadius;
    const widthX = 2 * (mthCeil(spread) + marginRadius);
    const heightY = 2 * (2 + marginRadius);
    for (let blockX = minBlockX; blockX <= minBlockX + widthX; blockX++) {
      for (let blockZ = minBlockZ; blockZ <= minBlockZ + widthX; blockZ++) {
        if (minBlockY > level.getHeight("OCEAN_FLOOR_WG", blockX, blockZ)) continue;
        return placeOreBlobs(level, random, config, startX, endX, startZ, endZ, startY, endY, minBlockX, minBlockY, minBlockZ, widthX, heightY);
      }
    }
    return false;
  },
});

function randomPlacementInOneAxis(random: RandomSource, distance: number): number {
  return javaRoundFloat(fround(fround(random.nextFloat() - random.nextFloat()) * distance));
}

export const scatteredOreFeature = defineFeatureType<OreConfig>({
  id: "minecraft:scattered_ore",
  parseConfig: (json, parser) => parseOreConfig(json, parser, "minecraft:scattered_ore"),
  place({ level, random, origin, config }) {
    const attempts = random.nextIntBounded(config.size + 1);
    for (let attempt = 0; attempt < attempts; attempt++) {
      const distance = Math.min(attempt, 7);
      const offsetX = randomPlacementInOneAxis(random, distance);
      const offsetY = randomPlacementInOneAxis(random, distance);
      const offsetZ = randomPlacementInOneAxis(random, distance);
      const x = origin.x + offsetX;
      const y = origin.y + offsetY;
      const z = origin.z + offsetZ;
      for (const target of config.targets) {
        if (!canPlaceOre(level, random, config, target, x, y, z)) continue;
        level.setBlock(x, y, z, target.state, 2);
        break;
      }
    }
    return true;
  },
});
