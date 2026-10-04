import { describe, expect, test } from "bun:test";
import { createFakeWebGl } from "./fake-webgl.test-helper";
import { createProfiledRender } from "./profiled-render";
import { Profiler } from "./profiler";

function createFakeRenderer(fake: ReturnType<typeof createFakeWebGl>) {
  let renderCount = 0;
  const renderer = {
    getContext: () => fake.asWebGl2(),
    info: {
      autoReset: true,
      reset() {},
      render: { calls: 321, triangles: 9000 },
      memory: { geometries: 40, textures: 1 },
      programs: [{}, {}],
    },
    autoClear: true,
    render() {
      renderCount++;
      (fake.gl as unknown as { drawElements(): void }).drawElements();
    },
  };
  return { renderer, renderCount: () => renderCount };
}

describe("createProfiledRender", () => {
  test("is a plain render call that touches nothing while the profiler is disabled", () => {
    const fake = createFakeWebGl();
    const { renderer, renderCount } = createFakeRenderer(fake);
    const originalDraw = fake.gl.drawElements;
    const profiler = new Profiler();
    const profiled = createProfiledRender(renderer as never, {} as never, {} as never, profiler);

    profiled.render();
    expect(renderCount()).toBe(1);
    expect(fake.gl.drawElements).toBe(originalDraw);
    expect(profiler.snapshot().timers).toEqual([]);
  });

  test("when enabled it times the render, samples renderer.info and unpatches on disable", () => {
    const fake = createFakeWebGl();
    const { renderer } = createFakeRenderer(fake);
    const originalDraw = fake.gl.drawElements;
    const profiler = new Profiler();
    profiler.setEnabled(true);
    const profiled = createProfiledRender(renderer as never, {} as never, {} as never, profiler);

    profiler.beginFrame();
    profiled.render();
    expect(fake.gl.drawElements).not.toBe(originalDraw);

    const snapshot = profiler.snapshot();
    expect(snapshot.timers.find((timer) => timer.name === "main.frame.render")?.count).toBe(1);
    expect(snapshot.gauges.find((gauge) => gauge.name === "gpu.drawCalls")?.last).toBe(321);
    expect(snapshot.gauges.find((gauge) => gauge.name === "gpu.programs")?.last).toBe(2);
    expect(snapshot.counters.find((counter) => counter.name === "gl.calls.drawElements")?.total).toBe(1);
    expect(snapshot.session.gpuTimerMode).toBe("disjoint-timer-query");

    profiler.setEnabled(false);
    expect(fake.gl.drawElements).toBe(originalDraw);
    profiled.dispose();
  });

  test("draws of a pass before the scene count in the frame's draw calls, like three's auto reset would not", () => {
    const fake = createFakeWebGl();
    const info = {
      autoReset: true,
      render: { calls: 0, triangles: 0 },
      memory: { geometries: 0, textures: 0 },
      programs: [],
      reset() {
        info.render.calls = 0;
      },
    };
    const renderer = {
      getContext: () => fake.asWebGl2(),
      info,
      autoClear: false,
      render() {
        if (info.autoReset) info.reset();
        info.render.calls += 10;
      },
    };
    const profiler = new Profiler();
    profiler.setEnabled(true);
    const profiled = createProfiledRender(renderer as never, {} as never, {} as never, profiler);

    profiler.beginFrame();
    profiled.render(() => renderer.render());
    expect(profiler.snapshot().gauges.find((gauge) => gauge.name === "gpu.drawCalls")?.last).toBe(20);
    expect(info.autoReset).toBe(true);
    profiled.dispose();
  });
});
