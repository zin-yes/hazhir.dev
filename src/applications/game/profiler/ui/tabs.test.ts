import { describe, expect, test } from "bun:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { busyGameScenario, simulateSnapshot } from "../profile-fixtures";
import { buildProfileReport } from "../report";
import type { ProfileReport } from "../types";
import { EventsTab } from "./tabs/events-tab";
import { FramesTab } from "./tabs/frames-tab";
import { GpuTab } from "./tabs/gpu-tab";
import { MainThreadTab } from "./tabs/main-thread-tab";
import { MemoryTab } from "./tabs/memory-tab";
import { MeshesTab } from "./tabs/meshes-tab";
import { TargetsTab } from "./tabs/targets-tab";
import { TransfersTab } from "./tabs/transfers-tab";
import { WorkersTab } from "./tabs/workers-tab";

const report = buildProfileReport(
  simulateSnapshot(
    busyGameScenario({
      events: [{ kind: "long-task", durationMs: 120, detail: "mesh-upload.js" }],
    }),
  ),
);

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
});
