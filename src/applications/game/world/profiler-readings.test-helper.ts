// Reads back what the game profiler recorded while a test ran with it enabled.

import { profiler } from "../profiler";

/** Runs with a freshly reset, enabled profiler and always switches it off again. */
export function withEnabledProfiler<Result>(run: () => Result): Result {
  profiler.setEnabled(true);
  profiler.reset("test");
  try {
    return run();
  } finally {
    profiler.setEnabled(false);
  }
}

/** Same as withEnabledProfiler for work that awaits. */
export async function withEnabledProfilerAsync(run: () => Promise<void>): Promise<void> {
  profiler.setEnabled(true);
  profiler.reset("test");
  try {
    await run();
  } finally {
    profiler.setEnabled(false);
  }
}

export function counterTotal(name: string): number {
  return profiler.snapshot().counters.find((counter) => counter.name === name)?.total ?? 0;
}

export function gaugeMax(name: string): number | undefined {
  return profiler.snapshot().gauges.find((gauge) => gauge.name === name)?.max;
}

export function gaugeLast(name: string): number | undefined {
  return profiler.snapshot().gauges.find((gauge) => gauge.name === name)?.last;
}

export function timerCallCount(name: string): number {
  return profiler.snapshot().timers.find((timer) => timer.name === name)?.count ?? 0;
}

export function byteTotal(name: string): number {
  return profiler.snapshot().bytes.find((meter) => meter.name === name)?.total ?? 0;
}

export function breakdownUnits(dimension: string, key: string): number {
  const summary = profiler.snapshot().breakdowns.find((candidate) => candidate.dimension === dimension);
  return summary?.entries.find((entry) => entry.key === key)?.units ?? 0;
}
