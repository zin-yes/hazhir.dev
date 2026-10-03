import { describe, expect, test } from "bun:test";
import { busyGameScenario, simulateSnapshot, type SimulatedScenario } from "./profile-fixtures";
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
