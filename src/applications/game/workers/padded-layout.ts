import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "../config";

if (CHUNK_WIDTH !== 32 || CHUNK_HEIGHT !== 32 || CHUNK_LENGTH !== 32) {
  throw new Error("The mesher packs a row of 32 cells into one uint32, so chunks must be 32 blocks per side");
}

/**
 * Blocks and light are copied into an array padded by one cell on every side so
 * every neighbor and ambient occlusion sample is a plain index with no bounds
 * branches. Rows along z are padded to a whole number of uint32 words, so a row
 * of the chunk is copied as eight word moves.
 */
export const Z_PADDING = 4;
export const PADDED_COLUMNS = CHUNK_WIDTH + 2;
export const PADDED_ROWS = CHUNK_HEIGHT + 2;
export const STRIDE_Y = CHUNK_LENGTH + 2 * Z_PADDING;
export const STRIDE_X = PADDED_ROWS * STRIDE_Y;
export const PADDED_VOLUME = PADDED_COLUMNS * STRIDE_X;

export function paddedIndex(x: number, y: number, z: number): number {
  return (x + 1) * STRIDE_X + (y + 1) * STRIDE_Y + z + Z_PADDING;
}

export function paddedDelta(deltaX: number, deltaY: number, deltaZ: number): number {
  return deltaX * STRIDE_X + deltaY * STRIDE_Y + deltaZ;
}
