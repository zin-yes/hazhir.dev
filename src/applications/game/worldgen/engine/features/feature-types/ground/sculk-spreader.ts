// Mirrors SculkSpreader (created by createWorldGenSpreader), SculkSpreader.ChargeCursor and the SculkBehaviour
// implementations: the default behavior (any other block), SculkBlock and SculkVeinBlock. Only the world generation
// path is ported (isWorldGeneration is always true, so cursors never merge and always update); level events, sounds
// and entity pushing have no effect on the blocks and are left out.

import type { RandomSource } from "../../../random";
import { Direction } from "../../core/direction";
import type { WorldGenLevel } from "../../level/world-gen-level";
import { availableFaces, DEFAULT_SPREAD_ORDER, hasFace, MultifaceSpreader, SCULK_VEIN, sculkVeinSpreaderConfig } from "./multiface-spreader";
import { canAttachTo, isFaceSturdy } from "./support/block-faces";
import { directionAlongAxis } from "./support/directions";
import { shuffledCopy } from "./support/random-shuffle";

const fround = Math.fround;
const SCULK = "minecraft:sculk";
const SCULK_SENSOR = "minecraft:sculk_sensor";
const SCULK_SHRIEKER = "minecraft:sculk_shrieker";
const SHRIEKER_PLACEMENT_RATE = 11;
const MAX_GROWTH_RATE_RADIUS = 24;
const MAX_CURSORS = 32;
const MAX_CHARGE = 1000;
const MAX_CURSOR_DISTANCE = 15;

/** createWorldGenSpreader(): replaceable tag, growth spawn cost 50, no growth radius 1, decay rates 5 and 10. */
export const WORLD_GEN_SPREADER_SETTINGS = {
  replaceableTag: "minecraft:sculk_replaceable_world_gen",
  growthSpawnCost: 50,
  noGrowthRadius: 1,
  chargeDecayRate: 5,
  additionalDecayRate: 10,
} as const;

const veinSpreader = new MultifaceSpreader(sculkVeinSpreaderConfig(DEFAULT_SPREAD_ORDER));
const sameSpaceVeinSpreader = new MultifaceSpreader(sculkVeinSpreaderConfig(["same_position"]));

type Behavior = "default" | "sculk" | "sculk_vein";

function behaviorOf(level: WorldGenLevel, state: string): Behavior {
  const name = level.blockStates.info(state).name;
  if (name === SCULK) return "sculk";
  if (name === SCULK_VEIN) return "sculk_vein";
  return "default";
}

/** NON_CORNER_NEIGHBOURS: the 18 offsets in [-1, 1]^3 with a zero component, in BlockPos.betweenClosed order. */
const NON_CORNER_NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = (() => {
  const offsets: Array<[number, number, number]> = [];
  for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        if ((offsetX === 0 || offsetY === 0 || offsetZ === 0) && !(offsetX === 0 && offsetY === 0 && offsetZ === 0)) offsets.push([offsetX, offsetY, offsetZ]);
      }
    }
  }
  return offsets;
})();

interface Position {
  x: number;
  y: number;
  z: number;
}

/** SculkVeinBlock.regrow. */
function regrowVein(level: WorldGenLevel, position: Position, facings: readonly Direction[]): boolean {
  let veinState = level.blockStates.defaultState(SCULK_VEIN);
  let attachable = false;
  for (const direction of facings) {
    if (!canAttachTo(level, direction, position.x + direction.stepX, position.y + direction.stepY, position.z + direction.stepZ)) continue;
    veinState = level.blockStates.withProperty(veinState, direction.name, "true");
    attachable = true;
  }
  if (!attachable) return false;
  const existing = level.getBlockInfo(position.x, position.y, position.z);
  if (existing.fluid !== "empty") veinState = level.blockStates.withProperty(veinState, "waterlogged", "true");
  level.setBlock(position.x, position.y, position.z, veinState, 3);
  return true;
}

function hasAnyFace(level: WorldGenLevel, state: string): boolean {
  return Direction.VALUES.some((direction) => hasFace(level, state, direction));
}

/** SculkVeinBlock.onDischarged: drop faces whose neighbor became sculk; a vein without faces turns into air or water. */
function dischargeVein(level: WorldGenLevel, state: string, position: Position): void {
  if (level.blockStates.info(state).name !== SCULK_VEIN) return;
  let updated = state;
  for (const direction of Direction.VALUES) {
    if (!hasFace(level, updated, direction)) continue;
    if (level.getBlockInfo(position.x + direction.stepX, position.y + direction.stepY, position.z + direction.stepZ).name === SCULK) {
      updated = level.blockStates.withProperty(updated, direction.name, "false");
    }
  }
  if (!hasAnyFace(level, updated)) {
    const hasFluid = level.getBlockInfo(position.x, position.y, position.z).fluid !== "empty";
    updated = hasFluid ? "minecraft:water[level=0]" : "minecraft:air";
  }
  level.setBlock(position.x, position.y, position.z, updated, 3);
}

export class SculkSpreader {
  private cursors: ChargeCursor[] = [];
  cursorUpdateCount = 0;

  /** SculkSpreader.addCursors: cursors of at most 1000 charge each, 32 cursors in total. */
  addCursors(position: Position, charge: number): void {
    let remaining = charge;
    while (remaining > 0) {
      const chunk = Math.min(remaining, MAX_CHARGE);
      if (this.cursors.length < MAX_CURSORS) this.cursors.push(new ChargeCursor({ x: position.x, y: position.y, z: position.z }, chunk));
      remaining -= chunk;
    }
  }

  clear(): void {
    this.cursors = [];
  }

  /** SculkSpreader.updateCursors for a world generation spreader (no merging, every cursor with charge stays). */
  updateCursors(level: WorldGenLevel, origin: Position, random: RandomSource, spread: boolean): void {
    if (this.cursors.length === 0) return;
    this.cursorUpdateCount += this.cursors.length;
    const survivors: ChargeCursor[] = [];
    for (const cursor of this.cursors) {
      cursor.update(level, origin, random, spread);
      if (cursor.charge > 0) survivors.push(cursor);
    }
    this.cursors = survivors;
  }
}

class ChargeCursor {
  facings: Direction[] | null = null;
  private updateDelay = 0;
  private decayDelay = 1;

  constructor(
    public position: Position,
    public charge: number,
  ) {}

  update(level: WorldGenLevel, origin: Position, random: RandomSource, spread: boolean): void {
    if (this.charge <= 0) return;
    if (this.updateDelay > 0) {
      this.updateDelay--;
      return;
    }
    let state = level.getBlockState(this.position.x, this.position.y, this.position.z);
    let behavior = behaviorOf(level, state);
    if (spread && this.attemptSpreadVein(level, state, behavior)) {
      // SculkBlock does not change its own block state when spreading veins (canChangeBlockStateOnSpread).
      if (behavior !== "sculk") {
        state = level.getBlockState(this.position.x, this.position.y, this.position.z);
        behavior = behaviorOf(level, state);
      }
    }
    this.charge = this.attemptUseCharge(level, behavior, origin, random, spread);
    if (this.charge <= 0) {
      if (behavior === "sculk_vein") dischargeVein(level, state, this.position);
      return;
    }
    const movementPosition = this.validMovementPosition(level, random);
    if (movementPosition !== undefined) {
      if (behavior === "sculk_vein") dischargeVein(level, state, this.position);
      this.position = movementPosition;
      const deltaX = this.position.x - origin.x;
      const deltaZ = this.position.z - origin.z;
      if (!(deltaX * deltaX + deltaZ * deltaZ < MAX_CURSOR_DISTANCE * MAX_CURSOR_DISTANCE)) {
        this.charge = 0;
        return;
      }
      state = level.getBlockState(movementPosition.x, movementPosition.y, movementPosition.z);
    }
    if (behaviorOf(level, state) !== "default") this.facings = availableFaces(level, state);
    this.decayDelay = behavior === "default" ? Math.max(this.decayDelay - 1, 0) : 1;
    this.updateDelay = 1;
  }

  /** SculkBehaviour.attemptSpreadVein: the default behavior regrows or spreads from the same space, the others spread all faces. */
  private attemptSpreadVein(level: WorldGenLevel, state: string, behavior: Behavior): boolean {
    const { x, y, z } = this.position;
    if (behavior !== "default") return veinSpreader.spreadAll(level, state, x, y, z) > 0;
    if (this.facings === null) return sameSpaceVeinSpreader.spreadAll(level, level.getBlockState(x, y, z), x, y, z) > 0;
    if (this.facings.length > 0) {
      const info = level.blockStates.info(state);
      // FluidState.is(Fluids.WATER) holds for the source fluid only.
      if (info.isAir || info.fluid === "water") return regrowVein(level, this.position, this.facings);
      return false;
    }
    return veinSpreader.spreadAll(level, state, x, y, z) > 0;
  }

  private attemptUseCharge(level: WorldGenLevel, behavior: Behavior, origin: Position, random: RandomSource, spread: boolean): number {
    switch (behavior) {
      case "default":
        return this.decayDelay > 0 ? this.charge : 0;
      case "sculk":
        return this.sculkAttemptUseCharge(level, origin, random);
      case "sculk_vein": {
        if (spread && this.attemptPlaceSculk(level, random)) return this.charge - 1;
        return random.nextIntBounded(WORLD_GEN_SPREADER_SETTINGS.chargeDecayRate) === 0 ? Math.floor(fround(this.charge * 0.5)) : this.charge;
      }
    }
  }

  /** SculkBlock.attemptUseCharge. */
  private sculkAttemptUseCharge(level: WorldGenLevel, origin: Position, random: RandomSource): number {
    const charge = this.charge;
    const settings = WORLD_GEN_SPREADER_SETTINGS;
    if (charge === 0 || random.nextIntBounded(settings.chargeDecayRate) !== 0) return charge;
    const { x, y, z } = this.position;
    const squaredDistance = (x - origin.x) * (x - origin.x) + (y - origin.y) * (y - origin.y) + (z - origin.z) * (z - origin.z);
    const insideNoGrowthRadius = squaredDistance < settings.noGrowthRadius * settings.noGrowthRadius;
    if (insideNoGrowthRadius || !canPlaceGrowth(level, x, y, z)) {
      if (random.nextIntBounded(settings.additionalDecayRate) !== 0) return charge;
      return charge - (insideNoGrowthRadius ? 1 : decayPenalty(squaredDistance, charge));
    }
    if (random.nextIntBounded(settings.growthSpawnCost) < charge) {
      const growthState = randomGrowthState(level, x, y + 1, z, random);
      level.setBlock(x, y + 1, z, growthState, 3);
    }
    return Math.max(0, charge - settings.growthSpawnCost);
  }

  /** SculkVeinBlock.attemptPlaceSculk. */
  private attemptPlaceSculk(level: WorldGenLevel, random: RandomSource): boolean {
    const { x, y, z } = this.position;
    const state = level.getBlockState(x, y, z);
    for (const direction of shuffledCopy(Direction.VALUES, random)) {
      if (!hasFace(level, state, direction)) continue;
      const targetX = x + direction.stepX;
      const targetY = y + direction.stepY;
      const targetZ = z + direction.stepZ;
      if (!level.blockTags.is(level.getBlockInfo(targetX, targetY, targetZ).name, WORLD_GEN_SPREADER_SETTINGS.replaceableTag)) continue;
      const sculkState = level.blockStates.defaultState(SCULK);
      level.setBlock(targetX, targetY, targetZ, sculkState, 3);
      veinSpreader.spreadAll(level, sculkState, targetX, targetY, targetZ);
      const oppositeDirection = direction.opposite;
      for (const neighborDirection of Direction.VALUES) {
        if (neighborDirection === oppositeDirection) continue;
        const neighborX = targetX + neighborDirection.stepX;
        const neighborY = targetY + neighborDirection.stepY;
        const neighborZ = targetZ + neighborDirection.stepZ;
        const neighborState = level.getBlockState(neighborX, neighborY, neighborZ);
        if (level.blockStates.info(neighborState).name === SCULK_VEIN) dischargeVein(level, neighborState, { x: neighborX, y: neighborY, z: neighborZ });
      }
      return true;
    }
    return false;
  }

  /** ChargeCursor.getValidMovementPos: the last candidate that is a sculk block, unobstructed; the first with substrate access wins. */
  private validMovementPosition(level: WorldGenLevel, random: RandomSource): Position | undefined {
    const { x, y, z } = this.position;
    let chosen: Position = { x, y, z };
    for (const [offsetX, offsetY, offsetZ] of shuffledCopy(NON_CORNER_NEIGHBOURS, random)) {
      const candidate = { x: x + offsetX, y: y + offsetY, z: z + offsetZ };
      const candidateState = level.getBlockState(candidate.x, candidate.y, candidate.z);
      if (behaviorOf(level, candidateState) === "default" || !isMovementUnobstructed(level, this.position, candidate)) continue;
      chosen = candidate;
      if (hasSubstrateAccess(level, candidateState, candidate)) break;
    }
    return chosen.x === x && chosen.y === y && chosen.z === z ? undefined : chosen;
  }
}

function isUnobstructed(level: WorldGenLevel, position: Position, direction: Direction): boolean {
  const x = position.x + direction.stepX;
  const y = position.y + direction.stepY;
  const z = position.z + direction.stepZ;
  return !isFaceSturdy(level, x, y, z, direction.opposite);
}

/** ChargeCursor.isMovementUnobstructed. */
function isMovementUnobstructed(level: WorldGenLevel, from: Position, to: Position): boolean {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const deltaZ = to.z - from.z;
  if (Math.abs(deltaX) + Math.abs(deltaY) + Math.abs(deltaZ) === 1) return true;
  const directionX = directionAlongAxis("x", deltaX < 0);
  const directionY = directionAlongAxis("y", deltaY < 0);
  const directionZ = directionAlongAxis("z", deltaZ < 0);
  if (deltaX === 0) return isUnobstructed(level, from, directionY) || isUnobstructed(level, from, directionZ);
  if (deltaY === 0) return isUnobstructed(level, from, directionX) || isUnobstructed(level, from, directionZ);
  return isUnobstructed(level, from, directionX) || isUnobstructed(level, from, directionY);
}

/** SculkVeinBlock.hasSubstrateAccess: a vein with a face toward a sculk_replaceable block. */
function hasSubstrateAccess(level: WorldGenLevel, state: string, position: Position): boolean {
  if (level.blockStates.info(state).name !== SCULK_VEIN) return false;
  return Direction.VALUES.some(
    (direction) =>
      hasFace(level, state, direction) &&
      level.blockTags.is(level.getBlockInfo(position.x + direction.stepX, position.y + direction.stepY, position.z + direction.stepZ).name, "minecraft:sculk_replaceable"),
  );
}

/** SculkBlock.getDecayPenalty (float arithmetic). */
function decayPenalty(squaredDistance: number, charge: number): number {
  const noGrowthRadius = WORLD_GEN_SPREADER_SETTINGS.noGrowthRadius;
  const excess = fround(fround(Math.sqrt(squaredDistance)) - noGrowthRadius);
  const squaredExcess = fround(excess * excess);
  const squaredRange = (MAX_GROWTH_RATE_RADIUS - noGrowthRadius) * (MAX_GROWTH_RATE_RADIUS - noGrowthRadius);
  const factor = Math.min(1, fround(squaredExcess / squaredRange));
  return Math.max(1, Math.trunc(fround(fround(charge * factor) * 0.5)));
}

/** SculkBlock.canPlaceGrowth. */
function canPlaceGrowth(level: WorldGenLevel, x: number, y: number, z: number): boolean {
  const above = level.getBlockInfo(x, y + 1, z);
  if (!(above.isAir || (above.name === "minecraft:water" && above.fluid === "water"))) return false;
  let sensorCount = 0;
  for (let offsetZ = -4; offsetZ <= 4; offsetZ++) {
    for (let offsetY = 0; offsetY <= 2; offsetY++) {
      for (let offsetX = -4; offsetX <= 4; offsetX++) {
        const name = level.getBlockInfo(x + offsetX, y + offsetY, z + offsetZ).name;
        if (name === SCULK_SENSOR || name === SCULK_SHRIEKER) sensorCount++;
        if (sensorCount > 2) return false;
      }
    }
  }
  return true;
}

/** SculkBlock.getRandomGrowthState with isWorldGeneration = true. */
function randomGrowthState(level: WorldGenLevel, x: number, y: number, z: number, random: RandomSource): string {
  let state: string;
  if (random.nextIntBounded(SHRIEKER_PLACEMENT_RATE) === 0) state = level.blockStates.withProperty(level.blockStates.defaultState(SCULK_SHRIEKER), "can_summon", "true");
  else state = level.blockStates.defaultState(SCULK_SENSOR);
  if (level.blockStates.hasProperty(state, "waterlogged") && level.getBlockInfo(x, y, z).fluid !== "empty") state = level.blockStates.withProperty(state, "waterlogged", "true");
  return state;
}
