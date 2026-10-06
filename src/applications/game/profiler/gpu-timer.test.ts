import { describe, expect, test } from "bun:test";
import { createFakeWebGl } from "./fake-webgl.test-helper";
import { GpuTimer } from "./gpu-timer";
import { Profiler } from "./profiler";

function setup(options: { hasTimerExtension?: boolean; maxInFlightQueries?: number; requestSyncEstimate?: boolean } = {}) {
  const fake = createFakeWebGl({ hasTimerExtension: options.hasTimerExtension });
  const profiler = new Profiler();
  profiler.setEnabled(true);
  const timer = new GpuTimer(fake.asTimerContext(), profiler, options);
  const timerTotal = (name: string) =>
    profiler.snapshot().timers.find((candidate) => candidate.name === name)?.total;
  return { fake, profiler, timer, timerTotal };
}

describe("GpuTimer", () => {
  test("turns nanoseconds into frame milliseconds once the query becomes available", () => {
    const { fake, profiler, timer, timerTotal } = setup();
    profiler.beginFrame();
    const frameId = profiler.currentFrameId;
    timer.begin("scene", frameId);
    timer.end();

    timer.poll();
    expect(timerTotal("gpu.frame")).toBeUndefined();

    fake.finishQuery(0, 4_500_000);
    timer.poll();
    expect(timerTotal("gpu.frame")).toBe(4.5);
    expect(profiler.snapshot().frames.gpuMs.total).toBe(4.5);
  });

  test("discards results measured across a disjoint event", () => {
    const { fake, timer, timerTotal, profiler } = setup();
    timer.begin("scene", 1);
    timer.end();
    fake.finishQuery(0, 9_000_000);
    fake.gl.state.disjoint = true;
    timer.poll();

    expect(timerTotal("gpu.frame")).toBeUndefined();
    expect(profiler.snapshot().counters.find((c) => c.name === "gpu.timer.discardedDisjoint")?.total).toBe(1);
  });

  test("a disjoint flag only taints queries that were pending when it was read", () => {
    const { fake, timer, timerTotal } = setup();
    timer.begin("scene", 1);
    timer.end();
    fake.gl.state.disjoint = true;
    timer.poll();
    timer.begin("scene", 2);
    timer.end();
    fake.finishQuery(0, 1_000_000);
    fake.finishQuery(1, 2_000_000);
    timer.poll();

    expect(timerTotal("gpu.frame")).toBe(2);
  });

  test("drops measurements instead of growing past the in-flight cap and reuses finished queries", () => {
    const { fake, timer, profiler } = setup({ maxInFlightQueries: 2 });
    for (let frame = 1; frame <= 5; frame++) {
      timer.begin("scene", frame);
      timer.end();
    }
    expect(fake.gl.queries.length).toBe(2);
    expect(profiler.snapshot().counters.find((c) => c.name === "gpu.timer.dropped")?.total).toBe(3);

    fake.finishQuery(0, 1_000_000);
    fake.finishQuery(1, 1_000_000);
    timer.poll();
    timer.begin("scene", 6);
    timer.end();
    expect(fake.gl.queries.length).toBe(2);
  });

  test("never nests queries when begin is called twice", () => {
    const { timer } = setup();
    timer.begin("sky", 1);
    expect(() => timer.begin("opaque", 1)).not.toThrow();
    timer.end();
  });

  test("sums render passes into the frame GPU time only after every pass resolved", () => {
    const { fake, timer, timerTotal, profiler } = setup();
    profiler.beginFrame();
    const frameId = profiler.currentFrameId;
    for (const pass of ["sky", "opaque", "transparent"]) {
      timer.begin(pass, frameId);
      timer.end();
    }
    fake.finishQuery(0, 1_000_000);
    fake.finishQuery(1, 6_000_000);
    timer.poll();
    expect(timerTotal("gpu.frame")).toBeUndefined();
    expect(timerTotal("gpu.pass.opaque")).toBe(6);

    fake.finishQuery(2, 2_000_000);
    timer.poll();
    expect(timerTotal("gpu.frame")).toBe(9);
  });

  test("does not report a frame total when one of its passes was dropped", () => {
    const { fake, timer, timerTotal } = setup({ maxInFlightQueries: 1 });
    timer.begin("sky", 1);
    timer.end();
    timer.begin("opaque", 1);
    timer.end();
    fake.finishQuery(0, 1_000_000);
    timer.poll();

    expect(timerTotal("gpu.pass.sky")).toBe(1);
    expect(timerTotal("gpu.frame")).toBeUndefined();
  });

  test("falls back to a finish-based estimate only when requested", () => {
    const requested = setup({ hasTimerExtension: false, requestSyncEstimate: true });
    expect(requested.timer.supported).toBe(false);
    expect(requested.timer.mode).toBe("finish-sync-estimate");
    requested.timer.begin("scene", 1);
    requested.timer.end();
    expect(requested.fake.gl.calls.some((call) => call.name === "finish")).toBe(true);
    expect(requested.timerTotal("gpu.pass.scene.syncEstimate")).toBeDefined();

    const notRequested = setup({ hasTimerExtension: false });
    expect(notRequested.timer.mode).toBe("none");
    notRequested.timer.begin("scene", 1);
    notRequested.timer.end();
    expect(notRequested.fake.gl.calls.length).toBe(0);
  });

  test("adds passes measured outside the scene render into the same frame total, once the frame is over", () => {
    const { fake, timer, timerTotal, profiler } = setup();
    profiler.beginFrame();
    const frameId = profiler.currentFrameId;
    for (const label of ["shadowCascade0", "scene", "bloom"]) {
      expect(timer.begin(label, frameId)).toBe(true);
      timer.end();
    }
    fake.finishQuery(0, 2_000_000);
    fake.finishQuery(1, 5_000_000);
    fake.finishQuery(2, 1_500_000);

    timer.poll(frameId);
    expect(timerTotal("gpu.frame")).toBeUndefined();

    timer.poll(frameId + 1);
    expect(timerTotal("gpu.frame")).toBe(8.5);
    expect(timerTotal("gpu.pass.shadowCascade0")).toBe(2);
    expect(timerTotal("gpu.pass.bloom")).toBe(1.5);
  });

  test("reports that a nested begin did not start so the caller leaves the outer query running", () => {
    const { timer } = setup();
    expect(timer.begin("scene", 1)).toBe(true);
    expect(timer.begin("bloom", 1)).toBe(false);
  });
});
