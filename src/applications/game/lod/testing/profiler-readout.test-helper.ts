// Turns the global profiler on for one LOD test and reads its counters, gauges and timers back by name.

import { profiler } from "../../profiler";

export function startLodProfiling(): void {
  profiler.setEnabled(true);
  profiler.reset("lod-test");
}

export function stopLodProfiling(): void {
  profiler.setEnabled(false);
}

export function counterTotal(name: string): number {
  return profiler.snapshot().counters.find((counter) => counter.name === name)?.total ?? 0;
}

export function gaugeLast(name: string): number | undefined {
  return profiler.snapshot().gauges.find((gauge) => gauge.name === name)?.last;
}

export function timerCalls(name: string): number {
  return profiler.snapshot().timers.find((timer) => timer.name === name)?.count ?? 0;
}

export function byteTotal(name: string): number {
  return profiler.snapshot().bytes.find((meter) => meter.name === name)?.total ?? 0;
}
