import { describe, expect, test } from "bun:test";
import { createClimateSampler, createNoiseRouter, SinglePointContext, StripMarkersVisitor } from "../../worldgen/engine/density";
import { loadTerralithRegistries } from "../../worldgen/terralith/load-terralith-registries";
import { OVERWORLD_NOISE_SETTINGS_ID } from "../../worldgen/terralith/constants";
import { createColumnCachedRouter } from "./column-cached-density";

const { registries } = loadTerralithRegistries();
const router = createNoiseRouter({ registries, noiseSettingsId: OVERWORLD_NOISE_SETTINGS_ID, seed: BigInt(4242) });

describe("column-cached router", () => {
  test("climate samples equal the engine's Climate.Sampler while density searches move between columns", () => {
    const startedAt = performance.now();
    const cached = createColumnCachedRouter(router);
    const reference = createClimateSampler(router);
    let compared = 0;
    for (let sampleIndex = 0; sampleIndex < 60; sampleIndex++) {
      const quartX = sampleIndex * 37 - 900;
      const quartZ = sampleIndex * -53 + 400;
      for (let blockY = 40; blockY < 90; blockY += 7) cached.density.at(quartX << 2, blockY, quartZ << 2);
      const quartY = 10 + (sampleIndex % 20);
      expect(cached.climate.sample(quartX, quartY, quartZ)).toEqual(reference.sample(quartX, quartY, quartZ));
      compared++;
    }
    expect(compared).toBe(60);
    console.log(`climate comparison ${(performance.now() - startedAt).toFixed(1)} ms`);
  });

  test("final density on lattice points equals the marker-stripped density up to the flat cache's quart alignment", () => {
    const cached = createColumnCachedRouter(router);
    const stripped = new StripMarkersVisitor().map(router.finalDensity);
    let largestDifference = 0;
    for (let columnIndex = 0; columnIndex < 40; columnIndex++) {
      const blockX = columnIndex * 64 - 1200;
      const blockZ = columnIndex * 28 + 300;
      for (let blockY = 32; blockY <= 128; blockY += 4) {
        const difference = Math.abs(cached.density.at(blockX, blockY, blockZ) - stripped.compute(new SinglePointContext(blockX, blockY, blockZ)));
        largestDifference = Math.max(largestDifference, difference);
      }
    }
    expect(largestDifference).toBeLessThan(1e-9);
    expect(cached.density.evaluations).toBe(40 * 25);
  });
});
