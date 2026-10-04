// Shared LOD dimensions. A tile is TILE_CELLS x TILE_CELLS cells; a cell at level L is 2^L blocks wide, so a level-0
// tile is exactly one 32 x 32 chunk column and a level-L tile covers 2^L x 2^L chunk columns.

import { CHUNK_WIDTH } from "../../config";
import { GAME_Y_OFFSET, SEA_LEVEL } from "../../worldgen/constants";

export const TILE_CELLS = 32;
export const TILE_CELL_COUNT = TILE_CELLS * TILE_CELLS;
export const CHUNK_SIZE_BLOCKS = CHUNK_WIDTH;
export const MAX_LOD_LEVEL = 12;

const MINECRAFT_MIN_Y = -64;
const MINECRAFT_MAX_Y = 319;
/** Lowest block y of the world in game coordinates. */
export const WORLD_MIN_Y = MINECRAFT_MIN_Y + GAME_Y_OFFSET;
/** Highest block y of the world in game coordinates. */
export const WORLD_MAX_Y = MINECRAFT_MAX_Y + GAME_Y_OFFSET;
export const LOD_SEA_LEVEL = SEA_LEVEL;
/** Water level of a dry cell. */
export const NO_WATER = -32768;
/**
 * The game renders block (x, y, z) over [x - 0.5, x + 0.5] on every axis (chunk meshes sit at chunk origin - 0.5), so
 * world position = block coordinate - BLOCK_RENDER_OFFSET.
 */
export const BLOCK_RENDER_OFFSET = 0.5;

export function cellSizeOfLevel(level: number): number {
  return 1 << level;
}

export function tileSizeOfLevel(level: number): number {
  return TILE_CELLS << level;
}
