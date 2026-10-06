import { describe, expect, test } from "bun:test";
import {
  BRUSH_MAXIMUM_RADIUS,
  brushCenterFor,
  brushModeFor,
  clampBrushRadius,
  hasDragMovedEnough,
  steppedBrushRadius,
} from "./sphere-brush";
import { counterTotal, withEnabledProfiler } from "../world/profiler-readings.test-helper";

describe("sphere brush rules", () => {
  test("radius stays within 1..64 through steps, wheel deltas and junk input", () => {
    const startedAt = performance.now();
    let radius = 6;
    for (let press = 0; press < 30; press++) radius = steppedBrushRadius(radius, 1);
    expect(radius).toBe(BRUSH_MAXIMUM_RADIUS);
    for (let press = 0; press < 30; press++) radius = steppedBrushRadius(radius, -1);
    expect(radius).toBe(1);
    expect(clampBrushRadius(200)).toBe(64);
    expect(clampBrushRadius(-3)).toBe(1);
    expect(clampBrushRadius(Number.NaN)).toBe(6);
    console.log(`brush radius test: ${(performance.now() - startedAt).toFixed(2)} ms`);
  });

  test("ctrl repaints solids only, alt fills air only, erasing ignores both", () => {
    expect(brushModeFor("paint", { replaceOnly: false, airOnly: false })).toBe("fill");
    expect(brushModeFor("paint", { replaceOnly: true, airOnly: false })).toBe("replaceNonAirOnly");
    expect(brushModeFor("paint", { replaceOnly: false, airOnly: true })).toBe("fillAirOnly");
    expect(brushModeFor("erase", { replaceOnly: true, airOnly: true })).toBe("erase");
  });

  test("erase centers on the hit block, paint on the block in front of the hit face, a miss in front of the camera", () => {
    const hit = { cell: [10, 64, -3] as const, faceNormal: [0, 1, 0] as const };
    const camera = { x: 0.2, y: 70, z: -0.4 };
    const forward = { x: 0, y: 0, z: -1 };
    expect(brushCenterFor("erase", hit, camera, forward)).toEqual({ x: 10, y: 64, z: -3 });
    expect(brushCenterFor("paint", hit, camera, forward)).toEqual({ x: 10, y: 65, z: -3 });
    expect(brushCenterFor("paint", null, camera, forward, 24)).toEqual({ x: 0, y: 70, z: -24 });
  });

  test("a drag paints again only after moving a quarter of the radius", () => {
    const start = { x: 0, y: 0, z: 0 };
    expect(hasDragMovedEnough(null, start, 16)).toBe(true);
    expect(hasDragMovedEnough(start, { x: 3, y: 0, z: 0 }, 16)).toBe(false);
    expect(hasDragMovedEnough(start, { x: 4, y: 0, z: 0 }, 16)).toBe(true);
    expect(hasDragMovedEnough(start, start, 1)).toBe(false);
    expect(hasDragMovedEnough(start, { x: 1, y: 0, z: 0 }, 1)).toBe(true);
  });
});

describe("sphere brush profiling", () => {
  test("counts clamps, modes, centers and drag decisions", () => {
    withEnabledProfiler(() => {
      clampBrushRadius(200);
      clampBrushRadius(3.4);
      clampBrushRadius(Number.NaN);
      clampBrushRadius(10);
      expect(counterTotal("game.brush.radiusClamped")).toBe(1);
      expect(counterTotal("game.brush.radiusRounded")).toBe(1);
      expect(counterTotal("game.brush.radiusNotFinite")).toBe(1);

      brushModeFor("paint", { replaceOnly: false, airOnly: true });
      brushModeFor("erase", { replaceOnly: true, airOnly: true });
      brushModeFor("erase", { replaceOnly: false, airOnly: false });
      expect(counterTotal("game.brush.mode.erase")).toBe(2);
      expect(counterTotal("game.brush.mode.fillAirOnly")).toBe(1);

      const hit = { cell: [10, 64, -3] as const, faceNormal: [0, 1, 0] as const };
      const camera = { x: 0, y: 70, z: 0 };
      const forward = { x: 0, y: 0, z: -1 };
      brushCenterFor("erase", hit, camera, forward);
      brushCenterFor("paint", hit, camera, forward);
      brushCenterFor("paint", null, camera, forward);
      expect(counterTotal("game.brush.centerOnHitBlock")).toBe(1);
      expect(counterTotal("game.brush.centerBesideHitFace")).toBe(1);
      expect(counterTotal("game.brush.centerInFrontOfCamera")).toBe(1);

      const start = { x: 0, y: 0, z: 0 };
      hasDragMovedEnough(null, start, 16);
      hasDragMovedEnough(start, { x: 3, y: 0, z: 0 }, 16);
      hasDragMovedEnough(start, { x: 4, y: 0, z: 0 }, 16);
      expect(counterTotal("game.brush.dragFirstPaint")).toBe(1);
      expect(counterTotal("game.brush.dragSkipped")).toBe(1);
      expect(counterTotal("game.brush.dragRepaints")).toBe(1);
    });
  });
});
