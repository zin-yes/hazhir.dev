import { describe, expect, test } from "bun:test";
import { BlockType } from "../../blocks";
import { topColorOfBlock, WATER_SURFACE_COLOR } from "../colors/block-color-table";
import { cellSizeOfLevel, NO_WATER, TILE_CELLS, tileSizeOfLevel } from "../core/lod-constants";
import type { TileAddress } from "../core/tile-address";
import { cellIndexOf, createTileSurface, type TileSurface } from "../data/tile-surface";
import { decodeWorldQuads, isVerticalSegmentCovered, type WorldQuad } from "../testing/mesh-inspection.test-helper";
import { createSyntheticTileSurface } from "../testing/synthetic-terrain.test-helper";
import { meshTileSurface } from "./heightfield-mesher";
import { LodFace, LodMaterial } from "./lod-vertex-format";

function meshAndDecode(address: TileAddress, surface: TileSurface = createSyntheticTileSurface(address)) {
  const startedAt = performance.now();
  const mesh = meshTileSurface(surface);
  const elapsedMs = performance.now() - startedAt;
  return { surface, mesh, quads: decodeWorldQuads(mesh, address), elapsedMs };
}

function heightAtWorld(surface: TileSurface, address: TileAddress, blockX: number, blockZ: number): number {
  const cellSize = cellSizeOfLevel(address.level);
  const cellX = Math.floor((blockX - address.tileX * tileSizeOfLevel(address.level)) / cellSize);
  const cellZ = Math.floor((blockZ - address.tileZ * tileSizeOfLevel(address.level)) / cellSize);
  return surface.heights[cellIndexOf(cellX, cellZ)]!;
}

describe("heightfield mesher", () => {
  test("top quads cover every cell exactly once at its height and colour, with far fewer quads than cells", () => {
    const address = { level: 0, tileX: 8, tileZ: 10 };
    const { surface, mesh, quads, elapsedMs } = meshAndDecode(address);
    console.log(`mesh level-0 tile: ${elapsedMs.toFixed(2)} ms, ${mesh.vertices.length / 2} vertices`);
    const coverCount = new Uint8Array(TILE_CELLS * TILE_CELLS);
    const tops = quads.filter((quad) => quad.face === LodFace.Up && quad.material === LodMaterial.Terrain);
    const cellSize = cellSizeOfLevel(address.level);
    const originX = address.tileX * tileSizeOfLevel(address.level);
    const originZ = address.tileZ * tileSizeOfLevel(address.level);
    for (const quad of tops) {
      for (let blockZ = quad.minZ; blockZ < quad.maxZ; blockZ += cellSize) {
        for (let blockX = quad.minX; blockX < quad.maxX; blockX += cellSize) {
          const index = cellIndexOf((blockX - originX) / cellSize, (blockZ - originZ) / cellSize);
          coverCount[index]!++;
          expect(quad.minY).toBe(surface.heights[index]!);
          expect(quad.color).toBe(topColorOfBlock(surface.topBlocks[index]!));
        }
      }
    }
    expect(Array.from(coverCount).every((count) => count === 1)).toBe(true);
    expect(tops.length).toBeLessThan(TILE_CELLS * TILE_CELLS / 2);
  });

  test("a flat single-material tile merges into one top quad and four skirts", () => {
    const surface = createTileSurface();
    surface.heights.fill(90);
    surface.topBlocks.fill(BlockType.GRASS);
    surface.sideBlocks.fill(BlockType.GRASS);
    const { quads } = meshAndDecode({ level: 5, tileX: 0, tileZ: 0 }, surface);
    expect(quads.filter((quad) => quad.face === LodFace.Up)).toHaveLength(1);
    expect(quads.filter((quad) => quad.face !== LodFace.Up)).toHaveLength(4);
  });

  test("every height step between neighbouring cells is closed by a wall facing the lower cell", () => {
    const address = { level: 2, tileX: -1, tileZ: 0 };
    const { surface, quads } = meshAndDecode(address);
    const cellSize = cellSizeOfLevel(address.level);
    const originX = address.tileX * tileSizeOfLevel(address.level);
    const originZ = address.tileZ * tileSizeOfLevel(address.level);
    let steps = 0;
    for (let cellZ = 0; cellZ < TILE_CELLS; cellZ++) {
      for (let cellX = 0; cellX + 1 < TILE_CELLS; cellX++) {
        const westHeight = surface.heights[cellIndexOf(cellX, cellZ)]!;
        const eastHeight = surface.heights[cellIndexOf(cellX + 1, cellZ)]!;
        if (westHeight === eastHeight) continue;
        steps++;
        const face = westHeight > eastHeight ? LodFace.PositiveX : LodFace.NegativeX;
        const middleZ = originZ + cellZ * cellSize + cellSize / 2;
        const planeX = originX + (cellX + 1) * cellSize;
        expect(isVerticalSegmentCovered(quads, face, planeX, middleZ, Math.min(westHeight, eastHeight), Math.max(westHeight, eastHeight))).toBe(true);
      }
    }
    for (let cellX = 0; cellX < TILE_CELLS; cellX++) {
      for (let cellZ = 0; cellZ + 1 < TILE_CELLS; cellZ++) {
        const northHeight = surface.heights[cellIndexOf(cellX, cellZ)]!;
        const southHeight = surface.heights[cellIndexOf(cellX, cellZ + 1)]!;
        if (northHeight === southHeight) continue;
        steps++;
        const face = northHeight > southHeight ? LodFace.PositiveZ : LodFace.NegativeZ;
        const middleX = originX + cellX * cellSize + cellSize / 2;
        const planeZ = originZ + (cellZ + 1) * cellSize;
        expect(isVerticalSegmentCovered(quads, face, planeZ, middleX, Math.min(northHeight, southHeight), Math.max(northHeight, southHeight))).toBe(true);
      }
    }
    expect(steps).toBeGreaterThan(200);
  });

  test("tiles of neighbouring levels leave no crack along their shared border", () => {
    const pairs: [TileAddress, TileAddress, "x" | "z"][] = [
      [{ level: 2, tileX: 1, tileZ: 2 }, { level: 3, tileX: 1, tileZ: 1 }, "x"],
      [{ level: 4, tileX: -1, tileZ: 0 }, { level: 3, tileX: -1, tileZ: 2 }, "z"],
      [{ level: 1, tileX: 3, tileZ: -2 }, { level: 1, tileX: 4, tileZ: -2 }, "x"],
    ];
    let checkedPoints = 0;
    let steppedPoints = 0;
    for (const [first, second, axis] of pairs) {
      const firstMesh = meshAndDecode(first);
      const secondMesh = meshAndDecode(second);
      const firstEnd = (axis === "x" ? first.tileX + 1 : first.tileZ + 1) * tileSizeOfLevel(first.level);
      const secondStart = (axis === "x" ? second.tileX : second.tileZ) * tileSizeOfLevel(second.level);
      expect(firstEnd).toBe(secondStart);
      const firstAlongStart = (axis === "x" ? first.tileZ : first.tileX) * tileSizeOfLevel(first.level);
      const secondAlongStart = (axis === "x" ? second.tileZ : second.tileX) * tileSizeOfLevel(second.level);
      const sharedStart = Math.max(firstAlongStart, secondAlongStart);
      const sharedEnd = Math.min(firstAlongStart + tileSizeOfLevel(first.level), secondAlongStart + tileSizeOfLevel(second.level));
      expect(sharedEnd).toBeGreaterThan(sharedStart);
      for (let along = sharedStart + 0.5; along < sharedEnd; along += 1) {
        const firstHeight =
          axis === "x" ? heightAtWorld(firstMesh.surface, first, firstEnd - 0.5, along) : heightAtWorld(firstMesh.surface, first, along, firstEnd - 0.5);
        const secondHeight =
          axis === "x" ? heightAtWorld(secondMesh.surface, second, firstEnd + 0.5, along) : heightAtWorld(secondMesh.surface, second, along, firstEnd + 0.5);
        checkedPoints++;
        if (firstHeight === secondHeight) continue;
        steppedPoints++;
        const firstIsHigher = firstHeight > secondHeight;
        const higherQuads: WorldQuad[] = firstIsHigher ? firstMesh.quads : secondMesh.quads;
        const face = axis === "x" ? (firstIsHigher ? LodFace.PositiveX : LodFace.NegativeX) : firstIsHigher ? LodFace.PositiveZ : LodFace.NegativeZ;
        expect(isVerticalSegmentCovered(higherQuads, face, firstEnd, along, Math.min(firstHeight, secondHeight), Math.max(firstHeight, secondHeight))).toBe(true);
      }
    }
    expect(checkedPoints).toBeGreaterThan(300);
    expect(steppedPoints).toBeGreaterThan(checkedPoints / 4);
  });

  test("water quads sit in their own index range over submerged cells only", () => {
    const address = { level: 3, tileX: -1, tileZ: 0 };
    const { surface, mesh, quads } = meshAndDecode(address);
    const waterQuads = quads.filter((quad) => quad.material === LodMaterial.Water);
    expect(waterQuads.length).toBeGreaterThan(0);
    expect(mesh.waterIndexCount).toBe(waterQuads.length * 6);
    expect(quads.slice(0, mesh.terrainIndexCount / 6).every((quad) => quad.material === LodMaterial.Terrain)).toBe(true);
    const cellSize = cellSizeOfLevel(address.level);
    const originX = address.tileX * tileSizeOfLevel(address.level);
    const originZ = address.tileZ * tileSizeOfLevel(address.level);
    let waterCells = 0;
    for (const quad of waterQuads) {
      expect(quad.color).toBe(WATER_SURFACE_COLOR);
      for (let blockZ = quad.minZ; blockZ < quad.maxZ; blockZ += cellSize) {
        for (let blockX = quad.minX; blockX < quad.maxX; blockX += cellSize) {
          const index = cellIndexOf((blockX - originX) / cellSize, (blockZ - originZ) / cellSize);
          expect(surface.waterLevels[index]).not.toBe(NO_WATER);
          expect(quad.minY).toBe(surface.waterLevels[index]!);
          expect(surface.heights[index]!).toBeLessThan(quad.minY);
          waterCells++;
        }
      }
    }
    const expectedWaterCells = Array.from(surface.waterLevels).filter((level, index) => level !== NO_WATER && level > surface.heights[index]!).length;
    expect(waterCells).toBe(expectedWaterCells);
  });
});
