import { describe, expect, test } from "bun:test";
import { createFakeWebGl } from "./fake-webgl.test-helper";
import { measureGpuPass, setGpuPassHost } from "./gpu-pass-registry";
import { GpuTimer } from "./gpu-timer";
import { Profiler } from "./profiler";

function setup() {
  const fake = createFakeWebGl();
  const profiler = new Profiler();
  profiler.setEnabled(true);
  const gpuTimer = new GpuTimer(fake.asTimerContext(), profiler);
  const renderer = {
    info: { autoReset: true, reset() { renderer.info.render.calls = 0; renderer.info.render.triangles = 0; }, render: { calls: 0, triangles: 0 } },
  };
  setGpuPassHost({ gpuTimer, renderer });
  return { fake, profiler, gpuTimer, renderer };
}

describe("measureGpuPass", () => {
  test("records CPU scope, GPU time and the draws of the pass, then restores renderer stats handling", () => {
    const { fake, profiler, renderer } = setup();
    profiler.beginFrame();

    const result = measureGpuPass(
      "shadowCascade1",
      () => {
        renderer.info.render.calls += 40;
        renderer.info.render.triangles += 12_000;
        return "drawn";
      },
      profiler,
    );
    fake.finishQuery(0, 3_000_000);
    profiler.beginFrame();
    const snapshot = profiler.snapshot();
    setGpuPassHost(null);

    expect(result).toBe("drawn");
    expect(renderer.info.autoReset).toBe(true);
    expect(snapshot.timers.find((timer) => timer.name === "main.render.shadowCascade1")?.count).toBe(1);
    expect(snapshot.counters.find((counter) => counter.name === "gpu.passDraws.shadowCascade1.calls")?.total).toBe(40);
    expect(snapshot.counters.find((counter) => counter.name === "gpu.passDraws.shadowCascade1.triangles")?.total).toBe(12_000);
  });

  test("is exactly the callback while the profiler is disabled or no profiled renderer exists", () => {
    const profiler = new Profiler();
    setGpuPassHost(null);
    expect(measureGpuPass("bloom", () => 7, profiler)).toBe(7);

    const { profiler: enabledProfiler } = setup();
    setGpuPassHost(null);
    expect(measureGpuPass("bloom", () => 8, enabledProfiler)).toBe(8);
    expect(enabledProfiler.snapshot().timers).toEqual([]);
  });
});
