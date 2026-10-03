import { describe, expect, test } from "bun:test";
import type { GrainPalette } from "./grain-palette";
import { SandGrid } from "./sand-grid";

const palette: GrainPalette = {
  texturePixels: [Uint32Array.from([0xff112233, 0xff445566, 0xff778899])],
};

function countFilledCells(grid: SandGrid) {
  return grid.cells.reduce((total, cell) => total + (cell === 0 ? 0 : 1), 0);
}

function settle(grid: SandGrid) {
  for (let step = 0; step < grid.rows * 3; step++) grid.step();
}

describe("SandGrid", () => {
  test("stepping never creates or destroys grains", () => {
    const grid = new SandGrid(40, 60, palette);
    grid.spawnGrains(400);
    const grainsBefore = grid.grainCount;
    settle(grid);
    expect(countFilledCells(grid)).toBe(grainsBefore);
    expect(grid.grainCount).toBe(grainsBefore);
  });

  test("grains pile at the bottom and none are left hanging in the air", () => {
    const grid = new SandGrid(40, 60, palette);
    for (let batch = 0; batch < 30; batch++) {
      grid.spawnGrains(40);
      grid.step();
    }
    settle(grid);
    for (let row = 0; row < grid.rows - 1; row++) {
      for (let column = 0; column < grid.columns; column++) {
        const index = row * grid.columns + column;
        if (grid.cells[index] === 0) continue;
        const below = grid.cells[index + grid.columns] !== 0;
        const slideLeftOpen =
          column > 0 && grid.cells[index + grid.columns - 1] === 0;
        const slideRightOpen =
          column < grid.columns - 1 &&
          grid.cells[index + grid.columns + 1] === 0;
        expect(below || (!slideLeftOpen && !slideRightOpen)).toBe(true);
        expect(below || row === grid.rows - 1).toBe(true);
      }
    }
    const bottomRowFilled = grid.cells
      .slice((grid.rows - 1) * grid.columns)
      .filter((cell) => cell !== 0).length;
    expect(bottomRowFilled).toBeGreaterThan(grid.columns / 2);
  });

  test("grains only ever take colors from the supplied palette", () => {
    const grid = new SandGrid(30, 30, palette);
    grid.spawnGrains(200);
    settle(grid);
    const allowed = new Set(palette.texturePixels[0]);
    for (const cell of grid.cells) {
      if (cell !== 0) expect(allowed.has(cell)).toBe(true);
    }
  });

  test("draining removes a bottom grain and updates the count", () => {
    const grid = new SandGrid(10, 10, palette);
    grid.spawnGrains(200);
    settle(grid);
    const grainsBefore = grid.grainCount;
    for (let attempt = 0; attempt < 50; attempt++) grid.drainBottomGrain();
    expect(grid.grainCount).toBeLessThan(grainsBefore);
    expect(countFilledCells(grid)).toBe(grid.grainCount);
  });
});
