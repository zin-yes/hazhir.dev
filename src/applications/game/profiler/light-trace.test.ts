import { describe, expect, test } from "bun:test";
import { buildLightEditRows } from "./light-report";
import { LightEditTrace, classifyLightEdit } from "./light-trace";
import { Profiler } from "./profiler";
import { buildProfileReport } from "./report";

function createClockedProfiler() {
  let nowMs = 0;
  const profiler = new Profiler(() => nowMs);
  profiler.setEnabled(true);
  return {
    profiler,
    advance: (milliseconds: number) => {
      nowMs += milliseconds;
    },
  };
}

describe("classifyLightEdit", () => {
  test("light sources decide the kind before anything else", () => {
    expect(classifyLightEdit(0, 15, false)).toBe("lightPlace");
    expect(classifyLightEdit(15, 0, true)).toBe("lightBreak");
    expect(classifyLightEdit(0, 0, false)).toBe("blockPlace");
    expect(classifyLightEdit(0, 0, true)).toBe("blockBreak");
  });
});

describe("LightEditTrace", () => {
  test("splits an edit into relight and remesh and records every stage", async () => {
    const { profiler, advance } = createClockedProfiler();
    const trace = new LightEditTrace(profiler, "lightPlace");

    await trace.stage("initializeLight", () => advance(30));
    await trace.stage("propagateLight", () => advance(20));
    trace.markRelit();

    let finishFirstMesh!: () => void;
    let finishSecondMesh!: () => void;
    trace.trackMesh(
      new Promise<void>((resolve) => (finishFirstMesh = resolve)),
    );
    trace.trackMesh(
      new Promise<void>((resolve) => (finishSecondMesh = resolve)),
    );
    const finished = trace.finish();

    advance(10);
    finishFirstMesh();
    await Promise.resolve();
    await Promise.resolve();
    advance(15);
    finishSecondMesh();
    await finished;

    const [row] = buildLightEditRows(profiler.snapshot());
    expect(row.kind).toBe("lightPlace");
    expect(row.total.mean).toBe(75);
    expect(row.relight?.mean).toBe(50);
    expect(row.firstMesh?.mean).toBe(60);
    expect(row.remesh?.mean).toBe(25);
    expect(row.stages.map((stage) => stage.name)).toEqual([
      "initializeLight",
      "propagateLight",
    ]);
    expect(row.stages[0].timer.mean).toBe(30);
    expect(
      row.counters.find((counter) => counter.name === "meshes")?.total,
    ).toBe(2);
  });

  test("an edit that needs no mesh still reports its relight time", async () => {
    const { profiler, advance } = createClockedProfiler();
    const trace = new LightEditTrace(profiler, "blockBreak");
    await trace.stage("propagateLight", () => advance(12));
    await trace.finish();

    const [row] = buildLightEditRows(profiler.snapshot());
    expect(row.total.mean).toBe(12);
    expect(row.firstMesh).toBeNull();
  });
});

describe("lightEditLatencyHint", () => {
  async function recordEdits(
    kind: "lightPlace" | "blockPlace",
    stages: [string, number][],
    meshMs: number,
    edits: number,
  ) {
    const { profiler, advance } = createClockedProfiler();
    for (let edit = 0; edit < edits; edit++) {
      const trace = new LightEditTrace(profiler, kind);
      for (const [stage, milliseconds] of stages)
        await trace.stage(stage, () => advance(milliseconds));
      trace.markRelit();
      let finishMesh!: () => void;
      trace.trackMesh(new Promise<void>((resolve) => (finishMesh = resolve)));
      const finished = trace.finish();
      advance(meshMs);
      finishMesh();
      await finished;
    }
    return buildProfileReport(profiler.snapshot());
  }

  test("points at relighting when the stages before meshing dominate", async () => {
    const report = await recordEdits(
      "lightPlace",
      [
        ["initializeLight", 60],
        ["propagateNeighbors", 90],
      ],
      10,
      5,
    );
    const hint = report.hints.find((candidate) =>
      candidate.title.includes("Light edits"),
    );
    expect(hint?.severity).toBe("high");
    expect(hint?.evidence).toContain("lightPlace");
    expect(hint?.evidence).toContain("propagateNeighbors");
    expect(hint?.suggestion).toContain("relighting");
  });

  test("stays quiet when edits show up quickly", async () => {
    const report = await recordEdits("blockPlace", [["relight", 1]], 2, 6);
    expect(
      report.hints.some((hint) => hint.title.includes("Light edits")),
    ).toBe(false);
  });
});
