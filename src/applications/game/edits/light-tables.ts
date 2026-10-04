import { TRANSPARENT_BLOCKS, getBlockLightLevel } from "../blocks";

export const MAX_LIGHT = 15;

const BLOCK_ID_COUNT = 256;

/** 1 when light passes through the block, indexed by block id. */
export const IS_TRANSPARENT = new Uint8Array(BLOCK_ID_COUNT);

/** Block light level the block emits (0 for most blocks), indexed by block id. */
export const EMISSION = new Uint8Array(BLOCK_ID_COUNT);

for (let block = 0; block < BLOCK_ID_COUNT; block++) {
  IS_TRANSPARENT[block] = TRANSPARENT_BLOCKS.includes(block) ? 1 : 0;
  EMISSION[block] = getBlockLightLevel(block);
}
