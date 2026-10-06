import { describe, expect, test } from "bun:test";
import { DIMENSIONS } from "@/applications/game/profiler/dimensions";
import { Profiler } from "@/applications/game/profiler/profiler";
import { ingestWorkerTask } from "@/applications/game/profiler/worker-task-ingest";
import {
  addWorkerCounter,
  addWorkerKeyedUnits,
  beginWorkerTask,
  finishWorkerTask,
  startWorkerSection,
  endWorkerSection,
} from "@/applications/game/profiler/worker-recorder";
import { beginColdStart, defineColdStartLabel, endColdStart } from "../engine/profiling/cold-start-ledger";
import { beginHotCounting, endHotCounting } from "../engine/profiling/hot-counters";
import { featureOutcomeKey, featureProfileState, noteFeatureRejection } from "../engine/features/profiling/feature-profiling";
import {
  cacheRateRows,
  coldStartRows,
  featureOutcomeRows,
  modifierRows,
  placementChainRows,
  renderWorldgenDetailMarkdown,
  worldgenCounterTotals,
} from "./worldgen-detail-report";

const SETUP_LABEL = defineColdStartLabel("detailReportSetup");
const IN_PROFILE_LABEL = defineColdStartLabel("detailReportInProfile");

function spinFor(milliseconds: number): void {
  const until = performance.now() + milliseconds;
  while (performance.now() < until) continue;
}

/** One profiled worker task the way the probe records it, ingested into a fresh profiler. */
function profileWorkerTask(recordWork: () => void) {
  const profiler = new Profiler();
  profiler.setEnabled(true);
  profiler.reset("detail-report-test");
  beginWorkerTask(true);
  const isCountingHot = beginHotCounting();
  recordWork();
  endHotCounting(isCountingHot);
  const workerProfile = finishWorkerTask();
  ingestWorkerTask(profiler, {
    poolName: "generation",
    method: "generateChunk",
    enqueuedAtMs: 0,
    dispatchedAtMs: 0,
    completedAtMs: 10,
    postedToWorkerAtEpochMs: 0,
    receivedFromWorkerAtEpochMs: 10,
    paramBytes: 0,
    resultBytes: 0,
    failed: false,
    queueDepthAtEnqueue: 0,
    workerProfile,
    workerResultPostMs: null,
  });
  return profiler.snapshot("detail-report-test");
}

describe("worldgen detail report", () => {
  const deferredToken = beginColdStart(SETUP_LABEL);
  spinFor(3);
  endColdStart(SETUP_LABEL, deferredToken, 250);

  const snapshot = profileWorkerTask(() => {
    const inProfileToken = beginColdStart(IN_PROFILE_LABEL);
    spinFor(2);
    endColdStart(IN_PROFILE_LABEL, inProfileToken, 7);

    addWorkerCounter("cache.baseColumns.hits", 90);
    addWorkerCounter("cache.baseColumns.misses", 10);
    addWorkerCounter("densityCacheHits.flat_cache", 30);
    addWorkerCounter("densityCacheMisses.flat_cache", 70);
    addWorkerCounter("placement.rarity_filter.calls", 400);
    addWorkerCounter("placement.rarity_filter.positionsOut", 25);
    addWorkerCounter("placement.count.calls", 50);
    addWorkerCounter("placement.count.positionsOut", 200);
    addWorkerCounter("gameColumnsConverted", 4);
    addWorkerCounter("noiseChunk.cellsSelected", 1000);

    featureProfileState.activeTypeId = "minecraft:tree";
    startWorkerSection("feature.place.tree");
    addWorkerKeyedUnits(DIMENSIONS.worldgenFeatureOutcome, featureOutcomeKey("minecraft:tree", "placed"), 12);
    addWorkerKeyedUnits(DIMENSIONS.worldgenFeatureOutcome, featureOutcomeKey("minecraft:tree", "rejected"), 28);
    for (let rejection = 0; rejection < 20; rejection++) noteFeatureRejection("notEnoughFreeSpace");
    for (let rejection = 0; rejection < 5; rejection++) noteFeatureRejection("rootsBlocked");
    endWorkerSection();
    featureProfileState.activeTypeId = "";

    addWorkerKeyedUnits(DIMENSIONS.worldgenPlacementChain, "minecraft:trees_plains|rarity_filter|in", 400);
    addWorkerKeyedUnits(DIMENSIONS.worldgenPlacementChain, "minecraft:trees_plains|rarity_filter|out", 25);
    addWorkerKeyedUnits(DIMENSIONS.worldgenPlacementChain, "minecraft:ore_coal|count|in", 50);
    addWorkerKeyedUnits(DIMENSIONS.worldgenPlacementChain, "minecraft:ore_coal|count|out", 200);
  });
  const totals = worldgenCounterTotals(snapshot);

  test("cold start rows combine events recorded before the profile with events inside it", () => {
    const rows = coldStartRows(snapshot, totals);
    const deferred = rows.find((row) => row.label === "detailReportSetup")!;
    const inProfile = rows.find((row) => row.label === "detailReportInProfile")!;
    expect(deferred.calls).toBe(1);
    expect(deferred.units).toBe(250);
    expect(deferred.totalMs).toBeGreaterThanOrEqual(2.5);
    expect(inProfile.calls).toBe(1);
    expect(inProfile.units).toBe(7);
    expect(inProfile.totalMs).toBeGreaterThanOrEqual(1.5);
    expect(rows[0]!.totalMs).toBeGreaterThanOrEqual(rows[rows.length - 1]!.totalMs);
  });

  test("cache rows pair hits with misses for named caches and density caches", () => {
    const rows = cacheRateRows(totals);
    expect(rows.find((row) => row.name === "bounded cache baseColumns")).toMatchObject({ hits: 90, misses: 10 });
    expect(rows.find((row) => row.name === "density flat_cache")).toMatchObject({ hits: 30, misses: 70 });
  });

  test("modifier rows give positions in and out", () => {
    const rows = modifierRows(totals);
    expect(rows[0]).toEqual({ modifier: "rarity_filter", evaluated: 400, positionsOut: 25 });
    expect(rows.find((row) => row.modifier === "count")).toEqual({ modifier: "count", evaluated: 50, positionsOut: 200 });
  });

  test("feature outcome rows carry the stated rejection reasons, biggest first", () => {
    const treeRow = featureOutcomeRows(snapshot).find((row) => row.featureType === "minecraft:tree")!;
    expect(treeRow.placed).toBe(12);
    expect(treeRow.rejected).toBe(28);
    expect(treeRow.reasons).toEqual([
      { reason: "notEnoughFreeSpace", count: 20 },
      { reason: "rootsBlocked", count: 5 },
    ]);
  });

  test("placement chain rows sort by dropped positions and keep feature keys that contain colons", () => {
    const rows = placementChainRows(snapshot);
    expect(rows[0]).toEqual({ feature: "minecraft:trees_plains", modifier: "rarity_filter", positionsIn: 400, positionsOut: 25 });
  });

  test("the rendered markdown shows rates and per game column values", () => {
    const markdown = renderWorldgenDetailMarkdown({ snapshot, dataFileSizes: [{ fileName: "biomes.json", bytes: 1234 }] });
    expect(markdown).toContain("90.0%");
    expect(markdown).toContain("minecraft:tree");
    expect(markdown).toContain("notEnoughFreeSpace 20");
    expect(markdown).toContain("biomes.json");
    // 1000 cells over 4 game columns.
    expect(markdown).toMatch(/noiseChunk\.cellsSelected` \| 1,000 \| 250 \|/);
  });
});
