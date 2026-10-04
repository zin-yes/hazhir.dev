import { describe, expect, test } from "bun:test";
import { BlockType } from "../../blocks";
import { LOD_SEA_LEVEL, NO_WATER, TILE_CELL_COUNT, TILE_CELLS } from "../core/lod-constants";
import { createSyntheticChunk, isSyntheticGrassTuft, isSyntheticTreeColumn } from "../testing/synthetic-chunks.test-helper";
import { syntheticBlocksAt, syntheticHeightAt } from "../testing/synthetic-terrain.test-helper";
import { assembleColumnSurface, summarizeChunk, type ChunkSurfaceSummary } from "./real-chunk-summary";
import { REAL_SURFACE_NODE_BYTES, RealSurfacePyramid } from "./real-surface-pyramid";
import { cellIndexOf } from "./tile-surface";

function summariesOf(chunkX: number, chunkZ: number, chunkYs: number[]): Map<number, ChunkSurfaceSummary> {
  const summaries = new Map<number, ChunkSurfaceSummary>();
  for (const chunkY of chunkYs) summaries.set(chunkY, summarizeChunk(createSyntheticChunk(chunkX, chunkY, chunkZ), chunkY));
  return summaries;
}

describe("real chunk downsampling", () => {
  test("columns keep tree canopies, skip plants, read water and treat snow layers as a cover", () => {
    const startedAt = performance.now();
    const seen = { tree: 0, tuft: 0, ocean: 0, snow: 0 };
    for (const [chunkX, chunkZ] of [[0, 0], [-8, 4], [9, 9], [3, -12], [12, 1]]) {
      const assembled = assembleColumnSurface(summariesOf(chunkX!, chunkZ!, [-1, 0, 1, 2, 3, 4, 5, 6, 7]));
      for (let cellZ = 0; cellZ < TILE_CELLS; cellZ++) {
        for (let cellX = 0; cellX < TILE_CELLS; cellX++) {
          const blockX = chunkX! * 32 + cellX;
          const blockZ = chunkZ! * 32 + cellZ;
          const ground = syntheticHeightAt(blockX, blockZ);
          const groundTop = syntheticBlocksAt(ground).top;
          const cell = cellIndexOf(cellX, cellZ);
          expect(assembled.coveredCells[cell]).toBe(1);
          if (ground < LOD_SEA_LEVEL) {
            seen.ocean++;
            expect(assembled.surface.heights[cell]).toBe(ground);
            expect(assembled.surface.waterLevels[cell]).toBe(LOD_SEA_LEVEL);
          } else if (groundTop === BlockType.GRASS && isSyntheticTreeColumn(blockX, blockZ)) {
            seen.tree++;
            expect(assembled.surface.heights[cell]).toBe(ground + 5);
            expect(assembled.surface.topBlocks[cell]).toBe(BlockType.LEAVES);
          } else if (groundTop === BlockType.SNOW_BLOCK) {
            seen.snow++;
            expect(assembled.surface.heights[cell]).toBe(ground);
            expect(assembled.surface.topBlocks[cell]).toBe(BlockType.SNOW_LAYER);
          } else if (groundTop === BlockType.GRASS && isSyntheticGrassTuft(blockX, blockZ) && assembled.surface.topBlocks[cell] !== BlockType.LEAVES) {
            seen.tuft++;
            expect(assembled.surface.heights[cell]).toBe(ground);
            expect(assembled.surface.topBlocks[cell]).toBe(BlockType.GRASS);
            expect(assembled.surface.waterLevels[cell]).toBe(NO_WATER);
          }
        }
      }
    }
    console.log(`summaries and assembly of 5 columns: ${(performance.now() - startedAt).toFixed(1)} ms`, seen);
    expect(seen.tree).toBeGreaterThan(5);
    expect(seen.tuft).toBeGreaterThan(50);
    expect(seen.ocean).toBeGreaterThan(50);
    expect(seen.snow).toBeGreaterThan(5);
  });

  test("cells whose surface could continue into an unloaded chunk are not trusted", () => {
    const chunkX = 9;
    const chunkZ = 9;
    const onlyMiddle = assembleColumnSurface(summariesOf(chunkX, chunkZ, [2, 3]));
    const withGap = assembleColumnSurface(summariesOf(chunkX, chunkZ, [1, 3, 4]));
    let trustedCells = 0;
    let rejectedCells = 0;
    for (let cell = 0; cell < TILE_CELL_COUNT; cell++) {
      const blockX = chunkX * 32 + (cell % TILE_CELLS);
      const blockZ = chunkZ * 32 + Math.floor(cell / TILE_CELLS);
      const ground = syntheticHeightAt(blockX, blockZ);
      if (onlyMiddle.coveredCells[cell] === 1) {
        trustedCells++;
        expect(onlyMiddle.surface.heights[cell]!).toBeLessThan(128);
        expect(onlyMiddle.surface.heights[cell]!).toBeGreaterThan(64);
      } else {
        rejectedCells++;
      }
      if (ground > 64 && ground + 6 <= 96) expect(withGap.coveredCells[cell]).toBe(0);
    }
    expect(trustedCells).toBeGreaterThan(100);
    expect(onlyMiddle.highestSurfaceChunkY).toBe(3);
    expect(rejectedCells + trustedCells).toBe(TILE_CELL_COUNT);
  });
});

describe("real surface pyramid", () => {
  function fullyCoveredColumn(chunkX: number, chunkZ: number) {
    return assembleColumnSurface(summariesOf(chunkX, chunkZ, [-1, 0, 1, 2, 3, 4, 5, 6, 7]));
  }

  test("a 2 x 2 block of columns fills its level-1 parent, and clearing one column uncovers only its quadrant", () => {
    const pyramid = new RealSurfacePyramid(4);
    const columns = [[4, 6], [5, 6], [4, 7], [5, 7]].map(([chunkX, chunkZ]) => ({ chunkX: chunkX!, chunkZ: chunkZ!, column: fullyCoveredColumn(chunkX!, chunkZ!) }));
    for (const { chunkX, chunkZ, column } of columns) pyramid.setColumn(chunkX, chunkZ, column.surface, column.coveredCells);
    const parent = pyramid.nodeAt({ level: 1, tileX: 2, tileZ: 3 })!;
    expect(parent.coveredCellCount).toBe(TILE_CELL_COUNT);
    const southEast = columns[3]!.column.surface;
    const expectedHeight = Math.round(
      (southEast.heights[cellIndexOf(0, 0)]! + southEast.heights[cellIndexOf(1, 0)]! + southEast.heights[cellIndexOf(0, 1)]! + southEast.heights[cellIndexOf(1, 1)]!) / 4,
    );
    expect(parent.surface.heights[cellIndexOf(16, 16)]).toBe(expectedHeight);
    expect(pyramid.nodeAt({ level: 4, tileX: 0, tileZ: 0 })!.coveredCellCount).toBe(16);

    const versionBefore = parent.version;
    const changed = pyramid.setColumn(5, 6, columns[1]!.column.surface, new Uint8Array(TILE_CELL_COUNT));
    expect(changed.map((address) => address.level)).toEqual([0, 1, 2, 3, 4]);
    expect(pyramid.nodeAt({ level: 0, tileX: 5, tileZ: 6 })).toBeUndefined();
    expect(parent.coveredCellCount).toBe(TILE_CELL_COUNT * 3 / 4);
    expect(parent.coveredCells[cellIndexOf(20, 3)]).toBe(0);
    expect(parent.coveredCells[cellIndexOf(3, 3)]).toBe(1);
    expect(parent.version).toBeGreaterThan(versionBefore);
    expect(pyramid.nodeAt({ level: 4, tileX: 0, tileZ: 0 })!.coveredCellCount).toBe(12);
  });

  test("the memory budget evicts the least recently updated nodes and keeps the newest column", () => {
    const column = fullyCoveredColumn(0, 0);
    const budgetNodes = 20;
    const pyramid = new RealSurfacePyramid(2, budgetNodes * REAL_SURFACE_NODE_BYTES);
    for (let chunkX = 0; chunkX < 30; chunkX++) pyramid.setColumn(chunkX * 4, 0, column.surface, column.coveredCells);
    expect(pyramid.nodeCount).toBeLessThanOrEqual(budgetNodes);
    expect(pyramid.byteSize).toBeLessThanOrEqual(budgetNodes * REAL_SURFACE_NODE_BYTES);
    expect(pyramid.nodeAt({ level: 0, tileX: 29 * 4, tileZ: 0 })).toBeDefined();
    expect(pyramid.nodeAt({ level: 0, tileX: 0, tileZ: 0 })).toBeUndefined();
  });
});
