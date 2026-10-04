// Java behaviors that are easy to "fix" by accident and that the reference vectors may not pin down at every
// branch: bounds quirks feeding MIN short-circuits, spline extrapolation and float output, rarity thresholds,
// climate quantization, and holder stripping folding constants into MulOrAdd.

import { afterAll, describe, expect, test } from "bun:test";
import type { JsonObject } from "../registry/datapack-loader";
import { quantizeClimateCoordinate, StripMarkersVisitor } from "./climate-sampler";
import { DensityFunctionCompiler } from "./compiler";
import { SinglePointContext } from "./density-function";
import { spaghettiRarity2D, spaghettiRarity3D } from "./nodes/noise-nodes";
import { loadTerralithDatapacks, TERRALITH_DATA_AVAILABLE } from "./terralith-test-data.node";

const suiteStart = performance.now();

/** A coordinate that equals blockY / 100 on [-1, 1], so a test can dial in any spline input exactly. */
const LINEAR_Y_COORDINATE = { type: "minecraft:y_clamped_gradient", from_y: -100, to_y: 100, from_value: -1.0, to_value: 1.0 };

function compileInline(json: JsonObject) {
  return new DensityFunctionCompiler({}).compileHolderValue(json);
}

function at(blockY: number) {
  return new SinglePointContext(0, blockY, 0);
}

describe("bounds quirks drive short-circuits exactly like Java", () => {
  test("square of an input bounded below by 0.5 claims minimum 0.5, so min(0.4, square) returns 0.4 even where square is 0.25", () => {
    const squared = { type: "minecraft:square", argument: { type: "minecraft:clamp", input: LINEAR_Y_COORDINATE, min: 0.5, max: 2.0 } };
    const minimum = compileInline({ type: "minecraft:min", argument1: 0.4, argument2: squared });
    expect(compileInline(squared).minValue).toBe(0.5);
    expect(compileInline(squared).compute(at(10))).toBe(0.25);
    expect(minimum.compute(at(10))).toBe(0.4);
  });

  test("blend_density reports infinite bounds, so a max over it never short-circuits", () => {
    const blended = compileInline({ type: "minecraft:blend_density", argument: LINEAR_Y_COORDINATE });
    expect(blended.minValue).toBe(Number.NEGATIVE_INFINITY);
    expect(blended.maxValue).toBe(Number.POSITIVE_INFINITY);
    expect(compileInline({ type: "minecraft:max", argument1: 0.3, argument2: { type: "minecraft:blend_density", argument: LINEAR_Y_COORDINATE } }).compute(at(70))).toBe(0.7);
  });
});

describe("range_choice and rarity thresholds", () => {
  test("range_choice includes its minimum and excludes its maximum", () => {
    const choice = compileInline({
      type: "minecraft:range_choice",
      input: LINEAR_Y_COORDINATE,
      min_inclusive: -0.5,
      max_exclusive: 0.5,
      when_in_range: 1.0,
      when_out_of_range: -1.0,
    });
    expect([choice.compute(at(-50)), choice.compute(at(49)), choice.compute(at(50)), choice.compute(at(-51))]).toEqual([1, 1, -1, -1]);
  });

  test("spaghetti rarity mappers switch at the Java thresholds", () => {
    expect([-0.51, -0.5, -0.0001, 0, 0.4999, 0.5].map(spaghettiRarity3D)).toEqual([0.75, 1.0, 1.0, 1.5, 1.5, 2.0]);
    expect([-0.76, -0.75, -0.5, 0.4999, 0.5, 0.75].map(spaghettiRarity2D)).toEqual([0.5, 0.75, 1.0, 1.0, 2.0, 3.0]);
  });
});

describe("climate quantization", () => {
  test("narrows to float, multiplies in float and truncates toward zero", () => {
    expect(quantizeClimateCoordinate(0.7)).toBe(7000);
    expect(quantizeClimateCoordinate(-0.45)).toBe(-4500);
    expect(quantizeClimateCoordinate(0.123456789)).toBe(1234);
    expect(quantizeClimateCoordinate(-0.99999)).toBe(-9999);
    expect(quantizeClimateCoordinate(Number.NaN)).toBe(0);
  });
});

(TERRALITH_DATA_AVAILABLE ? describe : describe.skip)("splines built from real Terralith points", () => {
  function terralithSplineOverLinearY(splineId: string) {
    const registryJson = loadTerralithDatapacks().registries.density_function[splineId] as JsonObject;
    let splineJson = registryJson;
    while (splineJson.type !== "minecraft:spline") splineJson = splineJson.argument as JsonObject;
    const spline = splineJson.spline as JsonObject;
    const points = spline.points as JsonObject[];
    const compiler = new DensityFunctionCompiler(loadTerralithDatapacks().registries.density_function);
    const compiled = compiler.compileHolderValue({ type: "minecraft:spline", spline: { coordinate: LINEAR_Y_COORDINATE, points } });
    return { compiled, points };
  }

  test("Terralith's effective_continentalness passes through its points, outputs float32, and extrapolates with the end derivatives", () => {
    const { compiled, points } = terralithSplineOverLinearY("minecraft:overworld/effective_continentalness");
    expect(points.length).toBeGreaterThanOrEqual(2);
    for (const point of points) {
      const location = point.location as number;
      if (typeof point.value !== "number" || Math.abs(location) > 1) continue;
      const blockY = Math.round(location * 100);
      if (Math.fround(blockY / 100) !== Math.fround(location)) continue;
      expect(compiled.compute(at(blockY))).toBe(Math.fround(point.value));
    }
    for (let blockY = -100; blockY <= 100; blockY += 7) expect(Math.fround(compiled.compute(at(blockY)))).toBe(compiled.compute(at(blockY)));
    const lastPoint = points[points.length - 1];
    expect(lastPoint.derivative).not.toBe(0);
    const slopeBeyondLastPoint = compiled.compute(at(100)) - compiled.compute(at(95));
    expect(slopeBeyondLastPoint).toBeCloseTo((lastPoint.derivative as number) * 0.05, 5);
    const firstPoint = points[0];
    const slopeBeforeFirstPoint = compiled.compute(at(-95)) - compiled.compute(at(-100));
    expect(slopeBeforeFirstPoint).toBeCloseTo((firstPoint.derivative as number) * 0.05, 5);
  });
});

describe("holder stripping", () => {
  test("RandomState's climate visitor folds a constant add operand into MulOrAdd and keeps the value", () => {
    const compiled = compileInline({ type: "minecraft:add", argument1: 0.25, argument2: LINEAR_Y_COORDINATE });
    const stripped = new StripMarkersVisitor().map(compiled);
    expect(stripped.constructor.name).toBe("MulOrAddNode");
    expect(compiled.constructor.name).not.toBe("MulOrAddNode");
    expect(stripped.compute(at(30))).toBe(compiled.compute(at(30)));
  });
});

afterAll(() => {
  console.log(`density-quirks.test.ts: ${(performance.now() - suiteStart).toFixed(0)} ms`);
});
