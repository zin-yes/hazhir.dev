import { describe, expect, test } from "bun:test";
import { finishInputEventWith, startInputEventWith } from "./input-profiling";
import { DIMENSIONS } from "./profiler/dimensions";
import { Profiler } from "./profiler/profiler";

describe("input event profiling", () => {
  test("credits count and handling time to the kind that was handled", () => {
    let nowMs = 0;
    const profiler = new Profiler(() => nowMs);
    profiler.setEnabled(true);

    const handle = (kind: "touchMove" | "keyDown", durationMs: number) => {
      const startedAtMs = startInputEventWith(profiler);
      nowMs += durationMs;
      finishInputEventWith(profiler, kind, startedAtMs);
    };
    handle("touchMove", 0.5);
    handle("touchMove", 1.5);
    handle("keyDown", 0.25);

    const snapshot = profiler.snapshot();
    const entries =
      snapshot.breakdowns.find((breakdown) => breakdown.dimension === DIMENSIONS.inputKind)?.entries ?? [];
    const touchMove = entries.find((entry) => entry.key === "touchMove");
    expect(touchMove?.calls).toBe(2);
    expect(touchMove?.totalMs).toBeCloseTo(2, 5);
    expect(entries.find((entry) => entry.key === "keyDown")?.totalMs).toBeCloseTo(0.25, 5);
    const touchMoveCount = snapshot.counters.find((counter) => counter.name === "game.input.events.touchMove");
    expect(touchMoveCount?.total).toBe(2);
  });

  test("an event that started while the profiler was off records nothing", () => {
    const profiler = new Profiler(() => 5);
    const startedAtMs = startInputEventWith(profiler);
    profiler.setEnabled(true);
    finishInputEventWith(profiler, "keyUp", startedAtMs);
    expect(profiler.snapshot().counters.some((counter) => counter.name === "game.input.events.keyUp")).toBe(false);
  });
});
