import { afterAll, describe, expect, test } from "bun:test";
import { getTerrainOnlyGenerator } from "../../overworld-world";
import { getNoiseChunkTemplate } from "../terrain/noise-chunk-template";
import { createColumnMemoizedDensity } from "./column-memoization";
import { compileDensityFunction } from "./density-codegen";
import { type DensityNode, SinglePointContext } from "./density-function";
import { MarkerNode } from "./nodes/structural-nodes";
import { NOISE_ROUTER_FIELDS } from "./router-wiring";

const SEED = 20240607;
const testStartedAtMs = performance.now();

/** Columns of points from bedrock to build limit, plus scattered points, including negative coordinates. */
function samplePoints(): Array<[number, number, number]> {
  const points: Array<[number, number, number]> = [];
  let state = 12345;
  const nextInteger = (range: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / 4294967296 - 0.5) * range);
  };
  for (let column = 0; column < 12; column++) {
    const blockX = nextInteger(20000);
    const blockZ = nextInteger(20000);
    for (let blockY = -64; blockY <= 320; blockY += 4) points.push([blockX, blockY, blockZ]);
  }
  for (let index = 0; index < 400; index++) points.push([nextInteger(20000), nextInteger(384) + 128, nextInteger(20000)]);
  return points;
}

function interpolatedSubtrees(root: DensityNode): DensityNode[] {
  const found = new Set<DensityNode>();
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node instanceof MarkerNode && node.type === "interpolated") found.add(node.wrapped);
    pending.push(...node.children());
  }
  return [...found];
}

describe("compiled density functions", () => {
  test("give the same doubles as the interpreted router functions", () => {
    const startedAtMs = performance.now();
    const router = getTerrainOnlyGenerator(SEED).router;
    const template = getNoiseChunkTemplate(router);
    const points = samplePoints();
    let comparedValues = 0;
    const distinctValues = new Set<number>();
    const roots = [
      ...NOISE_ROUTER_FIELDS.map(([fieldName]) => router[fieldName]),
      // The corner subtrees NoiseChunk interpolates (holders unwrapped, markers kept).
      ...interpolatedSubtrees(template.finalDensityForFill),
    ];
    for (const root of roots) {
      const evaluate = compileDensityFunction(createColumnMemoizedDensity(root));
      for (const [blockX, blockY, blockZ] of points) {
        const expected = root.compute(new SinglePointContext(blockX, blockY, blockZ));
        const actual = evaluate(blockX, blockY, blockZ);
        if (!Object.is(actual, expected)) throw new Error(`Mismatch at ${blockX},${blockY},${blockZ}: ${actual} vs ${expected}`);
        comparedValues++;
        distinctValues.add(expected);
      }
    }
    expect(roots.length).toBeGreaterThan(NOISE_ROUTER_FIELDS.length + 4);
    expect(comparedValues).toBeGreaterThan(10_000);
    // Real terrain functions vary across the samples (an all-constant comparison would prove nothing).
    expect(distinctValues.size).toBeGreaterThan(1000);
    console.log(`compiled density comparison took ${(performance.now() - startedAtMs).toFixed(0)} ms`);
  }, 120_000);
});

afterAll(() => {
  console.log(`density-codegen.test.ts took ${(performance.now() - testStartedAtMs).toFixed(0)} ms`);
});
