// Mirrors MultifaceGrowthFeature (minecraft:multiface_growth) and MultifaceGrowthConfiguration: glow lichen / sculk
// vein placed on the first attachable face found around the origin or along a random direction.

import type { RandomSource } from "../../../random";
import { Direction } from "../../core/direction";
import { defineFeatureType } from "../../feature/feature-type";
import type { WorldGenLevel } from "../../level/world-gen-level";
import type { BlockSet } from "../../providers/block-predicates";
import { asObject, optionalBoolean, optionalNumber, type JsonValue } from "../../providers/json-fields";
import {
  defaultSpreaderConfig,
  GLOW_LICHEN,
  type MultifaceBlockName,
  MultifaceSpreader,
  multifaceStateForPlacement,
  SCULK_VEIN,
  sculkVeinSpreaderConfig,
  DEFAULT_SPREAD_ORDER,
} from "./multiface-spreader";
import { shuffledCopy } from "./support/random-shuffle";

const fround = Math.fround;

export interface MultifaceGrowthConfig {
  readonly placeBlock: MultifaceBlockName;
  readonly searchRange: number;
  readonly chanceOfSpreading: number;
  readonly canBePlacedOn: BlockSet;
  /** validDirections: UP (ceiling), DOWN (floor), then the horizontal directions (wall). */
  readonly validDirections: readonly Direction[];
}

const spreaderByBlock: Record<MultifaceBlockName, MultifaceSpreader> = {
  [GLOW_LICHEN]: new MultifaceSpreader(defaultSpreaderConfig(GLOW_LICHEN)),
  [SCULK_VEIN]: new MultifaceSpreader(sculkVeinSpreaderConfig(DEFAULT_SPREAD_ORDER)),
};

/** The spreader of a multiface block (MultifaceBlock.getSpreader). */
export function spreaderOf(block: MultifaceBlockName): MultifaceSpreader {
  return spreaderByBlock[block];
}

function parseMultifaceBlock(json: JsonValue | undefined): MultifaceBlockName {
  if (json === undefined) return GLOW_LICHEN;
  const name = typeof json === "string" && !json.includes(":") ? `minecraft:${json}` : json;
  if (name === GLOW_LICHEN || name === SCULK_VEIN) return name;
  throw new Error(`multiface_growth: "${String(json)}" is not a multiface block (Growth block should be a multiface block)`);
}

function isAirOrWater(level: WorldGenLevel, x: number, y: number, z: number): boolean {
  const info = level.getBlockInfo(x, y, z);
  return info.isAir || info.name === "minecraft:water";
}

function shuffledDirectionsExcept(config: MultifaceGrowthConfig, random: RandomSource, excluded: Direction): Direction[] {
  return shuffledCopy(
    config.validDirections.filter((direction) => direction !== excluded),
    random,
  );
}

/** MultifaceGrowthFeature.placeGrowthIfPossible. */
export function placeGrowthIfPossible(level: WorldGenLevel, x: number, y: number, z: number, state: string, config: MultifaceGrowthConfig, random: RandomSource, directions: readonly Direction[]): boolean {
  for (const direction of directions) {
    const neighborName = level.getBlockInfo(x + direction.stepX, y + direction.stepY, z + direction.stepZ).name;
    if (!config.canBePlacedOn.contains(level, neighborName)) continue;
    const placedState = multifaceStateForPlacement(level, config.placeBlock, state, x, y, z, direction);
    if (placedState === undefined) return false;
    level.setBlock(x, y, z, placedState, 3);
    if (random.nextFloat() < config.chanceOfSpreading) {
      spreaderOf(config.placeBlock).spreadFromFaceTowardRandomDirection(level, placedState, x, y, z, direction, random);
    }
    return true;
  }
  return false;
}

export const multifaceGrowthFeature = defineFeatureType<MultifaceGrowthConfig>({
  id: "minecraft:multiface_growth",
  parseConfig(json, parser) {
    const config = asObject(json, "multiface_growth config");
    const validDirections: Direction[] = [];
    if (optionalBoolean(config, "can_place_on_ceiling", false)) validDirections.push(Direction.UP);
    if (optionalBoolean(config, "can_place_on_floor", false)) validDirections.push(Direction.DOWN);
    if (optionalBoolean(config, "can_place_on_wall", false)) validDirections.push(...Direction.HORIZONTAL);
    return {
      placeBlock: parseMultifaceBlock(config.block),
      searchRange: optionalNumber(config, "search_range", 10),
      chanceOfSpreading: fround(optionalNumber(config, "chance_of_spreading", 0.5)),
      canBePlacedOn: parser.blockSet(config.can_be_placed_on, "multiface_growth.can_be_placed_on"),
      validDirections,
    };
  },
  place({ config, level, random, origin }) {
    const { x, y, z } = origin;
    if (!isAirOrWater(level, x, y, z)) return false;
    const directions = shuffledCopy(config.validDirections, random);
    if (placeGrowthIfPossible(level, x, y, z, level.getBlockState(x, y, z), config, random, directions)) return true;
    for (const direction of directions) {
      const remainingDirections = shuffledDirectionsExcept(config, random, direction.opposite);
      for (let step = 0; step < config.searchRange; step++) {
        // The search position is recomputed from the origin each step (Java: setWithOffset(origin, direction)),
        // so every iteration inspects the same neighbor of the origin.
        const searchX = x + direction.stepX;
        const searchY = y + direction.stepY;
        const searchZ = z + direction.stepZ;
        const searchState = level.getBlockState(searchX, searchY, searchZ);
        const searchInfo = level.blockStates.info(searchState);
        if (!isAirOrWater(level, searchX, searchY, searchZ) && searchInfo.name !== config.placeBlock) break;
        if (placeGrowthIfPossible(level, searchX, searchY, searchZ, searchState, config, random, remainingDirections)) return true;
      }
    }
    return false;
  },
});
