import { describe, expect, test } from "bun:test";
import { diffProfiles, diffSnapshots, renderDiffMarkdown, type DiffRow } from "./diff";
import { simulateSnapshot, worldgenScenario, worldgenTask, type SimulatedScenario } from "./profile-fixtures";
import { buildProfileReport } from "./report";
import { PROFILE_SCHEMA_VERSION, type BenchmarkResult } from "./types";

const baseScenario = worldgenScenario();

function slowerTreePlacement(factor: number): SimulatedScenario {
  const task = worldgenTask();
  return worldgenScenario({
    workerTasks: [
      {
        ...task,
        executionMs: 44 + 14 * (factor - 1),
        nestedSections: [
          task.nestedSections![0],
          task.nestedSections![1],
          {
            name: "features",
            selfMs: 4,
            children: [
              { name: "placeTree", selfMs: 14 * factor, calls: 6 },
              { name: "placeOre", selfMs: 2, calls: 10 },
            ],
          },
        ],
        breakdowns: {
          ...task.breakdowns,
          "worldgen.biome": [
            { key: "forest", selfMs: 20 + 14 * (factor - 1), units: 4096, calls: 1 },
            { key: "desert", selfMs: 5, units: 4096, calls: 1 },
            { key: "plains", selfMs: 3, units: 4096, calls: 1 },
          ],
        },
      },
    ],
  });
}

function findRow(rows: DiffRow[], category: string, name: string, metric: string) {
  return rows.find((row) => row.category === category && row.name === name && row.metric === metric);
}

describe("diffSnapshots", () => {
  const base = simulateSnapshot(baseScenario);
  const slower = simulateSnapshot(slowerTreePlacement(2));
  const rows = diffSnapshots(base, slower);

  test("flags the slower call tree node as a regression with absolute and percent change", () => {
    const row = findRow(rows, "callTree", "worldgen.generateChunk: features > placeTree", "self per call");
    expect(row?.verdict).toBe("regression");
    expect(row?.base).toBeCloseTo(14 / 6, 6);
    expect(row?.current).toBeCloseTo(28 / 6, 6);
    expect(row?.absoluteDelta).toBeCloseTo(14 / 6, 6);
    expect(row?.percentDelta).toBeCloseTo(100, 6);
  });

  test("carries the regression into the worker timer, the parent node and the breakdown key", () => {
    expect(findRow(rows, "timer", "worker.worldgen.generateChunk.exec", "mean")?.verdict).toBe("regression");
    expect(findRow(rows, "callTree", "worldgen.generateChunk: features", "self per call")?.verdict).toBe("same");
    const forest = findRow(rows, "breakdown", "worldgen.biome = forest", "self per call");
    expect(forest?.verdict).toBe("regression");
    expect(forest?.percentDelta).toBeCloseTo(70, 6);
  });

  test("leaves untouched metrics as same", () => {
    expect(findRow(rows, "callTree", "worldgen.generateChunk: carve", "self per call")?.verdict).toBe("same");
    expect(findRow(rows, "breakdown", "worldgen.biome = desert", "self per call")?.verdict).toBe("same");
    expect(findRow(rows, "frame", "gpu", "p95")?.verdict).toBe("same");
  });

  test("ranks the biggest change first and puts unchanged rows last", () => {
    const impacts = rows.map((row) => row.impact);
    expect(impacts).toEqual([...impacts].sort((first, second) => second - first));
    expect(rows[0].verdict).toBe("regression");
    expect(rows[rows.length - 1].verdict).toBe("same");
  });

  test("the reverse direction reports the same node as an improvement", () => {
    const reverse = diffSnapshots(slower, base);
    const row = findRow(reverse, "callTree", "worldgen.generateChunk: features > placeTree", "self per call");
    expect(row?.verdict).toBe("improvement");
    expect(row?.percentDelta).toBeCloseTo(-50, 6);
  });

  test("slower frames show up in the frame percentiles", () => {
    const slowFrames = diffSnapshots(base, simulateSnapshot(worldgenScenario({ frameIntervalMs: 25 })));
    expect(findRow(slowFrames, "frame", "frame interval", "p50")?.verdict).toBe("regression");
  });

  test("changes under the noise percentage are not flagged even when large in absolute terms", () => {
    const withinNoise = diffSnapshots(base, simulateSnapshot(slowerTreePlacement(1.02)));
    const treeRow = findRow(withinNoise, "callTree", "worldgen.generateChunk: features > placeTree", "self per call");
    expect(treeRow?.percentDelta).toBeCloseTo(2, 6);
    expect(treeRow?.verdict).toBe("same");
  });

  test("tiny metrics are not flagged however large the percentage", () => {
    const doubled = worldgenScenario({
      scopes: [...baseScenario.scopes.slice(0, 1), { name: "main.player.update", milliseconds: 0.44 }],
    });
    const tiny = diffSnapshots(base, simulateSnapshot(doubled));
    const row = findRow(tiny, "timer", "main.player.update", "mean");
    expect(row?.percentDelta).toBeCloseTo(10, 6);
    expect(row?.verdict).toBe("same");
  });

  test("metrics that exist on one side only are reported as new or removed", () => {
    const extra = simulateSnapshot(
      worldgenScenario({
        scopes: [...baseScenario.scopes, { name: "main.inventory.rebuild", milliseconds: 3 }],
      }),
    );
    const added = findRow(diffSnapshots(base, extra), "timer", "main.inventory.rebuild", "mean");
    expect(added?.base).toBeNull();
    expect(added?.percentDelta).toBeNull();
    expect(added?.verdict).toBe("regression");
    const removed = findRow(diffSnapshots(extra, base), "timer", "main.inventory.rebuild", "mean");
    expect(removed?.current).toBeNull();
    expect(removed?.verdict).toBe("improvement");
  });
});

describe("diffProfiles", () => {
  const baseReport = buildProfileReport(simulateSnapshot(baseScenario));
  const slowReport = buildProfileReport(simulateSnapshot(slowerTreePlacement(2)));
  const benchmark = (phases: { name: string; report: typeof baseReport }[], overall: typeof baseReport): BenchmarkResult => ({
    schemaVersion: PROFILE_SCHEMA_VERSION,
    startedAtIso: "2026-10-03T10:00:00.000Z",
    seed: 20240607,
    phases: phases.map((phase) => ({ ...phase, durationSeconds: 5 })),
    overall,
  });

  test("diffs the overall report and each phase by name for benchmark results", () => {
    const base = benchmark([{ name: "fly", report: baseReport }, { name: "hover", report: baseReport }], baseReport);
    const current = benchmark([{ name: "fly", report: slowReport }, { name: "hover", report: baseReport }], slowReport);
    const diff = diffProfiles(base, current);
    expect(diff.sections.map((section) => section.name)).toEqual(["overall", "phase fly", "phase hover"]);
    const regressionsIn = (name: string) =>
      diff.sections.find((section) => section.name === name)!.rows.filter((row) => row.verdict === "regression");
    expect(regressionsIn("phase fly").length).toBeGreaterThan(0);
    expect(regressionsIn("phase hover")).toEqual([]);
    expect(regressionsIn("overall").length).toBeGreaterThan(0);
  });

  test("lists phases that exist on one side only instead of comparing them", () => {
    const base = benchmark([{ name: "fly", report: baseReport }, { name: "edit", report: baseReport }], baseReport);
    const current = benchmark([{ name: "fly", report: baseReport }, { name: "hover", report: baseReport }], baseReport);
    const diff = diffProfiles(base, current);
    expect(diff.unmatchedSections).toEqual(["edit (only in base)", "hover (only in current)"]);
    expect(diff.sections.map((section) => section.name)).toEqual(["overall", "phase fly"]);
  });

  test("accepts saved snapshot reports as well as bare snapshots", () => {
    const fromReports = diffProfiles(baseReport, slowReport);
    const fromSnapshots = diffProfiles(baseReport.snapshot, slowReport.snapshot);
    expect(fromReports.sections[0].rows.length).toBe(fromSnapshots.sections[0].rows.length);
    expect(fromReports.sections[0].rows.some((row) => row.verdict === "regression")).toBe(true);
  });

  test("rejects input that is not a profile", () => {
    expect(() => diffProfiles({} as never, baseReport)).toThrow("neither a profile snapshot");
  });
});

describe("renderDiffMarkdown", () => {
  const diff = diffProfiles(
    buildProfileReport(simulateSnapshot(baseScenario)),
    buildProfileReport(simulateSnapshot(slowerTreePlacement(2))),
  );
  const markdown = renderDiffMarkdown(diff);

  test("lists regressions with base, current, change and percent", () => {
    const regressions = markdown.slice(markdown.indexOf("### Regressions"), markdown.indexOf("### Improvements"));
    const row = regressions.split("\n").find((line) => line.includes("features > placeTree"));
    expect(row).toBe("| callTree | worldgen.generateChunk: features > placeTree | self per call | 2.33ms | 4.67ms | +2.33ms | +100.0% |");
  });

  test("summarizes counts and states the noise rule", () => {
    expect(markdown).toMatch(/\d+ regressions, 0 improvements, \d+ unchanged of \d+ metrics\./);
    expect(markdown).toContain("at least 5%");
  });

  test("contains no em or en dashes", () => {
    expect(markdown).not.toMatch(/[–—]/);
  });
});
