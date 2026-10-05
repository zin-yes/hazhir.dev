import { describe, expect, test } from "bun:test";
import { sampleHumidityGrid } from "./humidity-grid";

const SEED = 20240611;
const CELL_SIZE_BLOCKS = 64;
const GRID_CELLS = 24;
const DISTANT_AREA_ORIGINS_IN_BLOCKS: Array<[number, number]> = [
  [0, 0],
  [-40960, 12288],
  [65536, -81920],
];

function rangeOf(bytes: Uint8Array): { minimum: number; maximum: number } {
  return { minimum: Math.min(...bytes), maximum: Math.max(...bytes) };
}

describe("sampleHumidityGrid with the real terrain generator", () => {
  test("returns one byte per cell and varies across a multi-kilometer area", () => {
    for (const [originBlockX, originBlockZ] of DISTANT_AREA_ORIGINS_IN_BLOCKS) {
      const humidityBytes = sampleHumidityGrid(SEED, originBlockX, originBlockZ, CELL_SIZE_BLOCKS, GRID_CELLS);
      expect(humidityBytes.length).toBe(GRID_CELLS * GRID_CELLS);
      const { minimum, maximum } = rangeOf(humidityBytes);
      expect(maximum - minimum).toBeGreaterThan(30);
    }
  });

  test("covers a wide range of biome wetness over the combined areas", () => {
    const combinedRange = rangeOf(
      Uint8Array.from(
        DISTANT_AREA_ORIGINS_IN_BLOCKS.flatMap(([originBlockX, originBlockZ]) => [
          ...sampleHumidityGrid(SEED, originBlockX, originBlockZ, CELL_SIZE_BLOCKS, GRID_CELLS),
        ]),
      ),
    );
    expect(combinedRange.maximum - combinedRange.minimum).toBeGreaterThan(100);
  });

  test("grids offset by whole cells agree exactly on their overlap", () => {
    const offsetCellsX = 7;
    const offsetCellsZ = -5;
    const baseGrid = sampleHumidityGrid(SEED, -9600, 4800, CELL_SIZE_BLOCKS, GRID_CELLS);
    const shiftedGrid = sampleHumidityGrid(
      SEED,
      -9600 + offsetCellsX * CELL_SIZE_BLOCKS,
      4800 + offsetCellsZ * CELL_SIZE_BLOCKS,
      CELL_SIZE_BLOCKS,
      GRID_CELLS,
    );
    let comparedCellCount = 0;
    for (let shiftedCellZ = 0; shiftedCellZ < GRID_CELLS; shiftedCellZ++) {
      for (let shiftedCellX = 0; shiftedCellX < GRID_CELLS; shiftedCellX++) {
        const baseCellX = shiftedCellX + offsetCellsX;
        const baseCellZ = shiftedCellZ + offsetCellsZ;
        if (baseCellX < 0 || baseCellX >= GRID_CELLS || baseCellZ < 0 || baseCellZ >= GRID_CELLS) continue;
        comparedCellCount++;
        expect(shiftedGrid[shiftedCellZ * GRID_CELLS + shiftedCellX]).toBe(baseGrid[baseCellZ * GRID_CELLS + baseCellX]!);
      }
    }
    expect(comparedCellCount).toBeGreaterThan(200);
  });
});
