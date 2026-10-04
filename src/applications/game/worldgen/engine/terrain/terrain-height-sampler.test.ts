import { afterAll, describe, expect, test } from "bun:test";
import { getTerrainHeightSampler, getTerrainOnlyGenerator } from "../../overworld-world";

const SEEDS = [20240607, 777];
const SAMPLES_PER_SEED = 120;
const SAMPLE_SPREAD_BLOCKS = 6000;
const testStartedAtMs = performance.now();

/** Deterministic positions spread over oceans, mountains and plains, including negative and cell-edge coordinates. */
function samplePositions(seed: number): Array<[number, number]> {
  const positions: Array<[number, number]> = [];
  let state = seed >>> 0;
  const nextUnit = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let index = 0; index < SAMPLES_PER_SEED; index++) {
    positions.push([Math.floor((nextUnit() - 0.5) * SAMPLE_SPREAD_BLOCKS), Math.floor((nextUnit() - 0.5) * SAMPLE_SPREAD_BLOCKS)]);
  }
  positions.push([0, 0], [-1, -1], [3, 4], [-4, 15], [16, -17]);
  return positions;
}

describe("terrain height sampler", () => {
  for (const seed of SEEDS) {
    test(`matches the filled terrain-only columns for seed ${seed}`, () => {
      const startedAtMs = performance.now();
      const sampler = getTerrainHeightSampler(seed);
      expect(sampler).not.toBeNull();
      const generator = getTerrainOnlyGenerator(seed);
      const heights = new Set<number>();
      for (const [blockX, blockZ] of samplePositions(seed)) {
        const oceanFloor = sampler!.oceanFloorHeight(blockX, blockZ);
        expect(oceanFloor).toBe(generator.surfaceHeight(blockX, blockZ, "OCEAN_FLOOR_WG"));
        expect(sampler!.worldSurfaceHeight(blockX, blockZ)).toBe(generator.surfaceHeight(blockX, blockZ, "WORLD_SURFACE_WG"));
        heights.add(oceanFloor);
      }
      // Real terrain varies: oceans, lowlands and mountains give many distinct heights.
      expect(heights.size).toBeGreaterThanOrEqual(30);
      console.log(`terrain height sampler seed ${seed} took ${(performance.now() - startedAtMs).toFixed(0)} ms`);
    }, 120_000);
  }
});

afterAll(() => {
  console.log(`terrain-height-sampler.test.ts took ${(performance.now() - testStartedAtMs).toFixed(0)} ms`);
});
