import { afterAll, describe, expect, test } from "bun:test";
import { createRootRandomFactory } from "./noise-registry";
import { NormalNoise } from "./normal-noise";

const testStartedAtMs = performance.now();

describe("NormalNoise", () => {
  test("the generated sampler gives the same doubles as getValue", () => {
    const startedAtMs = performance.now();
    const root = createRootRandomFactory(BigInt(20240607));
    const parameterSets = [
      { firstOctave: -7, amplitudes: [0.4, 0.5, 1] },
      { firstOctave: -9, amplitudes: [1.5, 0, 1, 0, 0, 0] },
      { firstOctave: -8, amplitudes: [1] },
      { firstOctave: -3, amplitudes: [1, 1, 1, 0] },
    ];
    let state = 4242;
    const nextCoordinate = (range: number) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return (state / 4294967296 - 0.5) * range;
    };
    const distinctValues = new Set<number>();
    parameterSets.forEach((parameters, index) => {
      const noise = NormalNoise.create(root.fromHashOf(`test_noise_${index}`), parameters);
      const compiled = noise.compiledGetValue();
      for (let sample = 0; sample < 3000; sample++) {
        // Mix integer block positions, fractional positions and coordinates large enough to need wrapping.
        const scale = sample % 3 === 0 ? 1 : sample % 3 === 1 ? 0.37 : 4.0e7;
        const x = sample % 3 === 0 ? Math.round(nextCoordinate(60000)) : nextCoordinate(60000) * scale;
        const y = nextCoordinate(800);
        const z = sample % 3 === 0 ? Math.round(nextCoordinate(60000)) : nextCoordinate(60000) * scale;
        const expected = noise.getValue(x, y, z);
        const actual = compiled(x, y, z);
        if (!Object.is(actual, expected)) throw new Error(`Mismatch for noise ${index} at ${x},${y},${z}: ${actual} vs ${expected}`);
        distinctValues.add(expected);
      }
    });
    expect(distinctValues.size).toBeGreaterThan(10000);
    console.log(`normal noise comparison took ${(performance.now() - startedAtMs).toFixed(0)} ms`);
  });
});

afterAll(() => {
  console.log(`normal-noise.test.ts took ${(performance.now() - testStartedAtMs).toFixed(0)} ms`);
});
