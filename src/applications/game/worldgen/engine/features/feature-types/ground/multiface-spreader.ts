// Mirrors MultifaceBlock (state helpers for glow_lichen and sculk_vein) and MultifaceSpreader with its default and
// sculk vein spreader configurations. Positions are plain coordinates; "face" is the Direction a block attaches to.

import { isFluidWater } from "../../../block-state";
import type { RandomSource } from "../../../random";
import { Direction } from "../../core/direction";
import type { WorldGenLevel } from "../../level/world-gen-level";
import { canAttachTo, isFaceSturdy } from "./support/block-faces";
import { shuffledCopy } from "./support/random-shuffle";

export const GLOW_LICHEN = "minecraft:glow_lichen";
export const SCULK_VEIN = "minecraft:sculk_vein";

/** The multiface blocks of 1.20.6 (both support all six faces and are waterloggable). */
export type MultifaceBlockName = typeof GLOW_LICHEN | typeof SCULK_VEIN;

export interface SpreadPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly face: Direction;
}

type SpreadType = "same_position" | "same_plane" | "wrap_around";

export const DEFAULT_SPREAD_ORDER: readonly SpreadType[] = ["same_position", "same_plane", "wrap_around"];

/** MultifaceSpreader.SpreadType.getSpreadPos(pos, spreadDirection, fromFace). */
function spreadPositionOf(type: SpreadType, x: number, y: number, z: number, spreadDirection: Direction, fromFace: Direction): SpreadPosition {
  switch (type) {
    case "same_position":
      return { x, y, z, face: spreadDirection };
    case "same_plane":
      return { x: x + spreadDirection.stepX, y: y + spreadDirection.stepY, z: z + spreadDirection.stepZ, face: fromFace };
    case "wrap_around":
      return {
        x: x + spreadDirection.stepX + fromFace.stepX,
        y: y + spreadDirection.stepY + fromFace.stepY,
        z: z + spreadDirection.stepZ + fromFace.stepZ,
        face: spreadDirection.opposite,
      };
  }
}

export function hasFace(level: WorldGenLevel, state: string, face: Direction): boolean {
  return level.blockStates.propertiesOf(state)[face.name] === "true";
}

function hasAnyFace(level: WorldGenLevel, state: string): boolean {
  return Direction.VALUES.some((face) => hasFace(level, state, face));
}

export function availableFaces(level: WorldGenLevel, state: string): Direction[] {
  const name = level.blockStates.info(state).name;
  if (name !== GLOW_LICHEN && name !== SCULK_VEIN) return [];
  return Direction.VALUES.filter((face) => hasFace(level, state, face));
}

/** MultifaceBlock.isValidStateForPlacement. */
export function isValidStateForPlacement(level: WorldGenLevel, block: MultifaceBlockName, currentState: string, x: number, y: number, z: number, face: Direction): boolean {
  if (level.blockStates.info(currentState).name === block && hasFace(level, currentState, face)) return false;
  return canAttachTo(level, face, x + face.stepX, y + face.stepY, z + face.stepZ);
}

/** MultifaceBlock.getStateForPlacement(state, level, pos, direction): undefined when the face cannot be placed. */
export function multifaceStateForPlacement(level: WorldGenLevel, block: MultifaceBlockName, currentState: string, x: number, y: number, z: number, face: Direction): string | undefined {
  if (!isValidStateForPlacement(level, block, currentState, x, y, z, face)) return undefined;
  let baseState: string;
  if (level.blockStates.info(currentState).name === block) baseState = currentState;
  else if (level.blockStates.info(currentState).fluid === "water") baseState = level.blockStates.withProperty(level.blockStates.defaultState(block), "waterlogged", "true");
  else baseState = level.blockStates.defaultState(block);
  return level.blockStates.withProperty(baseState, face.name, "true");
}

/** MultifaceSpreader.SpreadConfig. */
export interface SpreaderConfig {
  readonly spreadTypes: readonly SpreadType[];
  isOtherBlockValidAsSource(level: WorldGenLevel, state: string): boolean;
  canSpreadInto(level: WorldGenLevel, x: number, y: number, z: number, target: SpreadPosition): boolean;
  stateForPlacement(level: WorldGenLevel, currentState: string, x: number, y: number, z: number, face: Direction): string | undefined;
}

function isSourceWaterBlock(level: WorldGenLevel, state: string): boolean {
  const info = level.blockStates.info(state);
  return info.name === "minecraft:water" && info.fluid === "water";
}

/** MultifaceSpreader.DefaultSpreaderConfig. */
export function defaultSpreaderConfig(block: MultifaceBlockName, spreadTypes: readonly SpreadType[] = DEFAULT_SPREAD_ORDER): SpreaderConfig {
  const stateCanBeReplaced = (level: WorldGenLevel, state: string): boolean => {
    const info = level.blockStates.info(state);
    return info.isAir || info.name === block || isSourceWaterBlock(level, state);
  };
  return {
    spreadTypes,
    isOtherBlockValidAsSource: () => false,
    canSpreadInto(level, _x, _y, _z, target) {
      const state = level.getBlockState(target.x, target.y, target.z);
      return stateCanBeReplaced(level, state) && isValidStateForPlacement(level, block, state, target.x, target.y, target.z, target.face);
    },
    stateForPlacement: (level, currentState, x, y, z, face) => multifaceStateForPlacement(level, block, currentState, x, y, z, face),
  };
}

/** SculkVeinBlock.SculkVeinSpreaderConfig. */
export function sculkVeinSpreaderConfig(spreadTypes: readonly SpreadType[]): SpreaderConfig {
  const defaults = defaultSpreaderConfig(SCULK_VEIN, spreadTypes);
  const fireNames = new Set(["minecraft:fire", "minecraft:soul_fire"]);
  return {
    ...defaults,
    isOtherBlockValidAsSource: (level, state) => level.blockStates.info(state).name !== SCULK_VEIN,
    canSpreadInto(level, originX, originY, originZ, target) {
      const state = level.getBlockState(target.x, target.y, target.z);
      const info = level.blockStates.info(state);
      const faceTargetName = level.getBlockInfo(target.x + target.face.stepX, target.y + target.face.stepY, target.z + target.face.stepZ).name;
      if (faceTargetName === "minecraft:sculk" || faceTargetName === "minecraft:sculk_catalyst" || faceTargetName === "minecraft:moving_piston") return false;
      const manhattanDistance = Math.abs(originX - target.x) + Math.abs(originY - target.y) + Math.abs(originZ - target.z);
      if (manhattanDistance === 2) {
        const supportX = originX + target.face.opposite.stepX;
        const supportY = originY + target.face.opposite.stepY;
        const supportZ = originZ + target.face.opposite.stepZ;
        if (isFaceSturdy(level, supportX, supportY, supportZ, target.face)) return false;
      }
      if (info.fluid !== "empty" && info.fluid !== "water") return false;
      if (fireNames.has(info.name)) return false;
      const canBeReplaced = info.isReplaceable || info.isAir || info.name === SCULK_VEIN || isSourceWaterBlock(level, state);
      return canBeReplaced && isValidStateForPlacement(level, SCULK_VEIN, state, target.x, target.y, target.z, target.face);
    },
  };
}

export class MultifaceSpreader {
  constructor(private readonly config: SpreaderConfig) {}

  private hasFaceOrIsValidSource(level: WorldGenLevel, state: string, face: Direction): boolean {
    return this.config.isOtherBlockValidAsSource(level, state) || hasFace(level, state, face);
  }

  /** MultifaceSpreader.getSpreadFromFaceTowardDirection with the default canSpreadInto predicate. */
  private spreadFromFaceTowardDirectionPosition(level: WorldGenLevel, state: string, x: number, y: number, z: number, fromFace: Direction, spreadDirection: Direction): SpreadPosition | undefined {
    if (spreadDirection.axis === fromFace.axis) return undefined;
    if (!(this.config.isOtherBlockValidAsSource(level, state) || (hasFace(level, state, fromFace) && !hasFace(level, state, spreadDirection)))) return undefined;
    for (const type of this.config.spreadTypes) {
      const target = spreadPositionOf(type, x, y, z, spreadDirection, fromFace);
      if (this.config.canSpreadInto(level, x, y, z, target)) return target;
    }
    return undefined;
  }

  /** MultifaceSpreader.spreadToFace. */
  private spreadToFace(level: WorldGenLevel, target: SpreadPosition): SpreadPosition | undefined {
    const current = level.getBlockState(target.x, target.y, target.z);
    const placed = this.config.stateForPlacement(level, current, target.x, target.y, target.z, target.face);
    if (placed === undefined) return undefined;
    return level.setBlock(target.x, target.y, target.z, placed, 2) ? target : undefined;
  }

  private spreadFromFaceTowardDirection(level: WorldGenLevel, state: string, x: number, y: number, z: number, fromFace: Direction, spreadDirection: Direction): SpreadPosition | undefined {
    const target = this.spreadFromFaceTowardDirectionPosition(level, state, x, y, z, fromFace, spreadDirection);
    return target === undefined ? undefined : this.spreadToFace(level, target);
  }

  /** MultifaceSpreader.spreadFromFaceTowardRandomDirection. */
  spreadFromFaceTowardRandomDirection(level: WorldGenLevel, state: string, x: number, y: number, z: number, fromFace: Direction, random: RandomSource): SpreadPosition | undefined {
    for (const direction of shuffledCopy(Direction.VALUES, random)) {
      const result = this.spreadFromFaceTowardDirection(level, state, x, y, z, fromFace, direction);
      if (result !== undefined) return result;
    }
    return undefined;
  }

  /** MultifaceSpreader.spreadAll: how many (face, direction) pairs placed a block. */
  spreadAll(level: WorldGenLevel, state: string, x: number, y: number, z: number): number {
    let placedCount = 0;
    for (const fromFace of Direction.VALUES) {
      if (!this.hasFaceOrIsValidSource(level, state, fromFace)) continue;
      for (const direction of Direction.VALUES) {
        if (this.spreadFromFaceTowardDirection(level, state, x, y, z, fromFace, direction) !== undefined) placedCount++;
      }
    }
    return placedCount;
  }
}
