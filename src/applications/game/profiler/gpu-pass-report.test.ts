import { describe, expect, test } from "bun:test";
import { buildGpuPassRows } from "./gpu-pass-report";
import { Profiler } from "./profiler";

function profileWithPasses() {
  const profiler = new Profiler();
  profiler.setEnabled(true);
  profiler.recordTimer("gpu.pass.scene", 6, "gpu");
  profiler.recordTimer("gpu.pass.scene", 8, "gpu");
  profiler.recordTimer("gpu.pass.shadowCascade0", 2, "gpu");
  profiler.recordTimer("gpu.pass.shadowCascade0", 2, "gpu");
  profiler.recordTimer("gpu.pass.scene.syncEstimate", 99, "gpu");
  for (let run = 0; run < 2; run++) {
    const token = profiler.begin("main.render.shadowCascade0");
    profiler.end(token);
  }
  profiler.addCounter("gpu.passDraws.shadowCascade0.calls", 120);
  profiler.addCounter("gpu.passDraws.shadowCascade0.triangles", 50_000);
  return profiler.snapshot();
}

describe("buildGpuPassRows", () => {
  test("ranks passes by mean GPU time and shares the total between them", () => {
    const rows = buildGpuPassRows(profileWithPasses());
    expect(rows.map((row) => row.pass)).toEqual(["scene", "shadowCascade0"]);
    expect(rows[0].gpuShare).toBeCloseTo(7 / 9);
    expect(rows[1].gpuShare).toBeCloseTo(2 / 9);
  });

  test("divides the draw counters by how many times the pass ran and ignores sync estimates", () => {
    const rows = buildGpuPassRows(profileWithPasses());
    const cascade = rows.find((row) => row.pass === "shadowCascade0")!;
    expect(cascade.drawCallsPerPass).toBe(60);
    expect(cascade.trianglesPerPass).toBe(25_000);
    expect(rows.some((row) => row.pass.includes("syncEstimate"))).toBe(false);
  });
});
