import { describe, expect, test } from "bun:test";
import { BlockType } from "./blocks";
import { findWaterSurfaceHeight } from "./camera-water-surface";

/** A lake column: stone floor at y 60, `depth` cells of water above it, the given block on top of the water. */
function lakeColumn(waterDepth: number, topBlock: BlockType = BlockType.WATER) {
  return (x: number, y: number, z: number): BlockType | null => {
    if (x !== 10 || z !== -4) return BlockType.AIR;
    if (y <= 60) return BlockType.STONE;
    if (y < 61 + waterDepth - 1) return BlockType.WATER;
    if (y === 61 + waterDepth - 1) return topBlock;
    return BlockType.AIR;
  };
}

describe("findWaterSurfaceHeight", () => {
  test("finds the top of a deep full block column from the middle of the water", () => {
    const surface = findWaterSurfaceHeight(lakeColumn(6), { x: 10.2, y: 63.4, z: -3.8 });
    expect(surface).toBeCloseTo(66 - 0.5 + 14 / 16, 5);
  });

  test("follows a partial top block down to the height the mesher draws", () => {
    const surface = findWaterSurfaceHeight(lakeColumn(3, BlockType.WATER_LEVEL_4), { x: 10, y: 61.2, z: -4 });
    expect(surface).toBeCloseTo(63 - 0.5 + 7 / 16, 5);
  });

  test("still sees the surface when the eye is in the air cell just above the water", () => {
    const surface = findWaterSurfaceHeight(lakeColumn(2), { x: 10, y: 63.1, z: -4 });
    expect(surface).toBeCloseTo(62 - 0.5 + 14 / 16, 5);
  });

  test("reports no surface over stone or high in the air", () => {
    expect(findWaterSurfaceHeight(lakeColumn(2), { x: 10, y: 50, z: -4 })).toBeNull();
    expect(findWaterSurfaceHeight(lakeColumn(2), { x: 10, y: 70, z: -4 })).toBeNull();
    expect(findWaterSurfaceHeight(lakeColumn(2), { x: 11, y: 61, z: -4 })).toBeNull();
  });

  test("gives up on a column of unloaded chunks instead of guessing", () => {
    expect(findWaterSurfaceHeight(() => null, { x: 0, y: 70, z: 0 })).toBeNull();
  });
});
