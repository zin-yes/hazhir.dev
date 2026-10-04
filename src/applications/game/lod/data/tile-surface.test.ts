import { describe, expect, test } from "bun:test";
import { BlockType } from "../../blocks";
import { LOD_SEA_LEVEL, NO_WATER, TILE_CELL_COUNT, TILE_CELLS } from "../core/lod-constants";
import { childAddressesOf } from "../core/tile-address";
import { createSyntheticTileSurface } from "../testing/synthetic-terrain.test-helper";
import { packedHeightRange, packTileSurface, unpackTileSurface } from "./packed-tile-surface";
import { cellIndexOf, createTileSurface, downsampleChildIntoParent, heightRangeOf, type TileSurface } from "./tile-surface";

function expectSameSurface(actual: TileSurface, expected: TileSurface) {
  expect(Array.from(actual.heights)).toEqual(Array.from(expected.heights));
  expect(Array.from(actual.topBlocks)).toEqual(Array.from(expected.topBlocks));
  expect(Array.from(actual.sideBlocks)).toEqual(Array.from(expected.sideBlocks));
  expect(Array.from(actual.waterLevels)).toEqual(Array.from(expected.waterLevels));
}

describe("packed tile surface", () => {
  test("round-trips a coastal tile with a uniform sea level and shrinks it", () => {
    const surface = createSyntheticTileSurface({ level: 3, tileX: 1, tileZ: 1 });
    const wetCells = surface.waterLevels.filter((level) => level !== NO_WATER).length;
    expect(wetCells).toBeGreaterThan(10);
    expect(wetCells).toBeLessThan(TILE_CELL_COUNT);
    const packed = packTileSurface(surface);
    expectSameSurface(unpackTileSurface(packed), surface);
    expect(packed.byteLength).toBeLessThan(TILE_CELL_COUNT * 6 / 2);
    expect(packedHeightRange(packed)).toEqual(heightRangeOf(surface));
  });

  test("round-trips tall cliffs (height range over 255), mixed lake levels and a large block palette", () => {
    const surface = createSyntheticTileSurface({ level: 0, tileX: 0, tileZ: 0 });
    for (let index = 0; index < TILE_CELL_COUNT; index++) {
      surface.topBlocks[index] = (index * 7) % 200 + 1;
      surface.sideBlocks[index] = (index * 13) % 190 + 1;
    }
    surface.heights[cellIndexOf(5, 5)] = -40;
    surface.heights[cellIndexOf(6, 5)] = 330;
    surface.waterLevels[cellIndexOf(1, 1)] = 120;
    surface.waterLevels[cellIndexOf(2, 1)] = LOD_SEA_LEVEL;
    expectSameSurface(unpackTileSurface(packTileSurface(surface)), surface);
  });

  test("a single-material dry tile packs to heights plus a header", () => {
    const surface = createTileSurface();
    surface.heights.fill(100);
    surface.topBlocks.fill(BlockType.GRASS);
    surface.sideBlocks.fill(BlockType.DIRT);
    const packed = packTileSurface(surface);
    expect(packed.byteLength).toBeLessThan(TILE_CELL_COUNT + 32);
    expectSameSurface(unpackTileSurface(packed), surface);
  });
});

describe("downsampling children into a parent", () => {
  test("each parent cell takes the mean height, majority blocks and shared water of its four children", () => {
    const parentAddress = { level: 4, tileX: 0, tileZ: 0 };
    const parent = createTileSurface();
    const children = childAddressesOf(parentAddress).map(createSyntheticTileSurface);
    children.forEach((child, childIndex) => downsampleChildIntoParent(child, parent, childIndex & 1, childIndex >> 1));

    const half = TILE_CELLS / 2;
    let checkedCells = 0;
    for (let parentZ = 0; parentZ < TILE_CELLS; parentZ++) {
      for (let parentX = 0; parentX < TILE_CELLS; parentX++) {
        const child = children[(parentX >= half ? 1 : 0) + (parentZ >= half ? 2 : 0)]!;
        const childX = (parentX % half) * 2;
        const childZ = (parentZ % half) * 2;
        const indices = [cellIndexOf(childX, childZ), cellIndexOf(childX + 1, childZ), cellIndexOf(childX, childZ + 1), cellIndexOf(childX + 1, childZ + 1)];
        const heights = indices.map((index) => child.heights[index]!);
        const parentIndex = cellIndexOf(parentX, parentZ);
        expect(parent.heights[parentIndex]).toBe(Math.round(heights.reduce((sum, height) => sum + height, 0) / 4));
        expect(parent.heights[parentIndex]).toBeGreaterThanOrEqual(Math.min(...heights));
        expect(parent.heights[parentIndex]).toBeLessThanOrEqual(Math.max(...heights));
        const childTops = indices.map((index) => child.topBlocks[index]!);
        expect(childTops).toContain(parent.topBlocks[parentIndex]!);
        const wetChildren = indices.filter((index) => child.waterLevels[index] !== NO_WATER).length;
        if (wetChildren === 4) expect(parent.waterLevels[parentIndex]).toBe(LOD_SEA_LEVEL);
        if (wetChildren <= 1) expect(parent.waterLevels[parentIndex]).toBe(NO_WATER);
        checkedCells++;
      }
    }
    expect(checkedCells).toBe(TILE_CELL_COUNT);
    const wetParentCells = parent.waterLevels.filter((level) => level !== NO_WATER).length;
    expect(wetParentCells).toBeGreaterThan(0);
  });
});
