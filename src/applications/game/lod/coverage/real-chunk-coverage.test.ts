import { describe, expect, test } from "bun:test";
import { tileBoundsOf, type TileAddress } from "../core/tile-address";
import { projectionScaleOf, selectTiles } from "../selection/quadtree-selection";
import { isFragmentHiddenByCoverage, RealChunkCoverage, writeCoverageTexels } from "./real-chunk-coverage";

const PLAYER_CHUNK_X = 30;
const PLAYER_CHUNK_Z = -12;
const RENDER_DISTANCE = 3;

function coverageWithLoadedRing(): RealChunkCoverage {
  const coverage = new RealChunkCoverage();
  for (let chunkX = PLAYER_CHUNK_X - RENDER_DISTANCE; chunkX <= PLAYER_CHUNK_X + RENDER_DISTANCE; chunkX++) {
    for (let chunkZ = PLAYER_CHUNK_Z - RENDER_DISTANCE; chunkZ <= PLAYER_CHUNK_Z + RENDER_DISTANCE; chunkZ++) {
      coverage.setSurfaceChunkRange(chunkX, chunkZ, 2, 3);
      for (let chunkY = 0; chunkY <= 5; chunkY++) coverage.markMeshed(chunkX, chunkY, chunkZ);
    }
  }
  return coverage;
}

function tileContaining(leaves: TileAddress[], blockX: number, blockZ: number): TileAddress[] {
  return leaves.filter((leaf) => {
    const bounds = tileBoundsOf(leaf);
    return blockX >= bounds.minX && blockX < bounds.maxX && blockZ >= bounds.minZ && blockZ < bounds.maxZ;
  });
}

describe("real chunk coverage", () => {
  test("a column hides the LOD only while every chunk of its surface range is meshed", () => {
    const coverage = coverageWithLoadedRing();
    expect(coverage.coveredColumnCount).toBe(49);
    const versionBefore = coverage.version;
    coverage.markUnloaded(PLAYER_CHUNK_X, 3, PLAYER_CHUNK_Z);
    expect(coverage.isColumnCovered(PLAYER_CHUNK_X, PLAYER_CHUNK_Z)).toBe(false);
    coverage.markUnloaded(PLAYER_CHUNK_X + 1, 5, PLAYER_CHUNK_Z);
    expect(coverage.isColumnCovered(PLAYER_CHUNK_X + 1, PLAYER_CHUNK_Z)).toBe(true);
    coverage.markMeshed(PLAYER_CHUNK_X, 3, PLAYER_CHUNK_Z);
    expect(coverage.isColumnCovered(PLAYER_CHUNK_X, PLAYER_CHUNK_Z)).toBe(true);
    expect(coverage.version).toBe(versionBefore + 2);
    coverage.setSurfaceChunkRange(PLAYER_CHUNK_X, PLAYER_CHUNK_Z, 2, 7);
    expect(coverage.isColumnCovered(PLAYER_CHUNK_X, PLAYER_CHUNK_Z)).toBe(false);
    coverage.forgetColumn(PLAYER_CHUNK_X - 1, PLAYER_CHUNK_Z);
    expect(coverage.isColumnCovered(PLAYER_CHUNK_X - 1, PLAYER_CHUNK_Z)).toBe(false);
  });

  test.each([8, 40])("selected tiles plus the coverage mask draw every uncovered point once and no covered point (%d px cells)", (maximumCellPixels) => {
    const startedAt = performance.now();
    const coverage = coverageWithLoadedRing();
    const cameraX = PLAYER_CHUNK_X * 32 + 11;
    const cameraZ = PLAYER_CHUNK_Z * 32 + 20;
    const selection = selectTiles({
      cameraX,
      cameraY: 100,
      cameraZ,
      projectionScale: projectionScaleOf(85, 1080),
      maximumCellPixels,
      thresholdGrowthPerLevel: 1.2,
      radiusBlocks: 2048,
      minimumLevel: 0,
      maximumLevel: 6,
    });
    const drawnLeaves = selection.leaves.filter((leaf) => !coverage.isTileFullyCovered(leaf));
    const partiallyCovered = drawnLeaves.filter((leaf) => coverage.isTilePartiallyCovered(leaf)).length;
    if (maximumCellPixels === 8) expect(drawnLeaves.length).toBeLessThan(selection.leaves.length);
    else expect(partiallyCovered).toBeGreaterThan(0);
    const textureSize = 64;
    const texels = new Uint8Array(textureSize * textureSize);
    writeCoverageTexels(coverage, PLAYER_CHUNK_X, PLAYER_CHUNK_Z, textureSize, texels);
    let coveredPoints = 0;
    let drawnPoints = 0;
    for (let offsetX = -600; offsetX <= 600; offsetX += 7) {
      for (let offsetZ = -600; offsetZ <= 600; offsetZ += 9) {
        const pointX = cameraX + offsetX + 0.5;
        const pointZ = cameraZ + offsetZ + 0.5;
        const isCovered = coverage.isColumnCovered(Math.floor(pointX / 32), Math.floor(pointZ / 32));
        const tiles = tileContaining(drawnLeaves, pointX, pointZ);
        const hidden = isFragmentHiddenByCoverage(texels, textureSize, PLAYER_CHUNK_X, PLAYER_CHUNK_Z, pointX, pointZ, 0, 0);
        if (isCovered) {
          coveredPoints++;
          expect(tiles.length === 0 || hidden).toBe(true);
        } else {
          drawnPoints++;
          expect(tiles).toHaveLength(1);
          expect(hidden).toBe(false);
        }
      }
    }
    expect(coveredPoints).toBeGreaterThan(300);
    expect(drawnPoints).toBeGreaterThan(10000);
    console.log(`coverage sweep: ${(performance.now() - startedAt).toFixed(1)} ms`);
  });

  test("a wall on a column border belongs to the cell it rises from", () => {
    const coverage = coverageWithLoadedRing();
    const size = 64;
    const texels = new Uint8Array(size * size);
    writeCoverageTexels(coverage, PLAYER_CHUNK_X, PLAYER_CHUNK_Z, size, texels);
    const borderX = (PLAYER_CHUNK_X + RENDER_DISTANCE + 1) * 32;
    const middleZ = PLAYER_CHUNK_Z * 32 + 16;
    expect(isFragmentHiddenByCoverage(texels, size, PLAYER_CHUNK_X, PLAYER_CHUNK_Z, borderX, middleZ, -1, 0)).toBe(false);
    expect(isFragmentHiddenByCoverage(texels, size, PLAYER_CHUNK_X, PLAYER_CHUNK_Z, borderX, middleZ, 1, 0)).toBe(true);
  });

  test("columns outside the texture window never alias onto covered texels", () => {
    const coverage = coverageWithLoadedRing();
    const size = 64;
    const texels = new Uint8Array(size * size);
    writeCoverageTexels(coverage, PLAYER_CHUNK_X, PLAYER_CHUNK_Z, size, texels);
    const aliasX = (PLAYER_CHUNK_X + size) * 32 + 5;
    const aliasZ = PLAYER_CHUNK_Z * 32 + 5;
    expect(isFragmentHiddenByCoverage(texels, size, PLAYER_CHUNK_X, PLAYER_CHUNK_Z, aliasX, aliasZ, 0, 0)).toBe(false);
    expect(isFragmentHiddenByCoverage(texels, size, PLAYER_CHUNK_X, PLAYER_CHUNK_Z, PLAYER_CHUNK_X * 32 + 5, aliasZ, 0, 0)).toBe(true);
  });
});
