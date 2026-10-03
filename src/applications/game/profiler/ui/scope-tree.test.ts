import { describe, expect, test } from "bun:test";
import { busyGameScenario, simulateSnapshot } from "../profile-fixtures";
import { buildScopeTree } from "./scope-tree";

describe("buildScopeTree", () => {
  const rows = buildScopeTree(simulateSnapshot(busyGameScenario()).timers);

  test("places a nested scope directly under its parent", () => {
    const names = rows.map((row) => row.timer.name);
    const renderIndex = names.indexOf("main.frame.render");
    expect(rows[renderIndex + 1].timer.name).toBe("main.gl.upload");
    expect(rows[renderIndex + 1].depth).toBe(rows[renderIndex].depth + 1);
  });

  test("sorts siblings by inclusive time and lists every main-thread scope once", () => {
    const roots = rows.filter((row) => row.depth === 0).map((row) => row.timer.total);
    expect(roots).toEqual([...roots].sort((first, second) => second - first));
    const names = rows.map((row) => row.timer.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("main.chunks.addChunkMesh");
    expect(names.some((name) => name.startsWith("worker."))).toBe(false);
  });
});
