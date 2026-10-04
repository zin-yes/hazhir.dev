import { describe, expect, test } from "bun:test";
import { BlockType } from "../../blocks";
import { GAME_Y_OFFSET } from "../../worldgen/constants";
import { getTerrainOnlyGenerator } from "../../worldgen/overworld-world";
import { LOD_SEA_LEVEL, NO_WATER, TILE_CELL_COUNT, TILE_CELLS } from "../core/lod-constants";
import { parentAddressOf } from "../core/tile-address";
import { cellIndexOf, createTileSurface } from "../data/tile-surface";
import { getSeedWorldgenContext } from "./seed-worldgen-context";
import { WorldgenTileSampler } from "./worldgen-tile-sampler";

const SEED = 1337;
const sampler = new WorldgenTileSampler(getSeedWorldgenContext(SEED));

function timed<Result>(label: string, work: () => Result): Result {
  const startedAt = performance.now();
  const result = work();
  console.log(`${label}: ${(performance.now() - startedAt).toFixed(1)} ms`);
  return result;
}

describe("worldgen tile sampler", () => {
  test("level-0 heights match the engine's noise fill block for block", () => {
    const address = { level: 0, tileX: -20, tileZ: 11 };
    const { surface } = timed("sample level-0 tile", () => sampler.sample(address));
    const generator = getTerrainOnlyGenerator(SEED);
    let exactCells = 0;
    let comparedCells = 0;
    let largestError = 0;
    for (let cellZ = 0; cellZ < TILE_CELLS; cellZ += 5) {
      for (let cellX = 0; cellX < TILE_CELLS; cellX += 5) {
        const realTopFace = generator.surfaceHeight(address.tileX * 32 + cellX, address.tileZ * 32 + cellZ, "OCEAN_FLOOR_WG") + GAME_Y_OFFSET;
        const error = Math.abs(surface.heights[cellIndexOf(cellX, cellZ)]! - realTopFace);
        largestError = Math.max(largestError, error);
        if (error === 0) exactCells++;
        comparedCells++;
      }
    }
    expect(comparedCells).toBe(49);
    expect(exactCells / comparedCells).toBeGreaterThanOrEqual(0.95);
    expect(largestError).toBeLessThanOrEqual(4);
  });

  test("a coarse ocean tile has sea water above every submerged cell and solid tops everywhere", () => {
    const { surface, statistics } = timed("sample level-6 tile", () => sampler.sample({ level: 6, tileX: 1, tileZ: -1 }));
    let submergedCells = 0;
    let dryCells = 0;
    for (let index = 0; index < TILE_CELL_COUNT; index++) {
      expect(surface.topBlocks[index]).not.toBe(BlockType.AIR);
      const height = surface.heights[index]!;
      const water = surface.waterLevels[index]!;
      if (height < LOD_SEA_LEVEL) {
        submergedCells++;
        expect(water).toBe(LOD_SEA_LEVEL);
      } else {
        dryCells++;
        expect(water === NO_WATER || surface.topBlocks[index] === BlockType.ICE).toBe(true);
      }
    }
    expect(submergedCells).toBeGreaterThan(20);
    expect(dryCells).toBeGreaterThan(20);
    expect(statistics.sampledCells).toBe(TILE_CELL_COUNT);
    expect(statistics.densityEvaluations / TILE_CELL_COUNT).toBeLessThan(12);
  });

  test("a parent hint only seeds the search: refined heights equal a cold sample", () => {
    const address = { level: 3, tileX: 6, tileZ: -9 };
    const parent = parentAddressOf(address);
    const parentSurface = sampler.sample(parent).surface;
    const cold = timed("cold level-3 tile", () => sampler.sample(address));
    const hinted = timed("hinted level-3 tile", () => sampler.sample(address, { address: parent, surface: parentSurface }));
    let differingCells = 0;
    for (let index = 0; index < TILE_CELL_COUNT; index++) if (cold.surface.heights[index] !== hinted.surface.heights[index]) differingCells++;
    expect(differingCells).toBeLessThanOrEqual(TILE_CELL_COUNT * 0.01);
    expect(hinted.statistics.densityEvaluations).toBeLessThan(cold.statistics.densityEvaluations);
  });

  test("cells covered by real data are copied from the overlay and not sampled", () => {
    const address = { level: 0, tileX: 7, tileZ: 7 };
    const overlaySurface = createTileSurface();
    const coveredCells = new Uint8Array(TILE_CELL_COUNT);
    for (let cellZ = 0; cellZ < TILE_CELLS; cellZ++) {
      for (let cellX = 0; cellX < 12; cellX++) {
        const index = cellIndexOf(cellX, cellZ);
        coveredCells[index] = 1;
        overlaySurface.heights[index] = 150 + cellX;
        overlaySurface.topBlocks[index] = BlockType.LEAVES;
        overlaySurface.sideBlocks[index] = BlockType.LEAVES;
        overlaySurface.waterLevels[index] = NO_WATER;
      }
    }
    const { surface, statistics } = sampler.sample(address, undefined, { surface: overlaySurface, coveredCells });
    expect(statistics.overlayCells).toBe(12 * TILE_CELLS);
    expect(statistics.sampledCells).toBe(20 * TILE_CELLS);
    for (let cellZ = 0; cellZ < TILE_CELLS; cellZ++) {
      expect(surface.heights[cellIndexOf(3, cellZ)]).toBe(153);
      expect(surface.topBlocks[cellIndexOf(3, cellZ)]).toBe(BlockType.LEAVES);
      expect(surface.topBlocks[cellIndexOf(20, cellZ)]).not.toBe(BlockType.LEAVES);
    }
  });

  test("sampling is deterministic across sampler instances", () => {
    const address = { level: 5, tileX: -3, tileZ: 2 };
    const first = sampler.sample(address).surface;
    const second = new WorldgenTileSampler(getSeedWorldgenContext(SEED)).sample(address).surface;
    expect(Buffer.from(second.heights.buffer).equals(Buffer.from(first.heights.buffer))).toBe(true);
    expect(Buffer.from(second.topBlocks.buffer).equals(Buffer.from(first.topBlocks.buffer))).toBe(true);
    expect(Buffer.from(second.waterLevels.buffer).equals(Buffer.from(first.waterLevels.buffer))).toBe(true);
  });
});
