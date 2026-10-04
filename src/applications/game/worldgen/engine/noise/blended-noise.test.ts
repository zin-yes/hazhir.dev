import { afterAll, describe, expect, test } from "bun:test";
import { BlendedNoise } from "./blended-noise";
import { createRootRandomFactory } from "./noise-registry";

const testStartedAtMs = performance.now();

describe("BlendedNoise", () => {
  test("the unrolled compute gives the same doubles as the octave loops", () => {
    const startedAtMs = performance.now();
    const noise = new BlendedNoise(createRootRandomFactory(BigInt(20240607)).fromHashOf("minecraft:terrain"), 0.25, 0.125, 80, 160, 8);
    const distinctValues = new Set<number>();
    let state = 99;
    const nextInteger = (range: number) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return Math.floor((state / 4294967296 - 0.5) * range);
    };
    for (let index = 0; index < 4000; index++) {
      const blockX = nextInteger(200000);
      const blockY = nextInteger(400) + 128;
      const blockZ = nextInteger(200000);
      const expected = noise.computeInterpreted(blockX, blockY, blockZ);
      const actual = noise.compute(blockX, blockY, blockZ);
      if (!Object.is(actual, expected)) throw new Error(`Mismatch at ${blockX},${blockY},${blockZ}: ${actual} vs ${expected}`);
      distinctValues.add(expected);
    }
    expect(distinctValues.size).toBeGreaterThan(3000);
    console.log(`blended noise comparison took ${(performance.now() - startedAtMs).toFixed(0)} ms`);
  });
});

afterAll(() => {
  console.log(`blended-noise.test.ts took ${(performance.now() - testStartedAtMs).toFixed(0)} ms`);
});
