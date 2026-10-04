// The noises placement modifiers and block state providers sample, against values from the real classes:
// Biome.BIOME_INFO_NOISE (noise_based_count, noise_threshold_count) and NormalNoise over a legacy WorldgenRandom
// (noise_provider, noise_threshold_provider, dual_noise_provider).

import { afterAll, expect, test } from "bun:test";
import { getBiomeInfoNoise } from "../placement/vanilla-placement-modifiers";
import { loadFeaturesReference } from "../testing/feature-fixtures.node";
import { createLegacySeededNoise } from "./block-state-providers";

const startedAt = performance.now();
const reference = loadFeaturesReference();

test("BIOME_INFO_NOISE samples", () => {
  expect(reference.biomeInfoNoise.length).toBeGreaterThan(20);
  for (const [x, z, factor, expected] of reference.biomeInfoNoise) expect(getBiomeInfoNoise().getValue(x / factor, z / factor, false)).toBe(expected);
});

test("NormalNoise seeded from a legacy WorldgenRandom", () => {
  const fourOctaves = createLegacySeededNoise(BigInt(2345), { firstOctave: -3, amplitudes: [1, 1, 1, 1] });
  const largeSeed = createLegacySeededNoise(BigInt("-4851265873398046345"), { firstOctave: -1, amplitudes: [1] });
  for (const [x, y, z, expectedFirst, expectedSecond] of reference.legacyNormalNoise) {
    expect(fourOctaves.getValue(x * 0.005, y * 0.005, z * 0.005)).toBe(expectedFirst);
    expect(largeSeed.getValue(x * 0.02, y * 0.02, z * 0.02)).toBe(expectedSecond);
  }
});

afterAll(() => console.log(`noise source tests: ${(performance.now() - startedAt).toFixed(0)} ms`));
