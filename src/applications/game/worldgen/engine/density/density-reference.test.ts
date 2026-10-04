// Bit-exact comparison against the real 1.20.6 classes (fixtures/DensityReference.java, Terralith, seed 1337):
// every overworld/Terralith density_function registry entry, all fifteen router functions, and Climate.Sampler.

import { afterAll, describe, expect, test } from "bun:test";
import type { JsonValue } from "../registry/datapack-loader";
import { createClimateSampler } from "./climate-sampler";
import { DensityFunctionCompiler } from "./compiler";
import { SinglePointContext } from "./density-function";
import { createSeededNoiseSources } from "./noise-router";
import { NOISE_ROUTER_FIELDS, type NoiseRouter, NoiseWiringVisitor } from "./router-wiring";
import {
  loadOverworldRouter,
  loadTerralithDatapacks,
  readReferenceVectors,
  TERRALITH_DATA_AVAILABLE,
  TEST_SEED,
} from "./terralith-test-data.node";

interface ClimateVector {
  quartX: number;
  quartY: number;
  quartZ: number;
  target: number[];
}

interface DensityReferenceVectors {
  routerBounds: Record<string, [number, number]>;
  routerPoints: ({ x: number; y: number; z: number } & Record<string, number>)[];
  climate: ClimateVector[];
  registryPoints: [number, number, number][];
  registryFunctions: { id: string; minValue: number; maxValue: number; values: number[] }[];
}

const suiteStart = performance.now();
const describeWithData = TERRALITH_DATA_AVAILABLE ? describe : describe.skip;
const vectors = readReferenceVectors<DensityReferenceVectors>(new URL("./fixtures/density-reference-vectors.json.gz", import.meta.url));

/** Every density function type the Terralith overworld actually uses; the registry vectors must exercise all of them. */
const TYPES_THE_OVERWORLD_USES = [
  "add", "mul", "min", "max", "abs", "square", "cube", "half_negative", "quarter_negative", "squeeze", "clamp",
  "noise", "shifted_noise", "shift_a", "shift_b", "weird_scaled_sampler", "y_clamped_gradient", "spline",
  "range_choice", "interpolated", "flat_cache", "cache_2d", "cache_once", "blend_alpha", "blend_offset",
  "blend_density", "old_blended_noise", "beardifier",
];

function collectTypes(json: JsonValue, into: Set<string>): void {
  if (Array.isArray(json)) {
    for (const element of json) collectTypes(element, into);
  } else if (json !== null && typeof json === "object") {
    if (typeof json.type === "string") into.add(json.type.replace(/^minecraft:/, ""));
    for (const value of Object.values(json)) collectTypes(value, into);
  }
}

function targetArray(target: ReturnType<ReturnType<typeof createClimateSampler>["sample"]>): number[] {
  return [target.temperature, target.humidity, target.continentalness, target.erosion, target.depth, target.weirdness];
}

describeWithData("density functions match the Java reference bit for bit", () => {
  test("every overworld and Terralith registry entry, wired like RandomState, at 24 points", () => {
    const { registries } = loadTerralithDatapacks();
    const compiler = new DensityFunctionCompiler(registries.density_function);
    const wiring = new NoiseWiringVisitor(createSeededNoiseSources({ registries, seed: TEST_SEED }));
    const mismatchedIds: string[] = [];
    const coveredTypes = new Set<string>();
    for (const reference of vectors.registryFunctions) {
      collectTypes(registries.density_function[reference.id], coveredTypes);
      const wired = wiring.map(compiler.resolveReference(reference.id));
      const values = vectors.registryPoints.map(([x, y, z]) => wired.compute(new SinglePointContext(x, y, z)));
      const boundsMatch = Object.is(wired.minValue, reference.minValue) && Object.is(wired.maxValue, reference.maxValue);
      if (!boundsMatch || values.some((value, index) => !Object.is(value, reference.values[index]))) mismatchedIds.push(reference.id);
    }
    expect(vectors.registryFunctions.length).toBeGreaterThanOrEqual(100);
    expect(mismatchedIds).toEqual([]);
    expect(TYPES_THE_OVERWORLD_USES.filter((type) => !coveredTypes.has(type))).toEqual([]);
  });

  test("all fifteen router functions at 320 points, with their bounds", () => {
    const router = loadOverworldRouter();
    const mismatches: string[] = [];
    for (const [fieldName] of NOISE_ROUTER_FIELDS) {
      const [minimum, maximum] = vectors.routerBounds[fieldName];
      if (!Object.is(router[fieldName].minValue, minimum) || !Object.is(router[fieldName].maxValue, maximum)) mismatches.push(`${fieldName} bounds`);
    }
    for (const point of vectors.routerPoints) {
      const context = new SinglePointContext(point.x, point.y, point.z);
      for (const [fieldName] of NOISE_ROUTER_FIELDS) {
        const value = router[fieldName as keyof NoiseRouter].compute(context);
        if (!Object.is(value, point[fieldName])) mismatches.push(`${fieldName} at ${point.x},${point.y},${point.z}: ${value} vs ${point[fieldName]}`);
      }
    }
    expect(vectors.routerPoints.length).toBe(320);
    expect(mismatches.slice(0, 10)).toEqual([]);
  });

  test("Climate.Sampler targets at 320 quart positions across all fixture regions", () => {
    const sampler = createClimateSampler(loadOverworldRouter());
    const mismatches = vectors.climate.filter(
      (reference) => targetArray(sampler.sample(reference.quartX, reference.quartY, reference.quartZ)).join() !== reference.target.join(),
    );
    expect(vectors.climate.length).toBe(320);
    expect(mismatches).toEqual([]);
    const distinctContinentalness = new Set(vectors.climate.map((reference) => reference.target[2]));
    expect(distinctContinentalness.size).toBeGreaterThan(200);
  });
});

afterAll(() => {
  console.log(`density-reference.test.ts: ${(performance.now() - suiteStart).toFixed(0)} ms`);
});
