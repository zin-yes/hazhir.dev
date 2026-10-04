import { describe, expect, test } from "bun:test";
import { Profiler } from "../profiler/profiler";
import { DIMENSIONS } from "../profiler/dimensions";
import { recordSurfaceRender } from "./use-profiled-render";

function createEnabledProfiler() {
  const profiler = new Profiler(() => 1000);
  profiler.setEnabled(true);
  return profiler;
}

describe("recordSurfaceRender", () => {
  test("accumulates render time per surface in a timer and a breakdown", () => {
    const profiler = createEnabledProfiler();
    recordSurfaceRender(profiler, "hotbar", 10, 12.5);
    recordSurfaceRender(profiler, "hotbar", 20, 21.5);
    recordSurfaceRender(profiler, "inventory", 30, 34);

    const snapshot = profiler.snapshot();
    const hotbarTimer = snapshot.timers.find(
      (timer) => timer.name === "main.ui.render.hotbar",
    );
    expect(hotbarTimer?.total).toBeCloseTo(4, 5);
    expect(hotbarTimer?.count).toBe(2);

    const surfaces = snapshot.breakdowns.find(
      (breakdown) => breakdown.dimension === DIMENSIONS.uiSurface,
    );
    const hotbarEntry = surfaces?.entries.find((entry) => entry.key === "hotbar");
    expect(hotbarEntry?.calls).toBe(2);
    expect(hotbarEntry?.totalMs).toBeCloseTo(4, 5);
    expect(surfaces?.entries.some((entry) => entry.key === "inventory")).toBe(true);
  });

  test("records nothing when the render started while profiling was off", () => {
    const profiler = createEnabledProfiler();
    recordSurfaceRender(profiler, "hotbar", -1, 12);
    expect(
      profiler
        .snapshot()
        .timers.some((timer) => timer.name.startsWith("main.ui.render.")),
    ).toBe(false);
  });
});
