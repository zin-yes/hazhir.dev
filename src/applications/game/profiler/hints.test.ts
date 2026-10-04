import { describe, expect, test } from "bun:test";
import {
  busyGameScenario,
  simulateSnapshot,
  worldgenScenario,
  worldgenTask,
  type SimulatedScenario,
} from "./profile-fixtures";
import { buildProfileReport } from "./report";

function hintTitles(scenario: SimulatedScenario) {
  return buildProfileReport(simulateSnapshot(scenario)).hints.map((hint) => hint.title);
}

const healthyScenario: SimulatedScenario = {
  seconds: 12,
  frameIntervalMs: 16.5,
  scopes: [
    { name: "main.frame.render", milliseconds: 0.8 },
    { name: "main.player.update", milliseconds: 0.3 },
  ],
  gpuFrameMs: 3,
  frameGauges: [{ name: "gpu.drawCalls", value: 120 }],
};

describe("buildOptimizationHints on a busy session", () => {
  const report = buildProfileReport(simulateSnapshot(busyGameScenario()));
  const hintByTitle = (fragment: string) => report.hints.find((hint) => hint.title.includes(fragment));

  test("orders hints from high to low severity", () => {
    const order = { high: 0, medium: 1, low: 2 };
    const ranks = report.hints.map((hint) => order[hint.severity]);
    expect(ranks).toEqual([...ranks].sort((first, second) => first - second));
    expect(report.hints[0].severity).toBe("high");
  });

  test("names the scope behind periodic frame spikes with numbers", () => {
    const spike = hintByTitle("Frame time spikes");
    expect(spike?.severity).toBe("high");
    expect(spike?.evidence).toContain("main.chunks.addChunkMesh");
    expect(spike?.suggestion).toContain("main.chunks.addChunkMesh");
  });

  test("flags structured-clone traffic with bytes and main-thread cost", () => {
    const clone = hintByTitle("copied, not transferred");
    expect(clone?.severity).toBe("medium");
    expect(clone?.evidence).toMatch(/MB\/s is structured-cloned/);
    expect(clone?.evidence).toContain("receiving results");
  });

  test("flags wide vertices and lists the biggest attribute first", () => {
    const wide = hintByTitle("Vertex data is wide");
    expect(wide?.severity).toBe("high");
    expect(wide?.evidence.indexOf("normals")).toBeGreaterThan(-1);
    expect(wide?.evidence).toMatch(/positions 12\.0/);
  });

  test("notices Uint32 indices on small meshes", () => {
    expect(hintByTitle("Uint32 indices")).toBeDefined();
  });

  test("reports frequent React renders", () => {
    const react = hintByTitle("re-renders");
    expect(react?.severity).toBe("medium");
    expect(react?.evidence).toContain("main.react.gameRender");
  });

  test("does not invent problems that the numbers do not show", () => {
    const titles = report.hints.map((hint) => hint.title);
    expect(titles).not.toContain("High draw call count");
    expect(titles).not.toContain("GPU frame time is high");
    expect(titles.some((title) => title.includes("saturated"))).toBe(false);
  });
});

describe("buildOptimizationHints on other sessions", () => {
  test("a light, steady session produces no hints", () => {
    expect(hintTitles(healthyScenario)).toEqual([]);
  });

  test("high draw call counts are flagged with the live mesh count", () => {
    const report = buildProfileReport(
      simulateSnapshot({
        ...healthyScenario,
        frameGauges: [{ name: "gpu.drawCalls", value: 900 }],
      }),
    );
    const hint = report.hints.find((candidate) => candidate.title === "High draw call count");
    expect(hint?.severity).toBe("medium");
    expect(hint?.evidence).toContain("900 draw calls");
  });

  test("slow frames with little measured work and long GPU time read as GPU-bound", () => {
    const report = buildProfileReport(
      simulateSnapshot({ ...healthyScenario, frameIntervalMs: 25, gpuFrameMs: 20 }),
    );
    const titles = report.hints.map((hint) => hint.title);
    expect(titles).toContain("Frames are GPU-bound");
    expect(report.hints.find((hint) => hint.title === "GPU frame time is high")?.severity).toBe("high");
  });

  test("a worker pool running flat out is reported as saturated", () => {
    const report = buildProfileReport(
      simulateSnapshot({
        ...healthyScenario,
        workerTasks: [
          {
            poolName: "lighting",
            method: "propagateChunkLight",
            workerCount: 2,
            everyFrames: 1,
            executionMs: 70,
            sectionSelfMs: { bfs: 60 },
            counters: { nodesVisited: 90000 },
            paramBytes: 40000,
            resultBytes: 40000,
            mainPostMs: 0.1,
            resultPostMs: 0.2,
            queueWaitMs: 30,
            queueDepth: 6,
          },
        ],
      }),
    );
    const saturated = report.hints.find((hint) => hint.title.includes('"lighting" is saturated'));
    expect(saturated).toBeDefined();
    expect(saturated?.evidence).toContain("100% utilization of 2 workers");
  });

  test("long tasks with a repeated source are summarised once", () => {
    const report = buildProfileReport(
      simulateSnapshot({
        ...healthyScenario,
        events: [
          { kind: "long-task", durationMs: 120, detail: "mesh-upload.js" },
          { kind: "long-animation-frame", durationMs: 90, detail: "mesh-upload.js" },
          { kind: "long-task", durationMs: 60, detail: "react-dom.js" },
        ],
      }),
    );
    const longTasks = report.hints.find((hint) => hint.title === "Long main-thread tasks");
    expect(longTasks?.severity).toBe("medium");
    expect(longTasks?.evidence).toContain("mesh-upload.js (2x)");
  });
});

describe("buildOptimizationHints from call trees and breakdowns", () => {
  const hintsFor = (scenario: SimulatedScenario) => buildProfileReport(simulateSnapshot(scenario)).hints;
  const withTask = (task: Parameters<typeof worldgenTask>[0]) =>
    worldgenScenario({ workerTasks: [worldgenTask(task)] });

  test("flags a breakdown key that takes most of its dimension, with the per unit cost", () => {
    const hint = hintsFor(worldgenScenario()).find((candidate) => candidate.title === 'worldgen.biome: "forest" dominates');
    expect(hint?.severity).toBe("high");
    expect(hint?.evidence).toContain('"forest" takes 1200ms of 1680ms (71%) across 3 keys');
    expect(hint?.evidence).toContain("4.88us each");
  });

  test("names cross dimension pairs with a readable separator", () => {
    const titles = hintsFor(worldgenScenario()).map((hint) => hint.title);
    expect(titles).toContain('worldgen.biomeStage: "forest x features" dominates');
  });

  test("ignores dominant keys below the minimum total time or in single key dimensions", () => {
    const hints = hintsFor(
      withTask({
        breakdowns: {
          "worldgen.biome": [
            { key: "forest", selfMs: 0.05, calls: 1 },
            { key: "desert", selfMs: 0.01, calls: 1 },
          ],
          "worldgen.carver": [{ key: "cave", selfMs: 30, calls: 1 }],
        },
      }),
    );
    expect(hints.filter((hint) => hint.title.startsWith("worldgen.biome:") || hint.title.startsWith("worldgen.carver:"))).toEqual([]);
  });

  test("flags the call tree node whose own time is a large share of its root", () => {
    const hint = hintsFor(worldgenScenario()).find((candidate) => candidate.title.includes('"placeTree" is the hot node'));
    expect(hint?.severity).toBe("medium");
    expect(hint?.evidence).toContain("840ms of its own time, 42% of 1980ms");
    expect(hint?.evidence).toContain("360 calls");
  });

  test("a hot section in a flat tree is only a low priority prompt to add nested sections", () => {
    const flat = hintsFor(
      worldgenScenario({
        workerTasks: [worldgenTask({ nestedSections: [{ name: "faceLoop", selfMs: 40 }, { name: "pack", selfMs: 4 }], executionMs: 44, breakdowns: {} })],
      }),
    );
    expect(flat.find((hint) => hint.title.includes('"faceLoop" is the hot node'))?.severity).toBe("low");
  });

  test("a balanced tree produces no hot node hint", () => {
    const balanced = ["a", "b", "c", "d", "e"].map((name) => ({ name, selfMs: 6 }));
    const hints = hintsFor(withTask({ nestedSections: balanced, executionMs: 30, breakdowns: {} }));
    expect(hints.filter((hint) => hint.title.includes("hot node") || hint.title.includes("uninstrumented"))).toEqual([]);
  });

  test("a dominating sampled node says the number is an extrapolation", () => {
    const hints = hintsFor(
      withTask({
        nestedSections: [
          { name: "noise", selfMs: 2, children: [{ name: "densityNode", selfMs: 20, calls: 100000, estimated: true }] },
          { name: "carve", selfMs: 3 },
        ],
        executionMs: 25,
        breakdowns: {},
      }),
    );
    const estimated = hints.find((hint) => hint.title === "Sampled estimate dominates worldgen.generateChunk");
    expect(estimated?.evidence).toContain("noise > densityNode");
    expect(estimated?.evidence).toContain("extrapolated from sampled calls");
    expect(hints.some((hint) => hint.title.includes("hot node"))).toBe(false);
  });

  test("flags worker tasks whose time is mostly outside any instrumented section", () => {
    const hint = hintsFor(withTask({ executionMs: 80 })).find((candidate) => candidate.title.includes("uninstrumented"));
    expect(hint?.title).toBe("worldgen.generateChunk: 59% of task time is uninstrumented");
    expect(hint?.severity).toBe("medium");
    expect(hint?.evidence).toContain("60 tasks executed for 4800ms");
    expect(hint?.evidence).toContain("sections only cover 1980ms");
  });

  test("a task with a small uninstrumented remainder is not flagged", () => {
    const titles = hintsFor(worldgenScenario()).map((hint) => hint.title);
    expect(titles.some((title) => title.includes("uninstrumented"))).toBe(false);
  });
});
