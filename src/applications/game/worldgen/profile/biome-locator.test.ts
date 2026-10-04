import { describe, expect, test } from "bun:test";
import { getTerrainOnlyGenerator } from "../overworld-world";
import { locateBiomes } from "./biome-locator";

const SEED = 2024;
const COARSE_SCAN = { seed: SEED, radiusBlocks: 4000, stepBlocks: 256, representativesPerBiome: 3 };

describe("biome locator", () => {
  const located = locateBiomes(COARSE_SCAN);

  test("finds many distinct biomes with coverage that accounts for every sample", () => {
    expect(located.biomes.length).toBeGreaterThanOrEqual(15);
    expect(new Set(located.biomes.map((coverage) => coverage.biome)).size).toBe(located.biomes.length);
    const summedSamples = located.biomes.reduce((sum, coverage) => sum + coverage.sampleCount, 0);
    expect(summedSamples).toBe(located.totalSamples);
    const summedShare = located.biomes.reduce((sum, coverage) => sum + coverage.coverageShare, 0);
    expect(summedShare).toBeCloseTo(1, 6);
  });

  test("representatives really lie in their biome and are separated", () => {
    const generator = getTerrainOnlyGenerator(SEED);
    const multiRepresentativeBiomes = located.biomes.filter((coverage) => coverage.representatives.length > 1);
    expect(multiRepresentativeBiomes.length).toBeGreaterThanOrEqual(3);
    for (const coverage of located.biomes) {
      expect(coverage.representatives.length).toBeGreaterThanOrEqual(1);
      expect(coverage.representatives.length).toBeLessThanOrEqual(3);
      for (const representative of coverage.representatives) {
        expect(generator.biomeAt(representative.blockX, 70, representative.blockZ)).toBe(coverage.biome);
        expect(Math.floor(representative.blockX / 32)).toBe(representative.gameChunkX);
      }
    }
    for (const coverage of multiRepresentativeBiomes) {
      const [first, second] = coverage.representatives;
      expect(Math.hypot(first!.blockX - second!.blockX, first!.blockZ - second!.blockZ)).toBeGreaterThan(0);
    }
  });

  test("is deterministic for a seed and differs between seeds", () => {
    expect(locateBiomes(COARSE_SCAN)).toEqual(located);
    const otherSeedLocated = locateBiomes({ ...COARSE_SCAN, seed: SEED + 1 });
    expect(otherSeedLocated.biomes.map((coverage) => coverage.representatives[0])).not.toEqual(
      located.biomes.map((coverage) => coverage.representatives[0]),
    );
  });

  test("lists biomes the scan never sampled as missing", () => {
    const foundBiomes = new Set(located.biomes.map((coverage) => coverage.biome));
    expect(located.missingBiomes.length).toBeGreaterThanOrEqual(1);
    for (const missingBiome of located.missingBiomes) expect(foundBiomes.has(missingBiome)).toBe(false);
  });
});
