import { profiler as gameProfiler } from "./profiler";
import { DIMENSIONS } from "./profiler/dimensions";
import type { Profiler } from "./profiler/profiler";

export const INPUT_KINDS = [
  "keyDown",
  "keyUp",
  "mouseMove",
  "pointerLock",
  "pointerUnlock",
  "touchStart",
  "touchMove",
  "touchEnd",
  "touchCancel",
] as const;
export type InputKind = (typeof INPUT_KINDS)[number];

const NOT_MEASURING = -1;

const INPUT_COUNTER_NAMES = Object.fromEntries(
  INPUT_KINDS.map((kind) => [kind, `game.input.events.${kind}`]),
) as { [kind in InputKind]: string };

/** Call when an input event handler starts. Pass the result to finishInputEventWith. */
export function startInputEventWith(profilerInstance: Profiler): number {
  return profilerInstance.enabled ? profilerInstance.now() : NOT_MEASURING;
}

/** Counts one input event of a kind and credits its handling time to the per-kind breakdown. */
export function finishInputEventWith(
  profilerInstance: Profiler,
  kind: InputKind,
  startedAtMs: number,
) {
  if (startedAtMs === NOT_MEASURING) return;
  profilerInstance.addCounter(INPUT_COUNTER_NAMES[kind]);
  profilerInstance.recordBreakdown(DIMENSIONS.inputKind, kind, {
    calls: 1,
    totalMs: profilerInstance.now() - startedAtMs,
  });
}

export function startInputEvent(): number {
  return startInputEventWith(gameProfiler);
}

export function finishInputEvent(kind: InputKind, startedAtMs: number) {
  finishInputEventWith(gameProfiler, kind, startedAtMs);
}

/** Counts an input event whose handling time is not ours to measure (three.js handles it). */
export function countInputEvent(kind: InputKind) {
  gameProfiler.addCounter(INPUT_COUNTER_NAMES[kind]);
}
