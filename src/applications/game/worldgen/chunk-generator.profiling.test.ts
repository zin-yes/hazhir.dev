// Worker-profile coverage of the terrain engine: a profiled run must produce the same blocks as an unprofiled one,
// keep the section stack balanced, and report stage, biome, block and cost-driver data for real generated columns.

import { afterAll, describe, expect, test } from "bun:test";
import { DIMENSIONS } from "@/applications/game/profiler/dimensions";
import {
  beginWorkerTask,
  endWorkerSection,
  finishWorkerTask,
  startWorkerSection,
  type WorkerTaskProfile,
} from "@/applications/game/profiler/worker-recorder";
import { generateChunkBlocks } from "./chunk-generator";
import { createOverworldGenerator, type OverworldGenerator } from "./engine/pipeline";
import { getFullWorld } from "./overworld-world";
import { loadTerralithRegistries } from "./terralith/load-terralith-registries";

const PROFILED_SEED = 4242;
const COLUMN_SEED = 909n;
const COLUMN_CHUNK_X = 31;
const COLUMN_CHUNK_Z = -17;
const GAME_COLUMN_CHUNK_X = 12;
const GAME_COLUMN_CHUNK_Z = -9;
const SURFACE_CHUNK_Y = 2;
const STAGE_NAMES = ["noise-fill", "surface", "carvers"];
const testStartedAtMs = performance.now();

function createGenerator(): OverworldGenerator {
  const { registries, overworldDimension, blockTags } = loadTerralithRegistries();
  return createOverworldGenerator({ registries, overworldDimension, blockTags, seed: COLUMN_SEED, maxCachedColumns: 4 });
}

/** A section opened and closed at the end of a run lands at the root of the tree only when nothing leaked before it. */
function finishWithLeakProbe(): WorkerTaskProfile {
  startWorkerSection("leakProbe");
  endWorkerSection();
  return finishWorkerTask()!;
}

function breakdownEntries(profile: WorkerTaskProfile, dimension: string) {
  return profile.breakdowns[dimension] ?? [];
}

function totalUnits(profile: WorkerTaskProfile, dimension: string): number {
  return breakdownEntries(profile, dimension).reduce((sum, entry) => sum + entry.units, 0);
}

describe("profiled base column generation", () => {
  const unprofiledColumn = createGenerator().generateBaseColumn(COLUMN_CHUNK_X, COLUMN_CHUNK_Z);
  beginWorkerTask(true);
  const profiledColumn = createGenerator().generateBaseColumn(COLUMN_CHUNK_X, COLUMN_CHUNK_Z);
  const profile = finishWithLeakProbe();

  test("profiling does not change a single block", () => {
    const startedAtMs = performance.now();
    let differingBlocks = 0;
    let solidBlocks = 0;
    for (let index = 0; index < profiledColumn.blocks.length; index++) {
      const profiledState = profiledColumn.palette.stateOf(profiledColumn.blocks[index]!);
      const unprofiledState = unprofiledColumn.palette.stateOf(unprofiledColumn.blocks[index]!);
      if (profiledState !== unprofiledState) differingBlocks++;
      if (profiledColumn.blocks[index] !== 0) solidBlocks++;
    }
    expect(solidBlocks).toBeGreaterThan(profiledColumn.blocks.length / 10);
    expect(differingBlocks).toBe(0);
    console.log(`bit-identical check over ${profiledColumn.blocks.length} blocks: ${(performance.now() - startedAtMs).toFixed(1)} ms`);
  });

  test("every stage is a section, tagged by stage, biome and biome x stage without a leaked section", () => {
    expect(profile.callTree.some((node) => node.path === "leakProbe")).toBe(true);
    for (const stageName of STAGE_NAMES) {
      expect(profile.callTree.some((node) => node.path.endsWith(`pipeline.biomeStage>${stageName}`))).toBe(true);
    }
    const stageKeys = breakdownEntries(profile, DIMENSIONS.worldgenStage).map((entry) => entry.key);
    expect(stageKeys).toEqual(expect.arrayContaining(STAGE_NAMES));

    const biomeKeys = breakdownEntries(profile, DIMENSIONS.worldgenBiome).map((entry) => entry.key);
    expect(biomeKeys).toHaveLength(1);
    const biomeStageKeys = breakdownEntries(profile, DIMENSIONS.worldgenBiomeStage).map((entry) => entry.key);
    expect(biomeStageKeys.sort()).toEqual(STAGE_NAMES.map((stageName) => `${biomeKeys[0]}|${stageName}`).sort());
    for (const entry of breakdownEntries(profile, DIMENSIONS.worldgenBiomeStage)) expect(entry.totalMs).toBeGreaterThan(0);
  });

  test("terrain cost drivers are counted: density nodes, cells, aquifer, biome search, surface rules", () => {
    const densityNodeUnits = new Map(breakdownEntries(profile, DIMENSIONS.worldgenDensityNode).map((entry) => [entry.key, entry.units]));
    // Interpolated values are read straight from the noise chunk's cell caches since the compiled fast path, so their
    // cost shows as cellsInterpolated below; the nodes still evaluated through the tree are counted per type.
    for (const nodeType of ["flat_cache", "spline", "noise", "add"]) {
      expect(densityNodeUnits.get(nodeType) ?? 0).toBeGreaterThan(0);
    }
    const countedUnits = [...densityNodeUnits.values()].reduce((sum, units) => sum + units, 0);
    expect(profile.counters.densityEvaluations).toBe(countedUnits);
    expect(profile.counters.densityEvaluations).toBeGreaterThan(densityNodeUnits.get("flat_cache")!);
    expect(profile.counters["densityCacheHits.flat_cache"]).toBeGreaterThan(0);
    expect(profile.counters["densityCacheMisses.flat_cache"]).toBeGreaterThanOrEqual(0);
    expect(profile.counters.cellsInterpolated).toBeGreaterThan(1000);
    expect(profile.counters.blocksFilled).toBe(profiledColumn.blocks.length);
    expect(profile.counters.aquiferLookups).toBeGreaterThan(0);
    expect(profile.counters.aquiferLocationCacheHits).toBeGreaterThan(profile.counters.aquiferLocationCacheMisses!);
    expect(profile.counters.biomeRTreeNodeVisits).toBeGreaterThan(profile.counters.biomeRTreeSearches!);
    expect(profile.counters.surfaceRuleEvaluations).toBeGreaterThan(1000);
    const surfaceRuleKeys = breakdownEntries(profile, DIMENSIONS.worldgenSurfaceRule).map((entry) => entry.key);
    expect(surfaceRuleKeys.some((key) => key.startsWith("rule."))).toBe(true);
    expect(surfaceRuleKeys.some((key) => key.startsWith("condition."))).toBe(true);
    expect(profile.counters.carverStartRolls).toBeGreaterThan(100);
  });

  test("a second request for the cached column is a cache hit and generates nothing", () => {
    const generator = createGenerator();
    generator.generateBaseColumn(COLUMN_CHUNK_X, COLUMN_CHUNK_Z);
    beginWorkerTask(true);
    generator.generateBaseColumn(COLUMN_CHUNK_X, COLUMN_CHUNK_Z);
    const cachedProfile = finishWithLeakProbe();
    expect(cachedProfile.counters.baseColumnCacheHits).toBe(1);
    expect(cachedProfile.counters.columnsGenerated).toBeUndefined();
    expect(breakdownEntries(cachedProfile, DIMENSIONS.worldgenStage)).toHaveLength(0);
  });
});

describe("profiled game chunk conversion", () => {
  beginWorkerTask(true);
  const blocks = generateChunkBlocks(PROFILED_SEED, GAME_COLUMN_CHUNK_X, SURFACE_CHUNK_Y, GAME_COLUMN_CHUNK_Z);
  const profile = finishWithLeakProbe();

  test("block statistics match the generated decorated columns and the converted game blocks", () => {
    expect(profile.callTree.some((node) => node.path === "leakProbe")).toBe(true);
    const world = getFullWorld(PROFILED_SEED);
    let nonAirIds = 0;
    for (let columnOffsetX = 0; columnOffsetX < 2; columnOffsetX++) {
      for (let columnOffsetZ = 0; columnOffsetZ < 2; columnOffsetZ++) {
        const column = world.generateDecoratedColumn(GAME_COLUMN_CHUNK_X * 2 + columnOffsetX, GAME_COLUMN_CHUNK_Z * 2 + columnOffsetZ);
        for (const paletteId of column.blocks) if (paletteId !== 0) nonAirIds++;
      }
    }
    expect(nonAirIds).toBeGreaterThan(10_000);
    expect(totalUnits(profile, DIMENSIONS.worldgenBlock)).toBe(nonAirIds);

    const gameBlockUnits = new Map(breakdownEntries(profile, DIMENSIONS.gameBlock).map((entry) => [entry.key, entry.units]));
    const unmappedUnits = gameBlockUnits.get("unmapped") ?? 0;
    expect(totalUnits(profile, DIMENSIONS.gameBlock) - unmappedUnits).toBe(profile.counters.solidBlocks!);
    expect(gameBlockUnits.get("STONE") ?? 0).toBeGreaterThan(0);
    expect(breakdownEntries(profile, DIMENSIONS.worldgenBlock).some((entry) => entry.key === "minecraft:stone" && entry.units > 0)).toBe(true);
    expect(unmappedUnits).toBe(profile.counters.unknownBlockNames ?? 0);
    expect(blocks.some((block) => block !== 0)).toBe(true);
  });

  test("conversion cache and vertical assembly are counted and sectioned", () => {
    expect(profile.counters.gameColumnCacheMisses).toBe(1);
    expect(profile.counters.verticalChunksCopied).toBe(1);
    expect(profile.counters.gameColumnsConverted).toBe(1);
    expect(profile.callTree.some((node) => node.path.endsWith("convert.paletteToGameBlocks"))).toBe(true);
    expect(profile.callTree.some((node) => node.path.endsWith("chunk.assembleVertical"))).toBe(true);
    expect(profile.counters.decoratedColumnCacheMisses).toBeGreaterThanOrEqual(4);
  });
});

afterAll(() => {
  console.log(`chunk-generator.profiling.test.ts took ${(performance.now() - testStartedAtMs).toFixed(0)} ms`);
});
