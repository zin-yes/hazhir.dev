import { describe, expect, test } from "bun:test";
import { describeHeapChange, describeLongAnimationFrame } from "./browser-observers";

describe("describeHeapChange", () => {
  test("reads a large drop as garbage collection and counts the freed bytes", () => {
    const change = describeHeapChange(80 * 1048576, 60 * 1048576);
    expect(change.isGcLikely).toBe(true);
    expect(change.freedBytes).toBe(20 * 1048576);
    expect(change.allocatedBytes).toBe(0);
  });

  test("ignores quantization-sized dips and counts growth as allocation", () => {
    const dip = describeHeapChange(50_000_000, 49_800_000);
    expect(dip.isGcLikely).toBe(false);
    expect(dip.allocatedBytes).toBe(0);

    const growth = describeHeapChange(50_000_000, 53_000_000);
    expect(growth.allocatedBytes).toBe(3_000_000);
    expect(growth.isGcLikely).toBe(false);
  });
});

describe("describeLongAnimationFrame", () => {
  test("lists the slowest scripts first with their call site and forced layout time", () => {
    const description = describeLongAnimationFrame({
      duration: 120,
      blockingDuration: 70.4,
      scripts: [
        { invoker: "setInterval", sourceURL: "https://x.dev/_next/static/chunks/game.js", duration: 12 },
        { invoker: "Worker.onmessage", sourceURL: "https://x.dev/_next/static/chunks/pool.js", duration: 55, forcedStyleAndLayoutDuration: 9 },
      ],
    });
    expect(description.startsWith("blocking=70.4ms Worker.onmessage chunks/pool.js 55.0ms forcedStyleLayout=9.0ms")).toBe(true);
    expect(description).toContain("setInterval");
  });

  test("says so when the browser gave no attribution", () => {
    expect(describeLongAnimationFrame({ duration: 80 })).toBe("no script attribution");
  });
});
