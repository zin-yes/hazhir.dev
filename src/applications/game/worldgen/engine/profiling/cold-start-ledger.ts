// Timing of one-off setup work (code generation, data decoding, world construction). These events happen a handful of
// times per thread, usually before anyone turned the profiler on, so they are always recorded in a small ledger and
// reported with the next profiled task. While a worker profile is recording they open a normal section instead, so
// they nest correctly in the call tree. Never use this on a path that runs per column or per block.

import {
  addWorkerCounter,
  endWorkerSection,
  isWorkerProfiling,
  startWorkerSection,
} from "@/applications/game/profiler/worker-recorder";

export interface ColdStartLabel {
  readonly sectionName: string;
  readonly callsCounterName: string;
  readonly unitsCounterName: string;
  readonly deferredCallsCounterName: string;
  readonly deferredMicrosecondsCounterName: string;
  readonly deferredUnitsCounterName: string;
}

const PROFILING_TOKEN = -1;
const MICROSECONDS_PER_MILLISECOND = 1000;

/** `name` becomes the section name `coldStart.<name>` and the counter names `coldStart.<name>.calls` and so on. */
export function defineColdStartLabel(name: string): ColdStartLabel {
  const base = `coldStart.${name}`;
  return {
    sectionName: base,
    callsCounterName: `${base}.calls`,
    unitsCounterName: `${base}.units`,
    deferredCallsCounterName: `${base}.deferred.calls`,
    deferredMicrosecondsCounterName: `${base}.deferred.microseconds`,
    deferredUnitsCounterName: `${base}.deferred.units`,
  };
}

interface LedgerEntry {
  label: ColdStartLabel;
  calls: number;
  totalMilliseconds: number;
  units: number;
}

const pendingEntries = new Map<ColdStartLabel, LedgerEntry>();

/** Opens the timing of a one-off event; pass the result to `endColdStart`. */
export function beginColdStart(label: ColdStartLabel): number {
  if (isWorkerProfiling()) {
    startWorkerSection(label.sectionName);
    return PROFILING_TOKEN;
  }
  return performance.now();
}

/** `units` is whatever size the event produced (nodes compiled, source characters, registry entries). */
export function endColdStart(label: ColdStartLabel, token: number, units = 0): void {
  if (token === PROFILING_TOKEN) {
    endWorkerSection();
    addWorkerCounter(label.callsCounterName, 1);
    if (units > 0) addWorkerCounter(label.unitsCounterName, units);
    return;
  }
  const durationMilliseconds = performance.now() - token;
  let entry = pendingEntries.get(label);
  if (entry === undefined) {
    entry = { label, calls: 0, totalMilliseconds: 0, units: 0 };
    pendingEntries.set(label, entry);
  }
  entry.calls++;
  entry.totalMilliseconds += durationMilliseconds;
  entry.units += units;
}

/** Moves events recorded while no profile was active into the current profile as counters, then forgets them. */
export function flushColdStartLedger(): void {
  if (pendingEntries.size === 0) return;
  for (const entry of pendingEntries.values()) {
    addWorkerCounter(entry.label.deferredCallsCounterName, entry.calls);
    addWorkerCounter(entry.label.deferredMicrosecondsCounterName, Math.round(entry.totalMilliseconds * MICROSECONDS_PER_MILLISECOND));
    if (entry.units > 0) addWorkerCounter(entry.label.deferredUnitsCounterName, entry.units);
  }
  pendingEntries.clear();
}

/** Runs `run` as a cold start event. For setup code that is easiest to express as a callback. */
export function timeColdStart<Result>(label: ColdStartLabel, run: () => Result, units = 0): Result {
  const token = beginColdStart(label);
  try {
    return run();
  } finally {
    endColdStart(label, token, units);
  }
}
