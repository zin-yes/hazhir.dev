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

describe("SandGrid.resized", () => {
  function buildPile() {
    const grid = new SandGrid(40, 60, palette);
    for (let batch = 0; batch < 40; batch++) {
      grid.spawnGrains(40);
      grid.step();
    }
    settle(grid);
    return grid;
  }

  test("growing keeps every grain, anchored to the bottom", () => {
    const grid = buildPile();
    const resized = SandGrid.resized(grid, 70, 90, palette);
    expect(resized.grainCount).toBe(grid.grainCount);
    expect(countFilledCells(resized)).toBe(grid.grainCount);
    const lowestGrainRowBefore = grid.rows - 1;
    const lowestGrainRowAfter = resized.rows - 1;
    for (let column = 0; column < grid.columns; column++) {
      expect(resized.cells[lowestGrainRowAfter * resized.columns + column]).toBe(
        grid.cells[lowestGrainRowBefore * grid.columns + column],
      );
    }
  });

  test("shrinking drops only what no longer fits and keeps the count honest", () => {
    const grid = buildPile();
    const resized = SandGrid.resized(grid, 25, 20, palette);
    expect(resized.grainCount).toBe(countFilledCells(resized));
    expect(resized.grainCount).toBeGreaterThan(0);
    expect(resized.grainCount).toBeLessThan(grid.grainCount);
  });

  test("a lone grain falls one row per step and reports each fall", () => {
    const grid = new SandGrid(5, 10, palette);
    expect(grid.spawnGrains(1)).toBe(1);
    let totalFalls = 0;
    let totalSlides = 0;
    for (let step = 0; step < 20; step++) {
      grid.step();
      totalFalls += grid.fallsInLastStep;
      totalSlides += grid.slidesInLastStep;
    }
    expect(totalFalls).toBe(grid.rows - 1);
    expect(totalSlides).toBe(0);
  });

  test("a grain on top of a column slides sideways and reports the slide", () => {
    const grid = new SandGrid(3, 3, palette);
    const bottomMiddle = 2 * 3 + 1;
    const aboveBottomMiddle = 1 * 3 + 1;
    grid.cells[bottomMiddle] = 0xff0000ff;
    grid.cells[aboveBottomMiddle] = 0xff00ff00;
    grid.grainCount = 2;
    grid.step();
    expect(grid.slidesInLastStep).toBe(1);
    expect(grid.fallsInLastStep).toBe(0);
  });

  test("spawning into an occupied top row only places grains that fit", () => {
    const grid = new SandGrid(1, 8, palette);
    expect(grid.spawnGrains(5)).toBe(1);
    expect(grid.grainCount).toBe(1);
  });
});
