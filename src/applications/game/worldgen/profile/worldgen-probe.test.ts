import { describe, expect, test } from "bun:test";
import { DIMENSIONS } from "@/applications/game/profiler/dimensions";
import { locateBiomes } from "./biome-locator";
import { renderProbeMarkdown, renderProbeSummaryText, topCallTreePaths } from "./probe-report";
import { runWorldgenProbe } from "./worldgen-probe";

const SEED = 2024;
const COARSE_LOCATOR = { radiusBlocks: 3000, stepBlocks: 512 };

function pickTwoBiomes(): string[] {
  return locateBiomes({ seed: SEED, ...COARSE_LOCATOR }).biomes.slice(0, 2).map((coverage) => coverage.biome);
}

describe("worldgen probe", () => {
  const requestedBiomes = pickTwoBiomes();
  const testStartedAtMs = performance.now();
  const result = runWorldgenProbe({
    seed: SEED,
    columnsPerBiome: 1,
    warmupColumns: 0,
    biomes: requestedBiomes,
    locator: COARSE_LOCATOR,
  });

  test("returns a ranked timing row per requested biome", () => {
    expect(requestedBiomes.length).toBe(2);
    expect(result.rows.map((row) => row.biome).sort()).toEqual([...requestedBiomes].sort());
    expect(result.rows.map((row) => row.rank)).toEqual([1, 2]);
    expect(result.rows[0]!.meanMsPerColumn).toBeGreaterThanOrEqual(result.rows[1]!.meanMsPerColumn);
    for (const row of result.rows) {
      expect(row.columns).toBe(1);
      expect(row.totalMs).toBeGreaterThan(0);
      expect(row.msPerGameChunk).toBeGreaterThan(0);
      expect(row.solidBlocksPerSecond).toBeGreaterThan(0);
      expect(row.p95MsPerColumn).toBe(row.probedColumns[0]!.wallMs);
      expect(row.probedColumns[0]!.solidBlocks).toBeGreaterThan(0);
      expect(row.startupMs).toBeNull();
    }
  });

  test("populates the profiler snapshot from the worker sections of every column", () => {
    const generationTree = result.snapshot.callTrees.find((tree) => tree.root === "generation.generateChunk");
    expect(generationTree).toBeDefined();
    const rootNode = generationTree!.nodes.find((node) => node.path === "probe.column");
    expect(rootNode?.calls).toBe(2);
    expect(generationTree!.nodes.some((node) => node.path.includes("terrainNoise") && node.selfMs >= 0)).toBe(true);
    expect(topCallTreePaths(result.snapshot, 15)[0]!.selfMs).toBeGreaterThan(0);

    const biomeBreakdown = result.snapshot.breakdowns.find((summary) => summary.dimension === DIMENSIONS.worldgenBiome);
    expect(biomeBreakdown?.entries.map((entry) => entry.key).sort()).toEqual([...requestedBiomes].sort());

    const blocksGenerated = result.snapshot.counters.find((counter) => counter.name === "work.generation.generateChunk.blocksGenerated");
    expect(blocksGenerated?.total).toBeGreaterThan(0);
  });

  test("renders a summary and markdown that name the probed biomes", () => {
    const summary = renderProbeSummaryText(result);
    const markdown = renderProbeMarkdown(result);
    for (const biome of requestedBiomes) {
      expect(summary).toContain(biome);
      expect(markdown).toContain(biome);
    }
    expect(markdown).toContain("probe.column");
  });

  test("cold mode reports world construction as startup cost", () => {
    const coldResult = runWorldgenProbe({
      seed: SEED,
      columnsPerBiome: 1,
      warmupColumns: 0,
      biomes: requestedBiomes.slice(0, 1),
      wholeGameChunks: false,
      cold: true,
      locator: COARSE_LOCATOR,
    });
    expect(coldResult.cold).toBe(true);
    expect(coldResult.rows[0]!.startupMs).toBeGreaterThan(0);
    expect(coldResult.rows[0]!.totalMs).toBeGreaterThan(0);
    console.log(`worldgen probe tests took ${(performance.now() - testStartedAtMs).toFixed(0)} ms`);
  });
});
