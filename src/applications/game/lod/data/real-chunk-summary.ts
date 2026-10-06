// Downsampling of real game chunks for the LOD: per 32 x 32 chunk, the highest LOD-visible block of every column
// (leaves count, plants and carpets do not, a snow layer is a cover on the block below), the water above it, and then
// per chunk column the surface assembled from its vertical chunks, trusting a cell only when the chunk above its top
// is loaded too. The layout matches the game's chunks: index = x * 1024 + y * 32 + z.

import { BlockType, isCrossBlock, isCrop, isFlatQuad, isWater } from "../../blocks";
import { profiler } from "../../profiler";
import { CHUNK_SIZE_BLOCKS, NO_WATER, TILE_CELL_COUNT, TILE_CELLS, WORLD_MAX_Y } from "../core/lod-constants";
import { cellIndexOf, createTileSurface, type TileSurface } from "./tile-surface";

const X_STRIDE = CHUNK_SIZE_BLOCKS * CHUNK_SIZE_BLOCKS;
const Y_STRIDE = CHUNK_SIZE_BLOCKS;
/** No LOD-visible block or water in this column of the chunk. */
export const EMPTY_COLUMN = -32768;
const HIGHEST_CHUNK_Y = Math.floor(WORLD_MAX_Y / CHUNK_SIZE_BLOCKS);

const enum BlockKind {
  Empty = 0,
  Water = 1,
  Solid = 2,
  SnowCover = 3,
}

const BLOCK_KINDS = new Uint8Array(256);
for (let block = 0; block < 256; block++) {
  let kind = BlockKind.Solid;
  if (block === BlockType.AIR || isCrossBlock(block) || isCrop(block) || isFlatQuad(block)) kind = BlockKind.Empty;
  if (isWater(block)) kind = BlockKind.Water;
  if (block === BlockType.SNOW_LAYER) kind = BlockKind.SnowCover;
  BLOCK_KINDS[block] = kind;
}

export interface ChunkSurfaceSummary {
  readonly chunkY: number;
  /** Top face y of the highest solid block in the chunk column, or EMPTY_COLUMN. */
  readonly solidTops: Int16Array;
  readonly topBlocks: Uint8Array;
  readonly sideBlocks: Uint8Array;
  /** Top face y of the highest water block above the solid top (or in an otherwise empty column), or NO_WATER. */
  readonly waterTops: Int16Array;
}

export function summarizeChunk(blocks: Uint8Array, chunkY: number): ChunkSurfaceSummary {
  const solidTops = new Int16Array(TILE_CELL_COUNT).fill(EMPTY_COLUMN);
  const topBlocks = new Uint8Array(TILE_CELL_COUNT);
  const sideBlocks = new Uint8Array(TILE_CELL_COUNT);
  const waterTops = new Int16Array(TILE_CELL_COUNT).fill(NO_WATER);
  const baseY = chunkY * CHUNK_SIZE_BLOCKS;
  let blocksScanned = 0;
  let solidColumns = 0;
  let waterColumns = 0;
  let snowCoverColumns = 0;
  let emptyColumns = 0;
  for (let localX = 0; localX < CHUNK_SIZE_BLOCKS; localX++) {
    for (let localZ = 0; localZ < CHUNK_SIZE_BLOCKS; localZ++) {
      const cell = cellIndexOf(localX, localZ);
      let hasSnowCover = false;
      for (let localY = CHUNK_SIZE_BLOCKS - 1; localY >= 0; localY--) {
        blocksScanned++;
        const block = blocks[localX * X_STRIDE + localY * Y_STRIDE + localZ]!;
        const kind = BLOCK_KINDS[block];
        if (kind === BlockKind.Empty) continue;
        if (kind === BlockKind.Water) {
          if (waterTops[cell] === NO_WATER) waterTops[cell] = baseY + localY + 1;
          continue;
        }
        if (kind === BlockKind.SnowCover) {
          hasSnowCover = true;
          continue;
        }
        solidTops[cell] = baseY + localY + 1;
        topBlocks[cell] = hasSnowCover ? BlockType.SNOW_LAYER : block;
        sideBlocks[cell] = hasSnowCover && block === BlockType.GRASS ? BlockType.GRASS_SNOWY : block;
        break;
      }
      if (solidTops[cell] !== EMPTY_COLUMN) solidColumns++;
      if (waterTops[cell] !== NO_WATER) waterColumns++;
      if (hasSnowCover) snowCoverColumns++;
      if (solidTops[cell] === EMPTY_COLUMN && waterTops[cell] === NO_WATER) emptyColumns++;
    }
  }
  if (profiler.enabled) {
    profiler.addCounter("game.lod.summary.chunks");
    profiler.addCounter("game.lod.summary.blocksScanned", blocksScanned);
    profiler.addCounter("game.lod.summary.solidColumns", solidColumns);
    profiler.addCounter("game.lod.summary.waterColumns", waterColumns);
    profiler.addCounter("game.lod.summary.snowCoverColumns", snowCoverColumns);
    profiler.addCounter("game.lod.summary.emptyColumns", emptyColumns);
  }
  return { chunkY, solidTops, topBlocks, sideBlocks, waterTops };
}

export interface AssembledColumnSurface {
  /** Level-0 tile surface of the chunk column (only covered cells are meaningful). */
  surface: TileSurface;
  /** 1 where the real data is complete enough to trust. */
  coveredCells: Uint8Array;
  coveredCellCount: number;
  /** Chunk y range holding the trusted surface (undefined when no cell is trusted). */
  lowestSurfaceChunkY: number | undefined;
  highestSurfaceChunkY: number | undefined;
}

/**
 * Combines the summaries of one chunk column. Scanning down from the highest loaded chunk, a cell takes the first
 * solid top it meets, with water above it from any chunk on the way. The cell is trusted only if that scan never
 * crossed a missing chunk and at least one empty block of the loaded range lies above it (or the loaded range reaches
 * the top of the world), since an unloaded chunk above could otherwise hold more terrain.
 */
export function assembleColumnSurface(summariesByChunkY: ReadonlyMap<number, ChunkSurfaceSummary>): AssembledColumnSurface {
  const surface = createTileSurface();
  const coveredCells = new Uint8Array(TILE_CELL_COUNT);
  const chunkYs = [...summariesByChunkY.keys()].sort((first, second) => second - first);
  let coveredCellCount = 0;
  let lowestSurfaceChunkY: number | undefined;
  let highestSurfaceChunkY: number | undefined;
  if (chunkYs.length === 0) return { surface, coveredCells, coveredCellCount, lowestSurfaceChunkY, highestSurfaceChunkY };
  const highestLoadedChunkY = chunkYs[0]!;
  const loadedTopFaceY = (highestLoadedChunkY + 1) * CHUNK_SIZE_BLOCKS;
  let chunksScanned = 0;
  let cellsBrokenByGap = 0;
  let cellsRejectedForUnloadedAbove = 0;
  for (let cellZ = 0; cellZ < TILE_CELLS; cellZ++) {
    for (let cellX = 0; cellX < TILE_CELLS; cellX++) {
      const cell = cellIndexOf(cellX, cellZ);
      let waterTop = NO_WATER;
      let expectedChunkY = highestLoadedChunkY;
      for (const chunkY of chunkYs) {
        if (chunkY !== expectedChunkY) {
          cellsBrokenByGap++;
          break;
        }
        chunksScanned++;
        expectedChunkY--;
        const summary = summariesByChunkY.get(chunkY)!;
        if (waterTop === NO_WATER && summary.waterTops[cell] !== NO_WATER) waterTop = summary.waterTops[cell]!;
        const solidTop = summary.solidTops[cell]!;
        if (solidTop === EMPTY_COLUMN) continue;
        const contentTop = Math.max(solidTop, waterTop);
        const hasEmptyBlockAbove = contentTop < loadedTopFaceY || highestLoadedChunkY >= HIGHEST_CHUNK_Y;
        if (!hasEmptyBlockAbove) {
          cellsRejectedForUnloadedAbove++;
          break;
        }
        surface.heights[cell] = solidTop;
        surface.topBlocks[cell] = summary.topBlocks[cell]!;
        surface.sideBlocks[cell] = summary.sideBlocks[cell]!;
        surface.waterLevels[cell] = waterTop > solidTop ? waterTop : NO_WATER;
        coveredCells[cell] = 1;
        coveredCellCount++;
        const topChunkY = Math.floor((Math.max(solidTop, waterTop) - 1) / CHUNK_SIZE_BLOCKS);
        lowestSurfaceChunkY = lowestSurfaceChunkY === undefined ? topChunkY : Math.min(lowestSurfaceChunkY, topChunkY);
        highestSurfaceChunkY = highestSurfaceChunkY === undefined ? topChunkY : Math.max(highestSurfaceChunkY, topChunkY);
        break;
      }
    }
  }
  if (profiler.enabled) {
    profiler.addCounter("game.lod.assemble.columns");
    profiler.addCounter("game.lod.assemble.chunksScanned", chunksScanned);
    profiler.addCounter("game.lod.assemble.cellsTrusted", coveredCellCount);
    profiler.addCounter("game.lod.assemble.cellsBrokenByMissingChunk", cellsBrokenByGap);
    profiler.addCounter("game.lod.assemble.cellsRejectedForUnloadedAbove", cellsRejectedForUnloadedAbove);
    profiler.addCounter("game.lod.assemble.cellsWithoutSolid", TILE_CELLS * TILE_CELLS - coveredCellCount - cellsBrokenByGap - cellsRejectedForUnloadedAbove);
  }
  return { surface, coveredCells, coveredCellCount, lowestSurfaceChunkY, highestSurfaceChunkY };
}
