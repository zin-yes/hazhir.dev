// Mirrors LargeDripstoneFeature (minecraft:large_dripstone) with LargeDripstoneConfiguration: a stalactite and a
// stalagmite column pair with optional wind skew, found between a floor and a ceiling by Column.scan.

import type { RandomSource } from "../../../../random";
import { Direction } from "../../../core/direction";
import { defineFeatureType } from "../../../feature/feature-type";
import type { WorldGenLevel } from "../../../level/world-gen-level";
import { asObject, requireNumber } from "../../../providers/json-fields";
import { endFeatureStep, startFeatureStep } from "../../../profiling/feature-profiling";
import { type FloatProvider, type IntProvider, randomBetweenInclusive } from "../../../providers/value-providers";
import { Column } from "../column";
import { optionalInt, requireInt } from "../config-fields";
import { clampInt, FLOAT_PI, fround, mthCos, mthFloor, mthSin, mthSqrtFloat } from "../java-math";
import {
  BASE_STONE_OVERWORLD_TAG,
  getDripstoneHeight,
  isBlockNamed,
  isCircleMostlyEmbeddedInStone,
  isDripstoneBaseOrLavaState,
  isEmptyOrWater,
  isEmptyOrWaterOrLava,
  isEmptyOrWaterState,
} from "./dripstone-utils";

export interface LargeDripstoneConfig {
  readonly floorToCeilingSearchRange: number;
  readonly columnRadius: IntProvider;
  readonly heightScale: FloatProvider;
  readonly maxColumnRadiusToCaveHeightRatio: number;
  readonly stalactiteBluntness: FloatProvider;
  readonly stalagmiteBluntness: FloatProvider;
  readonly windSpeed: FloatProvider;
  readonly minRadiusForWind: number;
  readonly minBluntnessForWind: number;
}

interface Position {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** LargeDripstoneFeature.WindOffsetter. */
class WindOffsetter {
  private constructor(
    private readonly originY: number,
    private readonly windX: number,
    private readonly windZ: number,
    private readonly hasWind: boolean,
  ) {}

  static withWind(originY: number, random: RandomSource, windSpeed: FloatProvider): WindOffsetter {
    const speed = windSpeed.sample(random);
    const angle = fround(fround(random.nextFloat() * fround(FLOAT_PI - 0)) + 0);
    return new WindOffsetter(originY, fround(mthCos(angle) * speed), fround(mthSin(angle) * speed), true);
  }

  static noWind(): WindOffsetter {
    return new WindOffsetter(0, 0, 0, false);
  }

  offset(x: number, y: number, z: number): Position {
    if (!this.hasWind) return { x, y, z };
    const heightDifference = this.originY - y;
    return { x: (x + mthFloor(this.windX * heightDifference)) | 0, y, z: (z + mthFloor(this.windZ * heightDifference)) | 0 };
  }
}

/** LargeDripstoneFeature.LargeDripstone. */
class LargeDripstone {
  constructor(
    private root: Position,
    private readonly pointingUp: boolean,
    private radius: number,
    private readonly bluntness: number,
    private readonly scale: number,
  ) {}

  private getHeightAtRadius(radiusFromCenter: number): number {
    return Math.trunc(getDripstoneHeight(radiusFromCenter, this.radius, this.scale, this.bluntness));
  }

  private getHeight(): number {
    return this.getHeightAtRadius(0);
  }

  moveBackUntilBaseIsInsideStoneAndShrinkRadiusIfNecessary(level: WorldGenLevel, wind: WindOffsetter): boolean {
    while (this.radius > 1) {
      let y = this.root.y;
      const steps = Math.min(10, this.getHeight());
      for (let step = 0; step < steps; step++) {
        if (isBlockNamed(level, this.root.x, y, this.root.z, "minecraft:lava")) return false;
        const shifted = wind.offset(this.root.x, y, this.root.z);
        if (isCircleMostlyEmbeddedInStone(level, shifted.x, shifted.y, shifted.z, this.radius)) {
          this.root = { x: this.root.x, y, z: this.root.z };
          return true;
        }
        y += this.pointingUp ? -1 : 1;
      }
      this.radius = Math.trunc(this.radius / 2);
    }
    return false;
  }

  placeBlocks(level: WorldGenLevel, random: RandomSource, wind: WindOffsetter): void {
    for (let offsetX = -this.radius; offsetX <= this.radius; offsetX++) {
      columnLoop: for (let offsetZ = -this.radius; offsetZ <= this.radius; offsetZ++) {
        const distance = mthSqrtFloat(offsetX * offsetX + offsetZ * offsetZ);
        if (distance > this.radius) continue;
        let height = this.getHeightAtRadius(distance);
        if (height <= 0) continue;
        if (random.nextFloat() < 0.2) {
          const factor = fround(fround(random.nextFloat() * fround(1 - fround(0.8))) + fround(0.8));
          height = Math.trunc(fround(height * factor));
        }
        const columnX = this.root.x + offsetX;
        const columnZ = this.root.z + offsetZ;
        let y = this.root.y;
        let placedAny = false;
        const surfaceHeight = this.pointingUp ? level.getHeight("WORLD_SURFACE_WG", columnX, columnZ) : Number.MAX_SAFE_INTEGER;
        for (let step = 0; step < height && y < surfaceHeight; step++) {
          const shifted = wind.offset(columnX, y, columnZ);
          if (isEmptyOrWaterOrLava(level, shifted.x, shifted.y, shifted.z)) {
            placedAny = true;
            level.setBlock(shifted.x, shifted.y, shifted.z, "minecraft:dripstone_block", 2);
          } else if (placedAny && level.blockTags.is(level.getBlockInfo(shifted.x, shifted.y, shifted.z).name, BASE_STONE_OVERWORLD_TAG)) {
            continue columnLoop;
          }
          y += this.pointingUp ? 1 : -1;
        }
      }
    }
  }

  isSuitableForWind(config: LargeDripstoneConfig): boolean {
    return this.radius >= config.minRadiusForWind && this.bluntness >= config.minBluntnessForWind;
  }
}

function makeDripstone(root: Position, pointingUp: boolean, random: RandomSource, radius: number, bluntness: FloatProvider, heightScale: FloatProvider): LargeDripstone {
  const sampledBluntness = bluntness.sample(random);
  const sampledScale = heightScale.sample(random);
  return new LargeDripstone(root, pointingUp, radius, sampledBluntness, sampledScale);
}

export const largeDripstoneFeature = defineFeatureType<LargeDripstoneConfig>({
  id: "minecraft:large_dripstone",
  parseConfig(json, parser) {
    const config = asObject(json, "large_dripstone config");
    return {
      floorToCeilingSearchRange: optionalInt(config, "floor_to_ceiling_search_range", 30),
      columnRadius: parser.intProvider(config.column_radius, "large_dripstone.column_radius"),
      heightScale: parser.floatProvider(config.height_scale, "large_dripstone.height_scale"),
      maxColumnRadiusToCaveHeightRatio: fround(requireNumber(config, "max_column_radius_to_cave_height_ratio", "large_dripstone")),
      stalactiteBluntness: parser.floatProvider(config.stalactite_bluntness, "large_dripstone.stalactite_bluntness"),
      stalagmiteBluntness: parser.floatProvider(config.stalagmite_bluntness, "large_dripstone.stalagmite_bluntness"),
      windSpeed: parser.floatProvider(config.wind_speed, "large_dripstone.wind_speed"),
      minRadiusForWind: requireInt(config, "min_radius_for_wind", "large_dripstone"),
      minBluntnessForWind: fround(requireNumber(config, "min_bluntness_for_wind", "large_dripstone")),
    };
  },
  place({ level, random, origin, config }) {
    if (!isEmptyOrWater(level, origin.x, origin.y, origin.z)) return false;
    startFeatureStep("feature.large_dripstone.search");
    const column = Column.scan(
      (x, y, z) => level.getBlockState(x, y, z),
      origin,
      config.floorToCeilingSearchRange,
      (state) => isEmptyOrWaterState(level, state),
      (state) => isDripstoneBaseOrLavaState(level, state),
    );
    endFeatureStep("feature.large_dripstone.search");
    if (column === undefined || !column.isRange()) return false;
    const floor = column.floor!;
    const ceiling = column.ceiling!;
    const caveHeight = column.height!;
    if (caveHeight < 4) return false;
    const maxRadius = Math.trunc(fround(caveHeight * config.maxColumnRadiusToCaveHeightRatio));
    const clampedRadius = clampInt(maxRadius, config.columnRadius.minValue, config.columnRadius.maxValue);
    const radius = randomBetweenInclusive(random, config.columnRadius.minValue, clampedRadius);
    const stalactite = makeDripstone({ x: origin.x, y: ceiling - 1, z: origin.z }, false, random, radius, config.stalactiteBluntness, config.heightScale);
    const stalagmite = makeDripstone({ x: origin.x, y: floor + 1, z: origin.z }, true, random, radius, config.stalagmiteBluntness, config.heightScale);
    const wind =
      stalactite.isSuitableForWind(config) && stalagmite.isSuitableForWind(config) ? WindOffsetter.withWind(origin.y, random, config.windSpeed) : WindOffsetter.noWind();
    startFeatureStep("feature.large_dripstone.fit");
    const stalactiteFits = stalactite.moveBackUntilBaseIsInsideStoneAndShrinkRadiusIfNecessary(level, wind);
    const stalagmiteFits = stalagmite.moveBackUntilBaseIsInsideStoneAndShrinkRadiusIfNecessary(level, wind);
    endFeatureStep("feature.large_dripstone.fit");
    const blocksMark = startFeatureStep("feature.large_dripstone.blocks", level);
    if (stalactiteFits) stalactite.placeBlocks(level, random, wind);
    if (stalagmiteFits) stalagmite.placeBlocks(level, random, wind);
    endFeatureStep("feature.large_dripstone.blocks", level, blocksMark);
    return true;
  },
});
