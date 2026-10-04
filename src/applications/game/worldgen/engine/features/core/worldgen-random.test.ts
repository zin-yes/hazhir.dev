// WorldgenRandom decoration/feature seeding against values recorded from the real classes for seed 1337,
// chunk (3, -7) and feature indices 0 / 5 / 200 in every generation step.

import { afterAll, expect, test } from "bun:test";
import { LegacyRandomSource } from "../../random";
import { loadFeaturesReference } from "../testing/feature-fixtures.node";
import { createDecorationRandom, WorldgenRandom } from "./worldgen-random";

const startedAt = performance.now();
const { seeding } = loadFeaturesReference();

/** Replays the recorded sequence (the Java harness used one WorldgenRandom for all of it, in this order). */
function replayFeatureSeeds(random: WorldgenRandom, decorationSeed: bigint, check: boolean): void {
  for (const recorded of seeding.featureSeeds) {
    random.setFeatureSeed(decorationSeed, recorded.featureIndex, recorded.step);
    const draws = {
      nextLong: random.nextLong().toString(),
      nextInt16a: random.nextIntBounded(16),
      nextInt16b: random.nextIntBounded(16),
      nextFloat: random.nextFloat(),
      nextDouble: random.nextDouble(),
      nextBoolean: random.nextBoolean(),
      nextInt: random.nextInt(),
      nextInt5: random.nextIntBounded(5),
      nextInt1000: random.nextIntBounded(1000),
      nextGaussian: random.nextGaussian(),
    };
    if (!check) continue;
    // Gson printed the Java float with Float.toString, so compare against its float32 value.
    const { step, featureIndex, ...expected } = { ...recorded, nextFloat: Math.fround(recorded.nextFloat) };
    expect({ step, featureIndex, ...draws }).toEqual({ step, featureIndex, ...expected });
  }
}

test("setDecorationSeed and setFeatureSeed reproduce applyBiomeDecoration's seeds and draws", () => {
  const random = createDecorationRandom();
  const decorationSeed = random.setDecorationSeed(BigInt(seeding.worldSeed), seeding.minBlockX, seeding.minBlockZ);
  expect(decorationSeed.toString()).toBe(seeding.decorationSeed);
  expect(seeding.featureSeeds.length).toBe(33);
  replayFeatureSeeds(random, decorationSeed, true);
});

test("the Gaussian cache survives reseeding and fork delegates to the wrapped Xoroshiro source", () => {
  const random = createDecorationRandom();
  const decorationSeed = random.setDecorationSeed(BigInt(seeding.worldSeed), seeding.minBlockX, seeding.minBlockZ);
  replayFeatureSeeds(random, decorationSeed, false);
  // The replay ended on a nextGaussian, so this first value is the cached second half of that pair.
  random.setFeatureSeed(decorationSeed, 1, 9);
  expect(random.nextGaussian()).toBe(seeding.gaussianLeak.first);
  random.setFeatureSeed(decorationSeed, 2, 9);
  expect(random.nextGaussian()).toBe(seeding.gaussianLeak.afterReseed);
  expect(random.nextGaussian()).toBe(seeding.gaussianLeak.next);
  random.setFeatureSeed(decorationSeed, 3, 9);
  expect(random.fork().nextLong().toString()).toBe(seeding.forkNextLong);
});

test("over a LegacyRandomSource it draws exactly like the legacy source", () => {
  const wrapped = new WorldgenRandom(new LegacyRandomSource(BigInt(2345)));
  const plain = new LegacyRandomSource(BigInt(2345));
  for (let index = 0; index < 50; index++) {
    expect(wrapped.nextIntBounded(37)).toBe(plain.nextIntBounded(37));
    expect(wrapped.nextDouble()).toBe(plain.nextDouble());
  }
  expect(wrapped.count).toBe(150);
});

afterAll(() => console.log(`worldgen-random tests: ${(performance.now() - startedAt).toFixed(0)} ms`));
