import type { TimerSummary } from "./types";

export const FRAME_BUDGET_MILLISECONDS = 16.7;
const FRAMES_PER_SECOND_BUDGET = 60;
const BYTES_PER_MEGABYTE = 1024 * 1024;
/** Main-thread or GPU milliseconds available per wall second at 60 fps. */
export const BUDGET_MILLISECONDS_PER_SECOND =
  FRAME_BUDGET_MILLISECONDS * FRAMES_PER_SECOND_BUDGET;

/**
 * Self milliseconds per wall second for a main-thread scope. Timers only keep
 * lifetime self time, so the recent inclusive rate is scaled by the lifetime
 * self-to-inclusive ratio. Exact for scopes whose nesting does not change.
 */
export function estimateSelfMillisecondsPerSecond(timer: TimerSummary): number {
  if (timer.total <= 0) return 0;
  const selfFraction = Math.min(1, timer.selfTotal / timer.total);
  return timer.recentPerSecondTotal * selfFraction;
}

export function budgetSharePercent(millisecondsPerSecond: number): number {
  return (millisecondsPerSecond / BUDGET_MILLISECONDS_PER_SECOND) * 100;
}

/**
 * Estimated main-thread cost of receiving cloned worker results. The browser
 * deserializes before onmessage fires, so it is invisible to scopes; it is
 * derived from the calibrated structuredClone throughput.
 */
export function estimateReceiveCloneMillisecondsPerSecond(
  resultBytesPerSecond: number,
  structuredCloneMegabytesPerSecond: number | null,
): number | null {
  if (!structuredCloneMegabytesPerSecond || structuredCloneMegabytesPerSecond <= 0) return null;
  return (resultBytesPerSecond / (structuredCloneMegabytesPerSecond * BYTES_PER_MEGABYTE)) * 1000;
}
