// Maps Minecraft block state strings ("minecraft:oak_log[axis=y]") to the game's one-byte BlockType.
// Block properties are mostly dropped; only the ones that change which game block is chosen are read:
// water/lava level, snow layers, slab type, stair facing, waterlogged, snowy grass, dripstone direction.
// Unknown block names throw, so a new block in a datapack can never silently become stone.

import { BlockType, isCrop, isCrossBlock, isFlatQuad } from "../../../blocks";
import { parseBlockState } from "../chunk/block-palette";
import { resolveFamilyBlock, isDroppedFamilyBlock, type BlockStateProperties } from "./material-families";
import { ALWAYS_WATER_BLOCKS, PLANT_BLOCKS, WATERLOGGED_BY_DEFAULT_BLOCKS } from "./plant-block-names";
import {
  EMPTY_SPACE_BLOCKS,
  INTENTIONALLY_DROPPED_EXACT_BLOCKS,
  STRUCTURE_SOLID_BLOCKS,
} from "./structure-block-names";
import { TERRAIN_BLOCKS } from "./terrain-block-names";

const MINECRAFT_NAMESPACE_PREFIX = "minecraft:";
const FALLING_WATER_MINIMUM_LEVEL = 8;
const WATER_SOURCE_GAME_LEVEL = 8;
const SNOW_LAYERS_AS_SLAB_MAXIMUM = 4;

const EXACT_BLOCKS = buildExactBlockTable([TERRAIN_BLOCKS, PLANT_BLOCKS, STRUCTURE_SOLID_BLOCKS]);
const blockStateCache = new Map<string, BlockType>();

function buildExactBlockTable(tables: Record<string, BlockType>[]): Map<string, BlockType> {
  const combined = new Map<string, BlockType>();
  for (const table of tables) {
    for (const [blockPath, gameBlock] of Object.entries(table)) {
      if (combined.has(blockPath)) throw new Error(`Block "${blockPath}" is mapped in more than one table`);
      combined.set(blockPath, gameBlock);
    }
  }
  return combined;
}

/** True when the name is deliberately mapped to air because the game has no matching block. */
export function isIntentionallyDroppedBlock(blockName: string): boolean {
  const blockPath = blockName.startsWith(MINECRAFT_NAMESPACE_PREFIX)
    ? blockName.slice(MINECRAFT_NAMESPACE_PREFIX.length)
    : blockName;
  return INTENTIONALLY_DROPPED_EXACT_BLOCKS.has(blockPath) || isDroppedFamilyBlock(blockPath);
}

function mapWaterLevel(properties: BlockStateProperties): BlockType {
  const minecraftLevel = Number(properties.level ?? "0");
  if (minecraftLevel === 0) return BlockType.WATER;
  if (minecraftLevel >= FALLING_WATER_MINIMUM_LEVEL) return BlockType.WATER_FALLING;
  // Minecraft level 1 is the thickest flowing water (next to the source); the game counts the other way.
  return BlockType.WATER_LEVEL_1 + (WATER_SOURCE_GAME_LEVEL - minecraftLevel) - 1;
}

function mapSnowLayers(properties: BlockStateProperties): BlockType {
  const layers = Number(properties.layers ?? "1");
  if (layers <= 1) return BlockType.SNOW_LAYER;
  return layers <= SNOW_LAYERS_AS_SLAB_MAXIMUM ? BlockType.SNOW_SLAB : BlockType.SNOW_BLOCK;
}

/** Blocks whose game block depends on a property; undefined for every other name. */
function resolveStatefulBlock(blockPath: string, properties: BlockStateProperties): BlockType | undefined {
  switch (blockPath) {
    case "water":
      return mapWaterLevel(properties);
    case "lava":
      return BlockType.LAVA;
    case "snow":
      return mapSnowLayers(properties);
    case "grass_block":
      return properties.snowy === "true" ? BlockType.GRASS_SNOWY : BlockType.GRASS;
    case "pointed_dripstone":
      return properties.vertical_direction === "up"
        ? BlockType.POINTED_DRIPSTONE_UP
        : BlockType.POINTED_DRIPSTONE_DOWN;
    default:
      return undefined;
  }
}

function resolveBlockPath(blockPath: string, properties: BlockStateProperties): BlockType | undefined {
  if (EMPTY_SPACE_BLOCKS.includes(blockPath)) return BlockType.AIR;
  if (ALWAYS_WATER_BLOCKS.includes(blockPath)) return BlockType.WATER;
  if (WATERLOGGED_BY_DEFAULT_BLOCKS.includes(blockPath)) {
    return properties.waterlogged === "false" ? BlockType.AIR : BlockType.WATER;
  }

  const statefulBlock = resolveStatefulBlock(blockPath, properties);
  if (statefulBlock !== undefined) return statefulBlock;

  const exactBlock = EXACT_BLOCKS.get(blockPath);
  if (exactBlock !== undefined) return exactBlock;

  if (INTENTIONALLY_DROPPED_EXACT_BLOCKS.has(blockPath)) return BlockType.AIR;

  const familyBlock = resolveFamilyBlock(blockPath, properties);
  if (familyBlock === "water-plant") return properties.waterlogged === "false" ? BlockType.AIR : BlockType.WATER;
  return familyBlock;
}

function isSeeThroughShape(gameBlock: BlockType): boolean {
  return gameBlock === BlockType.AIR || isCrossBlock(gameBlock) || isFlatQuad(gameBlock) || isCrop(gameBlock);
}

function mapBlockState(blockState: string): BlockType {
  const { name, properties } = parseBlockState(blockState);
  if (!name.startsWith(MINECRAFT_NAMESPACE_PREFIX)) {
    throw new Error(`No game block mapping for "${blockState}": only minecraft: blocks are supported`);
  }
  const resolvedBlock = resolveBlockPath(name.slice(MINECRAFT_NAMESPACE_PREFIX.length), properties);
  if (resolvedBlock === undefined) {
    throw new Error(`No game block mapping for "${blockState}": add it to the block tables or the dropped list`);
  }
  // A waterlogged torch, vine or trapdoor leaves its cell full of water.
  if (properties.waterlogged === "true" && isSeeThroughShape(resolvedBlock)) return BlockType.WATER;
  return resolvedBlock;
}

export function toGameBlock(blockState: string): BlockType {
  const cachedBlock = blockStateCache.get(blockState);
  if (cachedBlock !== undefined) return cachedBlock;
  const gameBlock = mapBlockState(blockState);
  blockStateCache.set(blockState, gameBlock);
  return gameBlock;
}
