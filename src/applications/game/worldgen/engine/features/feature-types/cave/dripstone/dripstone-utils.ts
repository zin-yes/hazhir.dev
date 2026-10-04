// Mirrors DripstoneUtils (the shared helpers of the dripstone features) over normalized block state strings.

import { isFluidWater } from "../../../../block-state";
import type { RandomSource } from "../../../../random";
import { Direction } from "../../../core/direction";
import type { WorldGenLevel } from "../../../level/world-gen-level";
import { FLOAT_PI, fround, mthCos, mthSin } from "../java-math";

export type DripstoneThickness = "tip_merge" | "tip" | "frustum" | "middle" | "base";

const DRIPSTONE_REPLACEABLE_TAG = "minecraft:dripstone_replaceable_blocks";
export const BASE_STONE_OVERWORLD_TAG = "minecraft:base_stone_overworld";
export const DRIPSTONE_BLOCK_STATE = "minecraft:dripstone_block";
const WATER = "minecraft:water";
const LAVA = "minecraft:lava";

/** DripstoneUtils.getDripstoneHeight(double x4), all double arithmetic. */
export function getDripstoneHeight(radiusFromCenter: number, radius: number, scale: number, bluntness: number): number {
  if (radiusFromCenter < bluntness) radiusFromCenter = bluntness;
  const ratio = (radiusFromCenter / radius) * 0.384;
  const firstTerm = 0.75 * Math.pow(ratio, 1.3333333333333333);
  const secondTerm = Math.pow(ratio, 0.6666666666666666);
  const thirdTerm = 0.3333333333333333 * Math.log(ratio);
  const scaled = Math.max(scale * (firstTerm - secondTerm - thirdTerm), 0);
  return (scaled / 0.384) * radius;
}

export function isBlockNamed(level: WorldGenLevel, x: number, y: number, z: number, blockName: string): boolean {
  return level.getBlockInfo(x, y, z).name === blockName;
}

export function isEmptyOrWaterState(level: WorldGenLevel, state: string): boolean {
  const info = level.blockStates.info(state);
  return info.isAir || info.name === WATER;
}

export function isEmptyOrWaterOrLavaState(level: WorldGenLevel, state: string): boolean {
  const info = level.blockStates.info(state);
  return info.isAir || info.name === WATER || info.name === LAVA;
}

export function isEmptyOrWater(level: WorldGenLevel, x: number, y: number, z: number): boolean {
  const info = level.getBlockInfo(x, y, z);
  return info.isAir || info.name === WATER;
}

export function isEmptyOrWaterOrLava(level: WorldGenLevel, x: number, y: number, z: number): boolean {
  const info = level.getBlockInfo(x, y, z);
  return info.isAir || info.name === WATER || info.name === LAVA;
}

export function isNeitherEmptyNorWaterState(level: WorldGenLevel, state: string): boolean {
  return !isEmptyOrWaterState(level, state);
}

/** DripstoneUtils.isDripstoneBase(BlockState). */
export function isDripstoneBaseState(level: WorldGenLevel, state: string): boolean {
  const name = level.blockStates.info(state).name;
  return name === DRIPSTONE_BLOCK_STATE || level.blockTags.is(name, DRIPSTONE_REPLACEABLE_TAG);
}

export function isDripstoneBaseOrLavaState(level: WorldGenLevel, state: string): boolean {
  return isDripstoneBaseState(level, state) || level.blockStates.info(state).name === LAVA;
}

/** DripstoneUtils.isCircleMostlyEmbeddedInStone: float stepping around a circle of the given radius. */
export function isCircleMostlyEmbeddedInStone(level: WorldGenLevel, x: number, y: number, z: number, radius: number): boolean {
  if (isEmptyOrWaterOrLava(level, x, y, z)) return false;
  const angleStep = fround(6 / fround(radius));
  const fullCircle = fround(FLOAT_PI * 2);
  for (let angle = 0; angle < fullCircle; angle = fround(angle + angleStep)) {
    const offsetX = Math.trunc(fround(mthCos(angle) * radius));
    const offsetZ = Math.trunc(fround(mthSin(angle) * radius));
    if (isEmptyOrWaterOrLava(level, x + offsetX, y, z + offsetZ)) return false;
  }
  return true;
}

/** DripstoneUtils.placeDripstoneBlockIfPossible. */
export function placeDripstoneBlockIfPossible(level: WorldGenLevel, x: number, y: number, z: number): boolean {
  if (level.blockTags.is(level.getBlockInfo(x, y, z).name, DRIPSTONE_REPLACEABLE_TAG)) {
    level.setBlock(x, y, z, DRIPSTONE_BLOCK_STATE, 2);
    return true;
  }
  return false;
}

function pointedDripstone(level: WorldGenLevel, direction: Direction, thickness: DripstoneThickness, waterlogged: boolean): string {
  const catalog = level.blockStates;
  let state = catalog.defaultState("minecraft:pointed_dripstone");
  state = catalog.withProperty(state, "vertical_direction", direction.name);
  state = catalog.withProperty(state, "thickness", thickness);
  return catalog.withProperty(state, "waterlogged", String(waterlogged));
}

/** DripstoneUtils.buildBaseToTipColumn. */
function buildBaseToTipColumn(direction: Direction, height: number, mergedTip: boolean): Array<{ direction: Direction; thickness: DripstoneThickness }> {
  const column: Array<{ direction: Direction; thickness: DripstoneThickness }> = [];
  if (height >= 3) {
    column.push({ direction, thickness: "base" });
    for (let layer = 0; layer < height - 3; layer++) column.push({ direction, thickness: "middle" });
  }
  if (height >= 2) column.push({ direction, thickness: "frustum" });
  if (height >= 1) column.push({ direction, thickness: mergedTip ? "tip_merge" : "tip" });
  return column;
}

/** DripstoneUtils.growPointedDripstone: waterlogged follows LevelReader.isWaterAt at each position. */
export function growPointedDripstone(level: WorldGenLevel, x: number, y: number, z: number, direction: Direction, height: number, mergedTip: boolean): void {
  const baseState = level.getBlockState(x - direction.stepX, y - direction.stepY, z - direction.stepZ);
  if (!isDripstoneBaseState(level, baseState)) return;
  let currentX = x;
  let currentY = y;
  let currentZ = z;
  for (const part of buildBaseToTipColumn(direction, height, mergedTip)) {
    const waterlogged = isFluidWater(level.getBlockInfo(currentX, currentY, currentZ).fluid);
    level.setBlock(currentX, currentY, currentZ, pointedDripstone(level, part.direction, part.thickness, waterlogged), 2);
    currentX += direction.stepX;
    currentY += direction.stepY;
    currentZ += direction.stepZ;
  }
}

/** Direction.getRandom. */
export function randomDirection(random: RandomSource): Direction {
  return Direction.VALUES[random.nextIntBounded(Direction.VALUES.length)]!;
}
