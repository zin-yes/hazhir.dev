// The biome store samples climate with compiled plain density functions instead of each chunk's NoiseChunk caches.
// That is exact only if the cached climate sampler returns the plain functions' values at quart cells; this test
// checks that premise against the real NoiseChunk wiring over whole chunks.

import { afterAll, describe, expect, test } from "bun:test";
import { getTerrainOnlyGenerator } from "../../overworld-world";
import { createColumnMemoizedDensity } from "../density/column-memoization";
import { compileDensityFunction } from "../density/density-codegen";
import { quantizeClimateCoordinate } from "../density";
import { NoiseChunk } from "../terrain";

const CLIMATE_FIELDS = ["temperature", "vegetation", "continents", "erosion", "depth", "ridges"] as const;
const CHUNKS: Array<[number, number]> = [
  [0, 0],
  [-7, 3],
  [123, -88],
  [-300, -41],
];
const testStartedAtMs = performance.now();

describe("chunk climate samples", () => {
  test("compiled plain climate functions equal the NoiseChunk-cached sampler at every quart cell", () => {
    const startedAtMs = performance.now();
    const generator = getTerrainOnlyGenerator(20240607);
    const { router, settings } = generator;
    const compiled = CLIMATE_FIELDS.map((field) => compileDensityFunction(createColumnMemoizedDensity(router[field])));
    const distinctDepths = new Set<number>();
    let comparedCells = 0;
    for (const [chunkX, chunkZ] of CHUNKS) {
      const noiseChunk = new NoiseChunk(router, {
        cellCountXZ: 4,
        firstBlockX: chunkX * 16,
        firstBlockZ: chunkZ * 16,
        minY: settings.minY,
        height: settings.height,
        wiredRouterFields: CLIMATE_FIELDS,
      });
      const context = { blockX: 0, blockY: 0, blockZ: 0 };
      for (let quartY = settings.minY >> 2; quartY < (settings.minY + settings.height) >> 2; quartY++) {
        for (let localQuartZ = 0; localQuartZ < 4; localQuartZ++) {
          for (let localQuartX = 0; localQuartX < 4; localQuartX++) {
            context.blockX = (chunkX * 4 + localQuartX) << 2;
            context.blockY = quartY << 2;
            context.blockZ = (chunkZ * 4 + localQuartZ) << 2;
            CLIMATE_FIELDS.forEach((field, fieldIndex) => {
              const expected = quantizeClimateCoordinate(noiseChunk.router[field]!.compute(context));
              const actual = quantizeClimateCoordinate(compiled[fieldIndex]!(context.blockX, context.blockY, context.blockZ));
              if (actual !== expected) throw new Error(`${field} differs at ${context.blockX},${context.blockY},${context.blockZ}`);
              if (field === "depth") distinctDepths.add(expected);
            });
            comparedCells++;
          }
        }
      }
    }
    expect(comparedCells).toBe(CHUNKS.length * 16 * (settings.height >> 2));
    expect(distinctDepths.size).toBeGreaterThan(100);
    console.log(`chunk climate comparison took ${(performance.now() - startedAtMs).toFixed(0)} ms`);
  }, 120_000);
});

afterAll(() => {
  console.log(`chunk-climate-samples.test.ts took ${(performance.now() - testStartedAtMs).toFixed(0)} ms`);
});
