import { describe, expect, test } from "bun:test";
import {
  filterByKinds,
  listKinds,
  normalizeDiffResult,
  renderCompareMarkdown,
  sortByImpact,
  verdictTone,
} from "./compare-model";

const rawRows = [
  { name: "main.frame.render", kind: "timer", baseValue: 4, currentValue: 6, delta: 2, percentDelta: 50, verdict: "regression" },
  { name: "worker.mesh.generateMesh", kind: "timer", baseValue: 30, currentValue: 12, delta: -18, percentDelta: -60, verdict: "improvement" },
  { name: "memory.geometryBytes", kind: "gauge", baseValue: 1000, currentValue: 3000, delta: 2000, percentDelta: 200, verdict: "regression" },
  { name: "gpu.frame", kind: "timer", baseValue: 5, currentValue: 5.1, delta: 0.1, percentDelta: 2, verdict: "unchanged" },
  { name: "brand.new.metric", kind: "counter", baseValue: 0, currentValue: 10, delta: 10, percentDelta: null, verdict: "regression" },
];

describe("normalizeDiffResult", () => {
  test("accepts a bare array or an object with rows and drops malformed entries", () => {
    expect(normalizeDiffResult(rawRows)).toHaveLength(5);
    expect(normalizeDiffResult({ rows: rawRows })).toHaveLength(5);
    expect(normalizeDiffResult([...rawRows, { name: "bad" }, null, "x"])).toHaveLength(5);
    expect(normalizeDiffResult(undefined)).toEqual([]);
  });
});

describe("normalizeDiffResult with the profiler diff shape", () => {
  const diffRow = (name: string, verdict: string, base: number | null, current: number | null, impact: number) => ({
    category: "timer",
    name,
    metric: "mean",
    unit: "ms",
    base,
    current,
    absoluteDelta: (current ?? 0) - (base ?? 0),
    percentDelta: base ? (((current ?? 0) - base) / base) * 100 : null,
    verdict,
    impact,
  });

  test("flattens sections, keeps added and removed metrics, and ranks by impact within a verdict", () => {
    const diff = {
      baseLabel: "a",
      currentLabel: "b",
      unmatchedSections: [],
      sections: [
        {
          name: "snapshot",
          rows: [
            diffRow("main.small", "regression", 1, 1.2, 4),
            diffRow("main.big", "regression", 10, 30, 400),
            diffRow("main.new", "regression", null, 8, 160),
            diffRow("main.faster", "improvement", 9, 3, 120),
          ],
        },
      ],
    };
    const rows = normalizeDiffResult(diff);
    expect(rows.map((row) => row.name)).toEqual([
      "main.small (mean)",
      "main.big (mean)",
      "main.new (mean)",
      "main.faster (mean)",
    ]);
    expect(sortByImpact(rows).map((row) => row.name)).toEqual([
      "main.big (mean)",
      "main.new (mean)",
      "main.small (mean)",
      "main.faster (mean)",
    ]);
    expect(rows[2]).toMatchObject({ baseValue: null, currentValue: 8, delta: 8, percentDelta: null });
  });

  test("prefixes rows with the section name when a benchmark has several sections", () => {
    const rows = normalizeDiffResult({
      sections: [
        { name: "overall", rows: [diffRow("x", "same", 1, 1, 0)] },
        { name: "phase fly", rows: [diffRow("x", "same", 1, 1, 0)] },
      ],
    });
    expect(rows.map((row) => row.name)).toEqual(["overall: x (mean)", "phase fly: x (mean)"]);
  });
});

describe("sortByImpact", () => {
  test("lists regressions by relative change, then improvements, then the rest", () => {
    const sorted = sortByImpact(normalizeDiffResult(rawRows)).map((row) => row.name);
    expect(sorted).toEqual([
      "memory.geometryBytes",
      "main.frame.render",
      "brand.new.metric",
      "worker.mesh.generateMesh",
      "gpu.frame",
    ]);
  });
});

describe("kind filtering", () => {
  test("lists kinds once and keeps only enabled ones", () => {
    const rows = normalizeDiffResult(rawRows);
    expect(listKinds(rows)).toEqual(["counter", "gauge", "timer"]);
    expect(filterByKinds(rows, new Set(["gauge"])).map((row) => row.name)).toEqual(["memory.geometryBytes"]);
  });
});

describe("verdictTone", () => {
  test("maps verdict words to a color tone", () => {
    expect(verdictTone("regression")).toBe("regression");
    expect(verdictTone("Improved")).toBe("improvement");
    expect(verdictTone("unchanged")).toBe("neutral");
  });
});

describe("renderCompareMarkdown", () => {
  test("puts the worst regression first and shows missing percentages as a dash", () => {
    const markdown = renderCompareMarkdown("before-fix", normalizeDiffResult(rawRows));
    const lines = markdown.split("\n");
    expect(lines[0]).toContain("before-fix");
    expect(lines[4]).toContain("memory.geometryBytes");
    expect(markdown).toMatch(/brand\.new\.metric \| counter \| 0\.00 \| 10\.00 \| 10\.00 \| - \|/);
  });
});
