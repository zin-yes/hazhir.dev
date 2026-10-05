import { describe, expect, test } from "bun:test";
import { targetFogDensity } from "./fog-weather";
import { MAX_FOG_DENSITY } from "./sky-lighting";

const calmHumidDawn = { humidity: 0.9, weatherShift: -0.2, sunElevation: -0.05 };

describe("targetFogDensity", () => {
  test("a humid calm dawn is foggy, up to the maximum density", () => {
    expect(targetFogDensity(calmHumidDawn)).toBeGreaterThan(MAX_FOG_DENSITY * 0.9);
    expect(targetFogDensity(calmHumidDawn)).toBeLessThanOrEqual(MAX_FOG_DENSITY);
  });

  test("dry biomes never fog, whatever the weather or hour", () => {
    for (const sunElevation of [-0.5, -0.05, 0.2, 0.9]) {
      expect(targetFogDensity({ humidity: 0.1, weatherShift: -0.22, sunElevation })).toBe(0);
    }
  });

  test("the sun burns the fog off by midday", () => {
    const dawn = targetFogDensity({ humidity: 0.7, weatherShift: -0.2, sunElevation: 0 });
    const midday = targetFogDensity({ humidity: 0.7, weatherShift: -0.2, sunElevation: 0.9 });
    expect(midday).toBe(0);
    expect(dawn).toBeGreaterThan(0);
  });

  test("unsettled weather blocks radiation fog", () => {
    expect(targetFogDensity({ ...calmHumidDawn, weatherShift: 0.2, humidity: 0.7 })).toBe(0);
  });

  test("swamp-level humidity keeps a thin mist at noon in unsettled weather", () => {
    const mist = targetFogDensity({ humidity: 0.95, weatherShift: 0.2, sunElevation: 0.9 });
    expect(mist).toBeGreaterThan(0);
    expect(mist).toBeLessThan(MAX_FOG_DENSITY * 0.4);
  });

  test("more humidity never means less fog", () => {
    let previous = 0;
    for (let humidity = 0; humidity <= 1; humidity += 0.05) {
      const density = targetFogDensity({ humidity, weatherShift: -0.1, sunElevation: 0 });
      expect(density).toBeGreaterThanOrEqual(previous);
      previous = density;
    }
  });
});
