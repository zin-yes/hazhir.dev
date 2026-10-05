import { describe, expect, test } from "bun:test";
import { computeSkyState } from "./sky-state";

const luminance = (color: [number, number, number]) => 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];

describe("computeSkyState", () => {
  test("noon is bright with the sun overhead and no stars, midnight is dark with stars", () => {
    const noon = computeSkyState(0.5, 0, 0);
    const midnight = computeSkyState(0, 0, 0);
    expect(noon.sunDirection[1]).toBeGreaterThan(0.9);
    expect(noon.daylight).toBe(1);
    expect(noon.starVisibility).toBe(0);
    expect(midnight.sunDirection[1]).toBeLessThan(-0.9);
    expect(midnight.daylight).toBe(0);
    expect(midnight.starVisibility).toBe(1);
    expect(luminance(noon.zenithColor)).toBeGreaterThan(luminance(midnight.zenithColor) * 20);
  });

  test("the sun rises in the east and sets in the west", () => {
    expect(computeSkyState(0.3, 0, 0).sunDirection[0]).toBeGreaterThan(0);
    expect(computeSkyState(0.7, 0, 0).sunDirection[0]).toBeLessThan(0);
  });

  test("the moon is always opposite the sun", () => {
    const state = computeSkyState(0.37, 0, 0);
    expect(state.moonDirection[1]).toBeCloseTo(-state.sunDirection[1], 10);
  });

  test("daylight and the sky colours change smoothly through the whole day", () => {
    let previous = computeSkyState(0, 0, 0);
    for (let step = 1; step <= 2000; step++) {
      const state = computeSkyState(step / 2000, 0, 0);
      expect(Math.abs(state.daylight - previous.daylight)).toBeLessThan(0.03);
      expect(Math.abs(luminance(state.horizonColor) - luminance(previous.horizonColor))).toBeLessThan(0.02);
      previous = state;
    }
  });

  test("sunset warms the horizon: red outweighs blue where noon is bluer", () => {
    const sunset = computeSkyState(0.755, 0, 0);
    const noon = computeSkyState(0.5, 0, 0);
    expect(sunset.horizonColor[0]).toBeGreaterThan(sunset.horizonColor[2]);
    expect(noon.horizonColor[2]).toBeGreaterThan(noon.horizonColor[0]);
  });

  test("overcast greys and dims the day and hides the stars", () => {
    const clear = computeSkyState(0.5, 0, 0);
    const overcast = computeSkyState(0.5, 0, 1);
    expect(overcast.daylight).toBeLessThan(clear.daylight);
    expect(luminance(overcast.horizonColor)).toBeLessThan(luminance(clear.horizonColor));
    const spread = (color: [number, number, number]) => Math.max(...color) - Math.min(...color);
    expect(spread(overcast.zenithColor)).toBeLessThan(spread(clear.zenithColor));
    expect(computeSkyState(0, 0, 1).starVisibility).toBe(0);
  });

  test("the moon phase cycles through eight phases from full", () => {
    expect(computeSkyState(0, 0, 0).moonPhaseAngle).toBe(0);
    expect(computeSkyState(0, 4, 0).moonPhaseAngle).toBeCloseTo(Math.PI, 10);
    expect(computeSkyState(0, 8, 0).moonPhaseAngle).toBe(0);
  });
});
