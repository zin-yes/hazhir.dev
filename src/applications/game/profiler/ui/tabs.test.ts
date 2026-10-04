import { describe, expect, test } from "bun:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { meshWorkerCallTree } from "./call-tree.test-helper";
import { busyGameScenario, simulateSnapshot } from "../profile-fixtures";
import { buildProfileReport } from "../report";
import type { ProfileReport } from "../types";
import { BreakdownsTab } from "./tabs/breakdowns-tab";
import { CallTreeTab } from "./tabs/call-tree-tab";
import { CompareTab } from "./tabs/compare-tab";
import { EventsTab } from "./tabs/events-tab";
import { FramesTab } from "./tabs/frames-tab";
import { FlameTab } from "./tabs/flame-tab";
import { GpuTab } from "./tabs/gpu-tab";
import { MainThreadTab } from "./tabs/main-thread-tab";
import { MemoryTab } from "./tabs/memory-tab";
import { MeshesTab } from "./tabs/meshes-tab";
import { TargetsTab } from "./tabs/targets-tab";
import { TransfersTab } from "./tabs/transfers-tab";
import { WorkersTab } from "./tabs/workers-tab";

const report = buildProfileReport({
  ...simulateSnapshot(
    busyGameScenario({
      events: [{ kind: "long-task", durationMs: 120, detail: "mesh-upload.js" }],
    }),
  ),
  callTrees: [meshWorkerCallTree()],
  breakdowns: [
    {
      dimension: "worldgen.biomeFeature",
      thread: "worker",
      totalSelfMs: 40,
      totalUnits: 30,
      droppedKeys: 0,
      entries: [
        { key: "forest|oak_tree", calls: 10, selfMs: 30, totalMs: 30, units: 20 },
        { key: "plains|ore_coal", calls: 10, selfMs: 10, totalMs: 10, units: 10 },
      ],
    },
  ],
  sampling: {
    sampleIntervalMs: 10,
    totalSamples: 400,
    durationMs: 4000,
    topSelf: [{ functionName: "packVertices", resource: "https://localhost/_next/static/mesh-worker.js?v=3", line: 214, samples: 100, selfMs: 1000 }],
    topStacks: [{ frames: ["frame", "render", "packVertices"], samples: 100 }],
  },
});

function render(Tab: ComponentType<{ report: ProfileReport }>): string {
  return renderToStaticMarkup(createElement(Tab, { report }));
}

describe("profiler tabs render a realistic report", () => {
  test("targets tab shows hints and ranked scopes", () => {
    const html = render(TargetsTab);
    expect(html).toContain("Frame time spikes");
    expect(html).toContain("main.frame.render");
  });

  test("frames tab draws one bar per recent frame and lists the spike culprit", () => {
    const html = render(FramesTab);
    expect(html).toContain("<svg");
    expect(html).toContain("main.chunks.addChunkMesh");
  });

  test("main tab nests the GL upload under render", () => {
    const html = render(MainThreadTab);
    expect(html.indexOf("main.gl.upload")).toBeGreaterThan(html.indexOf("main.frame.render"));
  });

  test("workers tab shows the pool, sections and cost per unit", () => {
    const html = render(WorkersTab);
    expect(html).toContain("mesh.generateMesh.faceLoop");
    expect(html).toContain("facesEmitted");
    expect(html).toContain("mesh:");
  });

  test("gpu, transfers, memory, meshes and events tabs render their data", () => {
    expect(render(GpuTab)).toContain("gpu.frame");
    expect(render(TransfersTab)).toContain("mesh.generateMesh");
    expect(render(MemoryTab)).toContain("memory.geometryBytes");
    expect(render(MeshesTab)).toContain("0,0,0");
    expect(render(EventsTab)).toContain("mesh-upload.js");
  });

  test("call tree tab lists top-level scopes and the cross-parent top self list", () => {
    const html = render(CallTreeTab);
    expect(html).toContain("mesh.generateMesh");
    expect(html).toContain("scan");
    expect(html).toContain("pack&gt;lookup");
    expect(html).toContain("~scan&gt;faceLoop");
  });

  test("flame tab draws a block per node of the whole tree", () => {
    const html = render(FlameTab);
    expect(html).toContain('data-path="scan&gt;lookup"');
    expect(html).toContain('data-path="pack&gt;lookup"');
  });

  test("breakdowns tab shows keys and the biome by feature heatmap", () => {
    const html = render(BreakdownsTab);
    expect(html).toContain("worldgen.biomeFeature (worker)");
    expect(html).toContain("forest|oak_tree");
    expect(html).toContain("oak_tree");
    expect(html).toContain("ore_coal");
  });

  test("events tab shows the sampling summary with a short script name", () => {
    const html = render(EventsTab);
    expect(html).toContain("packVertices");
    expect(html).toContain("mesh-worker.js:214");
    expect(html).not.toContain("_next/static");
  });

  test("compare tab explains how to start when no diff has run", () => {
    expect(render(CompareTab)).toContain("Save a baseline");
  });
});
