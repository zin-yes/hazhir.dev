// Deterministic, production-shaped terrain for LOD tests: rolling hills with cliffs, a sea below LOD_SEA_LEVEL, beaches,
// snow caps and stone faces, sampled at cell centres of any tile so neighbouring tiles and levels agree.

import { BlockType } from "../../blocks";
import { cellSizeOfLevel, LOD_SEA_LEVEL, NO_WATER, TILE_CELLS, tileSizeOfLevel } from "../core/lod-constants";
import type { TileAddress } from "../core/tile-address";
import { cellIndexOf, createTileSurface, type TileSurface } from "../data/tile-surface";

export function syntheticHeightAt(blockX: number, blockZ: number): number {
  const rolling = 18 * Math.sin(blockX / 97) + 14 * Math.cos(blockZ / 61) + 6 * Math.sin((blockX + blockZ) / 23);
  const mountain = Math.max(0, 70 * Math.sin(blockX / 400) * Math.cos(blockZ / 350));
  const terrace = Math.floor(mountain / 9) * 9;
  const continent = 25 * Math.sin(blockX / 300 + 1) * Math.sin(blockZ / 260 + 2);
  return Math.round(LOD_SEA_LEVEL + rolling + continent + terrace);
}

export function syntheticBlocksAt(height: number): { top: BlockType; side: BlockType } {
  if (height < LOD_SEA_LEVEL - 2) return { top: BlockType.GRAVEL, side: BlockType.GRAVEL };
  if (height <= LOD_SEA_LEVEL + 2) return { top: BlockType.SAND, side: BlockType.SANDSTONE };
  if (height > LOD_SEA_LEVEL + 60) return { top: BlockType.SNOW_BLOCK, side: BlockType.STONE };
  if (height > LOD_SEA_LEVEL + 35) return { top: BlockType.STONE, side: BlockType.STONE };
  return { top: BlockType.GRASS, side: BlockType.DIRT };
}

export function createSyntheticTileSurface(address: TileAddress): TileSurface {
  const surface = createTileSurface();
  const cellSize = cellSizeOfLevel(address.level);
  const originX = address.tileX * tileSizeOfLevel(address.level);
  const originZ = address.tileZ * tileSizeOfLevel(address.level);
  for (let cellZ = 0; cellZ < TILE_CELLS; cellZ++) {
    for (let cellX = 0; cellX < TILE_CELLS; cellX++) {
      const height = syntheticHeightAt(originX + cellX * cellSize + cellSize / 2, originZ + cellZ * cellSize + cellSize / 2);
      const blocks = syntheticBlocksAt(height);
      const index = cellIndexOf(cellX, cellZ);
      surface.heights[index] = height;
      surface.topBlocks[index] = blocks.top;
      surface.sideBlocks[index] = blocks.side;
      surface.waterLevels[index] = height < LOD_SEA_LEVEL ? LOD_SEA_LEVEL : NO_WATER;
    }
  }
  return surface;
}
