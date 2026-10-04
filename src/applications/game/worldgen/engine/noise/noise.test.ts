// Verifies the noise port bit-for-bit against values produced by the real Minecraft 1.20.6 server classes
// (fixtures/java-reference-vectors.json.gz, seed 1337, every noise in the merged vanilla + Terralith registry),
// then checks real-registry statistics and hot-path cost through NoiseRegistry.

import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadTerralithOnVanilla } from "../registry/datapack-loader";
import { LegacyRandomSource } from "../random/legacy-random-source";
import { XoroshiroRandomSource } from "../random/xoroshiro-random-source";
import { BlendedNoise } from "./blended-noise";
import { ImprovedNoise } from "./improved-noise";
import { createRootRandomFactory, NoiseRegistry } from "./noise-registry";
import { NormalNoise, type NoiseParameters } from "./normal-noise";
import { PerlinNoise } from "./perlin-noise";
import { PerlinSimplexNoise } from "./perlin-simplex-noise";
import { SimplexNoise } from "./simplex-noise";

const suiteStartedAt = performance.now();
const SCRATCH_DIRECTORY =
  "/private/tmp/claude-501/-Users-hazhir-code-zin-yes-hazhir-dev/72290beb-a2c3-4424-af2e-7aec7d1ca7d0/scratchpad";
const WORLD_SEED = BigInt(1337);

interface NoiseReferenceVectors {
  noisePoints: [number, number, number][];
  improvedNoise: { offsets: [number, number, number]; values: number[]; valuesWithYScale: number[] };
  perlinNoise: {
    newValues: number[];
    newMaxBroken: number;
    legacyValues: number[];
    legacyValuesWithYScale: number[];
    legacyValuesFixedY: number[];
  };
  normalNoiseSeed1337: Record<string, { maxValue: number; values: number[] }>;
  blendedNoiseSeed1337: {
    config: [number, number, number, number, number];
    maxValue: number;
    minValue: number;
    values: [number, number, number, number][];
  }[];
  simplexSeed1337: {
    values2D: number[];
    values3D: number[];
    perlinSimplexOctave0Seed1234: number[];
    perlinSimplexMixedSeed2345: number[];
  };
}

const reference: NoiseReferenceVectors = JSON.parse(
  new TextDecoder().decode(
    Bun.gunzipSync(new Uint8Array(await Bun.file(join(import.meta.dir, "fixtures/java-reference-vectors.json.gz")).arrayBuffer())),
  ),
);
const points = reference.noisePoints;

const datapacks = loadTerralithOnVanilla(join(SCRATCH_DIRECTORY, "mc/vanilla/data"), join(SCRATCH_DIRECTORY, "Terralith"));
const noiseParametersById = datapacks.registries.noise as unknown as Record<string, NoiseParameters>;

describe("ImprovedNoise matches Java", () => {
  const noise = new ImprovedNoise(new XoroshiroRandomSource(WORLD_SEED));

  test("offsets and values, plain and with the BlendedNoise y smear", () => {
    expect([noise.xOffset, noise.yOffset, noise.zOffset]).toEqual(reference.improvedNoise.offsets);
    expect(points.map(([x, y, z]) => noise.noise(x, y, z))).toEqual(reference.improvedNoise.values);
    expect(points.map(([x, y, z]) => noise.noiseWithYScale(x, y, z, 0.75, y * 0.5))).toEqual(
      reference.improvedNoise.valuesWithYScale,
    );
  });

  test("is (near) zero on lattice points and bounded elsewhere", () => {
    for (let cell = -3; cell <= 3; cell++) {
      const value = noise.noise(cell * 7 - noise.xOffset, cell * 3 - noise.yOffset, cell * 5 - noise.zOffset);
      expect(Math.abs(value)).toBeLessThan(1e-9);
    }
    for (let index = 0; index < 2000; index++) {
      expect(Math.abs(noise.noise(index * 0.37, index * -0.11, index * 0.73))).toBeLessThanOrEqual(1.04);
    }
  });
});

describe("PerlinNoise matches Java", () => {
  test("new initialization with a zero amplitude gap", () => {
    const perlin = PerlinNoise.create(new XoroshiroRandomSource(WORLD_SEED), -7, [1.0, 0.5, 0.0, 2.0]);
    expect(points.map(([x, y, z]) => perlin.getValue(x, y, z))).toEqual(reference.perlinNoise.newValues);
    expect(perlin.maxBrokenValue(3.0)).toBe(reference.perlinNoise.newMaxBroken);
  });

  test("legacy initialization skips 262 calls per missing octave", () => {
    const legacy = PerlinNoise.createLegacyForBlendedNoise(new LegacyRandomSource(WORLD_SEED), [-9, -6, -5, -1, 0]);
    expect(points.map(([x, y, z]) => legacy.getValue(x, y, z))).toEqual(reference.perlinNoise.legacyValues);
    expect(points.map(([x, y, z]) => legacy.getValueWithYScale(x, y, z, 0.3, y * 0.25, false))).toEqual(
      reference.perlinNoise.legacyValuesWithYScale,
    );
    expect(points.map(([x, y, z]) => legacy.getValueWithYScale(x, y, z, 0.0, 0.0, true))).toEqual(
      reference.perlinNoise.legacyValuesFixedY,
    );
  });
});

describe("NormalNoise matches Java for every noise in the vanilla + Terralith registry (seed 1337)", () => {
  const root = createRootRandomFactory(WORLD_SEED);

  test("registry under test is the same one the Java harness sampled", () => {
    expect(Object.keys(noiseParametersById).sort()).toEqual(Object.keys(reference.normalNoiseSeed1337).sort());
    expect(Object.keys(noiseParametersById).length).toBeGreaterThanOrEqual(150);
  });

  for (const noiseId of Object.keys(reference.normalNoiseSeed1337)) {
    test(noiseId, () => {
      const expected = reference.normalNoiseSeed1337[noiseId];
      const noise = NormalNoise.create(root.fromHashOf(noiseId), noiseParametersById[noiseId]);
      expect(noise.maxValue).toBe(expected.maxValue);
      expect(points.map(([x, y, z]) => noise.getValue(x, y, z))).toEqual(expected.values);
    });
  }
});

describe("BlendedNoise (old_blended_noise) matches Java with RandomState seeding", () => {
  const root = createRootRandomFactory(WORLD_SEED);
  for (const entry of reference.blendedNoiseSeed1337) {
    test(`config ${entry.config.join(", ")}`, () => {
      const [xzScale, yScale, xzFactor, yFactor, smearScaleMultiplier] = entry.config;
      const blended = new BlendedNoise(
        root.fromHashOf("minecraft:terrain"),
        xzScale,
        yScale,
        xzFactor,
        yFactor,
        smearScaleMultiplier,
      );
      expect([blended.minValue, blended.maxValue]).toEqual([entry.minValue, entry.maxValue]);
      expect(entry.values.map(([x, y, z]) => [x, y, z, blended.compute(x, y, z)])).toEqual(entry.values);
    });
  }
});

describe("SimplexNoise and PerlinSimplexNoise match Java", () => {
  test("end-islands style simplex (legacy seed 1337 after 17292 skipped calls)", () => {
    const random = new LegacyRandomSource(WORLD_SEED);
    random.skip(17292);
    const simplex = new SimplexNoise(random);
    expect(points.map(([x, , z]) => simplex.getValue2D(x, z))).toEqual(reference.simplexSeed1337.values2D);
    expect(points.map(([x, y, z]) => simplex.getValue3D(x, y, z))).toEqual(reference.simplexSeed1337.values3D);
  });

  test("Biome.TEMPERATURE_NOISE shape and a mixed positive/negative octave set", () => {
    const temperatureNoise = new PerlinSimplexNoise(new LegacyRandomSource(BigInt(1234)), [0]);
    const mixedNoise = new PerlinSimplexNoise(new LegacyRandomSource(BigInt(2345)), [-3, -1, 0, 1, 2]);
    expect(points.map(([x, , z]) => temperatureNoise.getValue(x / 8.0, z / 8.0, false))).toEqual(
      reference.simplexSeed1337.perlinSimplexOctave0Seed1234,
    );
    expect(points.map(([x, , z]) => mixedNoise.getValue(x, z, true))).toEqual(
      reference.simplexSeed1337.perlinSimplexMixedSeed2345,
    );
  });
});

describe("NoiseRegistry over the real Terralith registry", () => {
  const registry = new NoiseRegistry(noiseParametersById, createRootRandomFactory(WORLD_SEED));

  test("wires RandomState seeding (root.fromHashOf(id)) and caches instances", () => {
    const temperature = registry.get("minecraft:temperature");
    expect(registry.get("temperature")).toBe(temperature);
    expect(points.map(([x, y, z]) => temperature.getValue(x, y, z))).toEqual(
      reference.normalNoiseSeed1337["minecraft:temperature"].values,
    );
    expect(() => registry.get("minecraft:does_not_exist")).toThrow();
  });

  test("climate noises over a 256x256 quart grid are bounded and roughly centred", () => {
    const climateNoiseIds = [
      "minecraft:temperature",
      "minecraft:vegetation",
      "minecraft:continentalness",
      "minecraft:erosion",
      "minecraft:ridge",
    ];
    for (const noiseId of climateNoiseIds) {
      const noise = registry.get(noiseId);
      let sum = 0;
      let sumOfSquares = 0;
      let minimum = Infinity;
      let maximum = -Infinity;
      let sampleCount = 0;
      // Quart coordinates spread over ~16k blocks, sampled the way shifted_noise does (xz scaled by 0.25).
      for (let gridX = 0; gridX < 256; gridX++) {
        for (let gridZ = 0; gridZ < 256; gridZ++) {
          const value = noise.getValue(gridX * 16 * 0.25, 0, gridZ * 16 * 0.25 - 2000);
          sum += value;
          sumOfSquares += value * value;
          if (value < minimum) minimum = value;
          if (value > maximum) maximum = value;
          sampleCount++;
        }
      }
      const mean = sum / sampleCount;
      const deviation = Math.sqrt(sumOfSquares / sampleCount - mean * mean);
      console.log(
        `${noiseId}: mean ${mean.toFixed(3)}, deviation ${deviation.toFixed(3)}, range [${minimum.toFixed(3)}, ${maximum.toFixed(3)}], maxValue ${noise.maxValue.toFixed(3)}`,
      );
      expect(Math.abs(mean)).toBeLessThan(0.35);
      expect(deviation).toBeGreaterThan(0.05);
      expect(maximum).toBeLessThanOrEqual(noise.maxValue);
      expect(minimum).toBeGreaterThanOrEqual(-noise.maxValue);
    }
  });

  test("NormalNoise.getValue hot-path cost", () => {
    const continentalness = registry.get("minecraft:continentalness");
    const iterations = 1_000_000;
    let checksum = 0;
    const startedAt = performance.now();
    for (let index = 0; index < iterations; index++) {
      checksum += continentalness.getValue((index & 1023) * 0.25, 0, (index >> 10) * 0.25);
    }
    const nanosecondsPerSample = ((performance.now() - startedAt) * 1e6) / iterations;
    const octaveCount = noiseParametersById["minecraft:continentalness"].amplitudes.filter((value) => value !== 0).length;
    console.log(
      `continentalness (${octaveCount} active octaves x2): ${nanosecondsPerSample.toFixed(1)} ns per sample (checksum ${checksum.toFixed(3)})`,
    );
    expect(nanosecondsPerSample).toBeLessThan(5000);
  });
});

afterAll(() => {
  console.log(`noise.test.ts wall-clock ${(performance.now() - suiteStartedAt).toFixed(0)} ms`);
});
