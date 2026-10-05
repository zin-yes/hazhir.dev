import { describe, expect, test } from "bun:test";
import { cloudCoverageFor, weatherShiftAt } from "./cloud-weather";
import { WEATHER_SHIFT_RANGE } from "./sky-constants";

describe("cloud weather", () => {
  test("coverage rises with humidity: deserts are mostly clear, jungles mostly overcast", () => {
    expect(cloudCoverageFor(0, 0)).toBeLessThan(0.25);
    expect(cloudCoverageFor(0.9, 0)).toBeGreaterThan(0.6);
    expect(cloudCoverageFor(0.5, 0)).toBeGreaterThan(cloudCoverageFor(0.2, 0));
  });

  test("a weather front can clear a humid sky and cloud over a dry one, within bounds", () => {
    expect(cloudCoverageFor(0.9, -WEATHER_SHIFT_RANGE)).toBeLessThan(cloudCoverageFor(0.9, WEATHER_SHIFT_RANGE));
    expect(cloudCoverageFor(1, 1)).toBe(1);
    expect(cloudCoverageFor(0, -1)).toBe(0);
  });

  test("the weather wanders over time through both clear and unsettled spells, smoothly", () => {
    let lowest = Infinity;
    let highest = -Infinity;
    let previous = weatherShiftAt(0, 7);
    for (let second = 1; second <= 20000; second += 5) {
      const shift = weatherShiftAt(second, 7);
      lowest = Math.min(lowest, shift);
      highest = Math.max(highest, shift);
      expect(Math.abs(shift - previous)).toBeLessThan(0.02);
      previous = shift;
    }
    expect(lowest).toBeLessThan(-WEATHER_SHIFT_RANGE * 0.5);
    expect(highest).toBeGreaterThan(WEATHER_SHIFT_RANGE * 0.5);
  });

  test("different world seeds get different weather", () => {
    const samples = [0, 600, 1200, 1800, 2400];
    const differing = samples.filter((second) => Math.abs(weatherShiftAt(second, 1) - weatherShiftAt(second, 2)) > 0.01);
    expect(differing.length).toBeGreaterThanOrEqual(3);
  });
});
