import { describe, expect, test } from "bun:test";
import {
  formatBytes,
  formatBytesPerSecond,
  formatCount,
  formatMilliseconds,
  formatMillisecondsPerSecond,
  formatNanosecondsPerUnit,
  formatPercent,
} from "./format";

describe("profiler formatters", () => {
  test("milliseconds keep useful precision across magnitudes", () => {
    expect(formatMilliseconds(0.456)).toBe("0.46ms");
    expect(formatMilliseconds(16.66)).toBe("16.7ms");
    expect(formatMilliseconds(250.4)).toBe("250ms");
    expect(formatMilliseconds(Number.NaN)).toBe("-");
  });

  test("bytes scale through binary units and keep the sign", () => {
    expect(formatBytes(512)).toBe("512B");
    expect(formatBytes(32768)).toBe("32.0KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.00MB");
    expect(formatBytes(-2048)).toBe("-2.00KB");
    expect(formatBytesPerSecond(1536)).toBe("1.50KB/s");
  });

  test("rates, counts, percents and per-unit costs", () => {
    expect(formatMillisecondsPerSecond(12.34)).toBe("12.3ms/s");
    expect(formatCount(1234567)).toBe("1.23M");
    expect(formatCount(12500)).toBe("12.5k");
    expect(formatPercent(0.425)).toBe("42.5%");
    expect(formatNanosecondsPerUnit(850)).toBe("850ns");
    expect(formatNanosecondsPerUnit(2500)).toBe("2.50us");
  });
});
