import { describe, expect, test } from "bun:test";
import { RollingStat } from "./rolling-stat";

describe("RollingStat", () => {
  test("summarises count, mean, extremes and percentiles of a skewed series", () => {
    const stat = new RollingStat();
    for (let value = 1; value <= 100; value++) stat.add(value, 1000);
    stat.add(1000, 1000);

    const summary = stat.summary(1000);
    expect(summary.count).toBe(101);
    expect(summary.min).toBe(1);
    expect(summary.max).toBe(1000);
    expect(summary.p50).toBe(51);
    expect(summary.p95).toBeGreaterThanOrEqual(95);
    expect(summary.p99).toBeLessThan(1000);
    expect(summary.mean).toBeCloseTo((5050 + 1000) / 101, 5);
  });

  test("percentiles only see the most recent samples once the ring wraps", () => {
    const stat = new RollingStat(10);
    for (let index = 0; index < 10; index++) stat.add(1000, 0);
    for (let index = 0; index < 10; index++) stat.add(1, 0);

    const summary = stat.summary(0);
    expect(summary.count).toBe(20);
    expect(summary.p99).toBe(1);
    expect(summary.max).toBe(1000);
  });

  test("reports the per-second rate from completed seconds, not the partial one", () => {
    const stat = new RollingStat();
    for (let index = 0; index < 4; index++) stat.add(10, 1000 + index);
    for (let index = 0; index < 2; index++) stat.add(10, 2000 + index);
    stat.add(10, 3000);

    const summary = stat.summary(3000);
    expect(summary.perSecondHistory).toEqual([40, 20]);
    expect(summary.recentPerSecondTotal).toBe(30);
    expect(summary.recentPerSecondCount).toBe(3);
  });

  test("idle seconds count as zero so a stalled metric's rate decays", () => {
    const stat = new RollingStat();
    stat.add(100, 1000);
    const summary = stat.summary(6000);

    expect(summary.perSecondHistory).toEqual([100, 0, 0, 0, 0]);
    expect(summary.recentPerSecondTotal).toBe(20);
  });

  test("keeps at most sixty seconds of history", () => {
    const stat = new RollingStat();
    for (let second = 0; second < 90; second++) stat.add(1, second * 1000);
    expect(stat.summary(90_000).perSecondHistory.length).toBe(60);
  });
});
