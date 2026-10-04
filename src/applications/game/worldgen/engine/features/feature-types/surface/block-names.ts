// Block identity helpers shared by the surface features (BlockState.is(Block) / is(TagKey) on state strings).

import { blockNameOf } from "../../../chunk";
import type { WorldGenLevel } from "../../level/world-gen-level";

export const AIR_STATE = "minecraft:air";
export const WATER_BLOCK = "minecraft:water";
export const ICE_BLOCK = "minecraft:ice";
export const PACKED_ICE_BLOCK = "minecraft:packed_ice";
export const BLUE_ICE_BLOCK = "minecraft:blue_ice";
export const SNOW_BLOCK = "minecraft:snow_block";
export const SNOW_LAYER_BLOCK = "minecraft:snow";

export function isBlock(state: string, blockName: string): boolean {
  return blockNameOf(state) === blockName;
}

/** Feature.isDirt: BlockTags.DIRT. */
export function isDirt(level: WorldGenLevel, state: string): boolean {
  return level.blockTags.is(blockNameOf(state), "minecraft:dirt");
}

/** Feature.isStone: BlockTags.BASE_STONE_OVERWORLD. */
export function isStone(level: WorldGenLevel, state: string): boolean {
  return level.blockTags.is(blockNameOf(state), "minecraft:base_stone_overworld");
}
