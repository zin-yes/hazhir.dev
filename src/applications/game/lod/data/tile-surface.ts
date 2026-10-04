// The per-tile heightfield every LOD stage works on: for each of the 32 x 32 cells, the top surface height, the block
// seen on top and on walls, and the water surface. Cells are indexed cellX + cellZ * TILE_CELLS.

import { NO_WATER, TILE_CELL_COUNT, TILE_CELLS } from "../core/lod-constants";

export interface TileSurface {
  /** Game y of the top face of the highest LOD-visible block (block y + 1). */
  readonly heights: Int16Array;
  readonly topBlocks: Uint8Array;
  /** Block shown on walls below the top block (dirt under grass, sandstone under sand). */
  readonly sideBlocks: Uint8Array;
  /** Game y of the water surface, or NO_WATER for dry cells. */
  readonly waterLevels: Int16Array;
}

export function createTileSurface(): TileSurface {
  return {
    heights: new Int16Array(TILE_CELL_COUNT),
    topBlocks: new Uint8Array(TILE_CELL_COUNT),
    sideBlocks: new Uint8Array(TILE_CELL_COUNT),
    waterLevels: new Int16Array(TILE_CELL_COUNT).fill(NO_WATER),
  };
}

export function cellIndexOf(cellX: number, cellZ: number): number {
  return cellX + cellZ * TILE_CELLS;
}

export interface HeightRange {
  minHeight: number;
  maxHeight: number;
}

/** Lowest and highest surface of the tile, counting water surfaces. */
export function heightRangeOf(surface: TileSurface): HeightRange {
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  for (let index = 0; index < TILE_CELL_COUNT; index++) {
    const height = surface.heights[index]!;
    const top = Math.max(height, surface.waterLevels[index]!);
    if (height < minHeight) minHeight = height;
    if (top > maxHeight) maxHeight = top;
  }
  return { minHeight, maxHeight };
}

function mostCommonOfFour(first: number, second: number, third: number, fourth: number, tieBreaker: number): number {
  const candidates = [first, second, third, fourth];
  let best = tieBreaker;
  let bestCount = 0;
  for (const candidate of candidates) {
    let count = 0;
    for (const other of candidates) if (other === candidate) count++;
    if (count > bestCount || (count === bestCount && candidate === tieBreaker)) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Writes one quadrant of a parent tile from a child tile one level finer: each parent cell takes the rounded mean
 * height of its 2 x 2 children, the most common blocks (the highest child breaks ties) and the highest water surface
 * when at least half the children are wet.
 */
export function downsampleChildIntoParent(child: TileSurface, parent: TileSurface, quadrantX: number, quadrantZ: number): void {
  const half = TILE_CELLS / 2;
  for (let parentLocalZ = 0; parentLocalZ < half; parentLocalZ++) {
    for (let parentLocalX = 0; parentLocalX < half; parentLocalX++) {
      const childIndices = [
        cellIndexOf(parentLocalX * 2, parentLocalZ * 2),
        cellIndexOf(parentLocalX * 2 + 1, parentLocalZ * 2),
        cellIndexOf(parentLocalX * 2, parentLocalZ * 2 + 1),
        cellIndexOf(parentLocalX * 2 + 1, parentLocalZ * 2 + 1),
      ] as const;
      let heightSum = 0;
      let highestIndex = childIndices[0];
      let wetChildren = 0;
      let highestWater = NO_WATER;
      for (const childIndex of childIndices) {
        const height = child.heights[childIndex]!;
        heightSum += height;
        if (height > child.heights[highestIndex]!) highestIndex = childIndex;
        const water = child.waterLevels[childIndex]!;
        if (water !== NO_WATER) {
          wetChildren++;
          if (water > highestWater) highestWater = water;
        }
      }
      const parentIndex = cellIndexOf(quadrantX * half + parentLocalX, quadrantZ * half + parentLocalZ);
      const meanHeight = Math.round(heightSum / 4);
      parent.heights[parentIndex] = meanHeight;
      parent.topBlocks[parentIndex] = mostCommonOfFour(
        child.topBlocks[childIndices[0]]!,
        child.topBlocks[childIndices[1]]!,
        child.topBlocks[childIndices[2]]!,
        child.topBlocks[childIndices[3]]!,
        child.topBlocks[highestIndex]!,
      );
      parent.sideBlocks[parentIndex] = mostCommonOfFour(
        child.sideBlocks[childIndices[0]]!,
        child.sideBlocks[childIndices[1]]!,
        child.sideBlocks[childIndices[2]]!,
        child.sideBlocks[childIndices[3]]!,
        child.sideBlocks[highestIndex]!,
      );
      parent.waterLevels[parentIndex] = wetChildren >= 2 && highestWater > meanHeight ? highestWater : NO_WATER;
    }
  }
}
