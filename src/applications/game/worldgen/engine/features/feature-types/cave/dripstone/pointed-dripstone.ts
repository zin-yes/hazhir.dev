// Mirrors PointedDripstoneFeature (minecraft:pointed_dripstone) with PointedDripstoneConfiguration.

import { Direction } from "../../../core/direction";
import { defineFeatureType } from "../../../feature/feature-type";
import type { WorldGenLevel } from "../../../level/world-gen-level";
import type { RandomSource } from "../../../../random";
import { asObject, optionalNumber } from "../../../providers/json-fields";
import { fround } from "../java-math";
import { growPointedDripstone, isDripstoneBaseState, isEmptyOrWaterState, placeDripstoneBlockIfPossible, randomDirection } from "./dripstone-utils";

export interface PointedDripstoneConfig {
  readonly chanceOfTallerDripstone: number;
  readonly chanceOfDirectionalSpread: number;
  readonly chanceOfSpreadRadius2: number;
  readonly chanceOfSpreadRadius3: number;
}

function getTipDirection(level: WorldGenLevel, x: number, y: number, z: number, random: RandomSource): Direction | undefined {
  const baseAbove = isDripstoneBaseState(level, level.getBlockState(x, y + 1, z));
  const baseBelow = isDripstoneBaseState(level, level.getBlockState(x, y - 1, z));
  if (baseAbove && baseBelow) return random.nextBoolean() ? Direction.DOWN : Direction.UP;
  if (baseAbove) return Direction.DOWN;
  if (baseBelow) return Direction.UP;
  return undefined;
}

function createPatchOfDripstoneBlocks(level: WorldGenLevel, random: RandomSource, x: number, y: number, z: number, config: PointedDripstoneConfig): void {
  placeDripstoneBlockIfPossible(level, x, y, z);
  for (const direction of Direction.HORIZONTAL) {
    if (random.nextFloat() > config.chanceOfDirectionalSpread) continue;
    const firstX = x + direction.stepX;
    const firstY = y + direction.stepY;
    const firstZ = z + direction.stepZ;
    placeDripstoneBlockIfPossible(level, firstX, firstY, firstZ);
    if (random.nextFloat() > config.chanceOfSpreadRadius2) continue;
    const secondDirection = randomDirection(random);
    const secondX = firstX + secondDirection.stepX;
    const secondY = firstY + secondDirection.stepY;
    const secondZ = firstZ + secondDirection.stepZ;
    placeDripstoneBlockIfPossible(level, secondX, secondY, secondZ);
    if (random.nextFloat() > config.chanceOfSpreadRadius3) continue;
    const thirdDirection = randomDirection(random);
    placeDripstoneBlockIfPossible(level, secondX + thirdDirection.stepX, secondY + thirdDirection.stepY, secondZ + thirdDirection.stepZ);
  }
}

export const pointedDripstoneFeature = defineFeatureType<PointedDripstoneConfig>({
  id: "minecraft:pointed_dripstone",
  parseConfig(json) {
    const config = asObject(json ?? {}, "pointed_dripstone config");
    return {
      chanceOfTallerDripstone: fround(optionalNumber(config, "chance_of_taller_dripstone", 0.2)),
      chanceOfDirectionalSpread: fround(optionalNumber(config, "chance_of_directional_spread", 0.7)),
      chanceOfSpreadRadius2: fround(optionalNumber(config, "chance_of_spread_radius2", 0.5)),
      chanceOfSpreadRadius3: fround(optionalNumber(config, "chance_of_spread_radius3", 0.5)),
    };
  },
  place({ level, random, origin, config }) {
    const tipDirection = getTipDirection(level, origin.x, origin.y, origin.z, random);
    if (tipDirection === undefined) return false;
    const opposite = tipDirection.opposite;
    createPatchOfDripstoneBlocks(level, random, origin.x + opposite.stepX, origin.y + opposite.stepY, origin.z + opposite.stepZ, config);
    const tipState = level.getBlockState(origin.x + tipDirection.stepX, origin.y + tipDirection.stepY, origin.z + tipDirection.stepZ);
    const height = random.nextFloat() < config.chanceOfTallerDripstone && isEmptyOrWaterState(level, tipState) ? 2 : 1;
    growPointedDripstone(level, origin.x, origin.y, origin.z, tipDirection, height, false);
    return true;
  },
});
