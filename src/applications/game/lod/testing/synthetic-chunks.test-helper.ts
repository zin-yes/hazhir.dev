// Game-layout chunks (index = x * 1024 + y * 32 + z) built from the synthetic terrain, with what real chunks contain
// on top of the ground: sea water, tall grass, snow layers on high ground and small trees with leaf canopies.

import { BlockType } from "../../blocks";
import { CHUNK_SIZE_BLOCKS, LOD_SEA_LEVEL } from "../core/lod-constants";
import { syntheticBlocksAt, syntheticHeightAt } from "./synthetic-terrain.test-helper";

const CHUNK_VOLUME = CHUNK_SIZE_BLOCKS ** 3;
const TREE_TRUNK_HEIGHT = 4;

export function isSyntheticTreeColumn(blockX: number, blockZ: number): boolean {
  return ((blockX * 7 + blockZ * 13) & 63) === 5;
}

export function isSyntheticGrassTuft(blockX: number, blockZ: number): boolean {
  return ((blockX * 3 + blockZ * 5) & 7) === 2;
}

export function syntheticColumnBlockAt(blockX: number, blockY: number, blockZ: number): BlockType {
  const ground = syntheticHeightAt(blockX, blockZ);
  const { top, side } = syntheticBlocksAt(ground);
  if (blockY < ground - 3) return BlockType.STONE;
  if (blockY < ground - 1) return side === BlockType.GRASS ? BlockType.DIRT : side;
  if (blockY === ground - 1) return top;
  if (blockY < LOD_SEA_LEVEL) return BlockType.WATER;
  const isLand = ground >= LOD_SEA_LEVEL;
  if (isLand && top === BlockType.GRASS && isSyntheticTreeColumn(blockX, blockZ) && blockY < ground + TREE_TRUNK_HEIGHT) return BlockType.LOG;
  if (isLand && top === BlockType.GRASS && blockY === ground + TREE_TRUNK_HEIGHT) {
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
        if (isSyntheticTreeColumn(blockX + offsetX, blockZ + offsetZ) && syntheticHeightAt(blockX + offsetX, blockZ + offsetZ) === ground) return BlockType.LEAVES;
      }
    }
  }
  if (isLand && blockY === ground && top === BlockType.SNOW_BLOCK) return BlockType.SNOW_LAYER;
  if (isLand && blockY === ground && top === BlockType.GRASS && isSyntheticGrassTuft(blockX, blockZ)) return BlockType.TALL_GRASS;
  return BlockType.AIR;
}

export function createSyntheticChunk(chunkX: number, chunkY: number, chunkZ: number): Uint8Array {
  const blocks = new Uint8Array(CHUNK_VOLUME);
  for (let localX = 0; localX < CHUNK_SIZE_BLOCKS; localX++) {
    for (let localY = 0; localY < CHUNK_SIZE_BLOCKS; localY++) {
      for (let localZ = 0; localZ < CHUNK_SIZE_BLOCKS; localZ++) {
        blocks[localX * CHUNK_SIZE_BLOCKS * CHUNK_SIZE_BLOCKS + localY * CHUNK_SIZE_BLOCKS + localZ] = syntheticColumnBlockAt(
          chunkX * CHUNK_SIZE_BLOCKS + localX,
          chunkY * CHUNK_SIZE_BLOCKS + localY,
          chunkZ * CHUNK_SIZE_BLOCKS + localZ,
        );
      }
    }
  }
  return blocks;
}
