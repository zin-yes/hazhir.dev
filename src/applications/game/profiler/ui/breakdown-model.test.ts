import { describe, expect, test } from "bun:test";
import type { BreakdownSummary } from "../types";
import { buildBreakdownMatrix, buildBreakdownRows, isCrossDimension } from "./breakdown-model";

const biomeSummary: BreakdownSummary = {
  dimension: "worldgen.biome",
  thread: "worker",
  totalSelfMs: 100,
  totalUnits: 3000,
  droppedKeys: 0,
  entries: [
    { key: "plains", calls: 50, selfMs: 20, totalMs: 20, units: 1000 },
    { key: "forest", calls: 40, selfMs: 60, totalMs: 62, units: 1500 },
    { key: "desert", calls: 10, selfMs: 20, totalMs: 20, units: 0 },
  ],
};

const biomeFeatureSummary: BreakdownSummary = {
  dimension: "worldgen.biomeFeature",
  thread: "worker",
  totalSelfMs: 47,
  totalUnits: 0,
  droppedKeys: 0,
  entries: [
    { key: "forest|oak_tree", calls: 10, selfMs: 30, totalMs: 30, units: 10 },
    { key: "forest|ore_coal", calls: 10, selfMs: 4, totalMs: 4, units: 10 },
    { key: "plains|oak_tree", calls: 10, selfMs: 6, totalMs: 6, units: 10 },
    { key: "desert|cactus", calls: 10, selfMs: 2, totalMs: 2, units: 10 },
    { key: "<other>", calls: 1, selfMs: 5, totalMs: 5, units: 0 },
  ],
};

describe("buildBreakdownRows", () => {
  test("computes share, microseconds per call and nanoseconds per unit", () => {
    const rows = buildBreakdownRows(biomeSummary);
    expect(rows[0].key).toBe("forest");
    const forest = rows[0];
    expect(forest.share).toBeCloseTo(0.6);
    expect(forest.microsecondsPerCall).toBeCloseTo(1500);
    expect(forest.nanosecondsPerUnit).toBeCloseTo(40000);
  });

  test("leaves per-unit cost empty when no units were recorded and sorts such rows last", () => {
    const rows = buildBreakdownRows(biomeSummary, "nanosecondsPerUnit", "descending");
    expect(rows[rows.length - 1].key).toBe("desert");
    expect(rows[rows.length - 1].nanosecondsPerUnit).toBeNull();
    const ascending = buildBreakdownRows(biomeSummary, "nanosecondsPerUnit", "ascending");
    expect(ascending[ascending.length - 1].key).toBe("desert");
  });

  test("sorts by key alphabetically", () => {
    expect(buildBreakdownRows(biomeSummary, "key", "ascending").map((row) => row.key)).toEqual([
      "desert",
      "forest",
      "plains",
    ]);
  });
});

describe("buildBreakdownMatrix", () => {
  test("is absent for a plain dimension", () => {
    expect(isCrossDimension(biomeSummary)).toBe(false);
    expect(buildBreakdownMatrix(biomeSummary)).toBeNull();
  });

  test("splits cross keys into ordered rows and columns by total time", () => {
    const matrix = buildBreakdownMatrix(biomeFeatureSummary)!;
    expect(matrix.rowKeys).toEqual(["forest", "plains", "desert"]);
    expect(matrix.columnKeys).toEqual(["oak_tree", "ore_coal", "cactus"]);
    expect(matrix.cells[0]).toEqual([30, 4, 0]);
    expect(matrix.cells[1]).toEqual([6, 0, 0]);
    expect(matrix.maxCellMs).toBe(30);
    expect(matrix.uncrossedMs).toBe(5);
  });

  test("keeps only the top rows and columns and reports how many were hidden", () => {
    const matrix = buildBreakdownMatrix(biomeFeatureSummary, 2, 1)!;
    expect(matrix.rowKeys).toEqual(["forest", "plains"]);
    expect(matrix.columnKeys).toEqual(["oak_tree"]);
    expect(matrix.hiddenRowCount).toBe(1);
    expect(matrix.hiddenColumnCount).toBe(2);
  });
});
