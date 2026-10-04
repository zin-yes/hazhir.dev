/**
 * Worker-side half of the profiler. Imported by code that runs inside Web
 * Workers, so it must not touch the DOM or the main-thread profiler.
 *
 * Usage inside a worker task:
 *   beginWorkerTask(profilingRequested);
 *   const faces = workerSection("faceLoop", () => buildFaces(...));
 *   addWorkerCounter("facesEmitted", faces);
 *   const profile = finishWorkerTask(); // null when profiling was not requested
 *
 * When profiling is off every call is a cheap no-op, so sections can stay in
 * production code. Browsers clamp performance.now() (typically 100
 * microseconds), so wrap whole phases with workerSection, wrap hot loops that
 * run thousands of times with workerSampledSection (exact call counts, timing
 * on a sample, rest estimated), and use counters for per-item work. Pass a
 * dimension and key to attribute a section to a biome, feature, block, etc.
 */

import { CallTreeRecorder } from "./call-tree-recorder";
import type { BreakdownEntry, CallTreeNode, TraceSpan } from "./types";

export interface WorkerTaskProfile {
  /** Epoch milliseconds when the worker's message handler started. */
  receivedAtEpochMs: number;
  executionStartedAtEpochMs: number;
  executionFinishedAtEpochMs: number;
  executionMs: number;
  /** Self time (excluding nested sections) by section name, in milliseconds. */
  sectionSelfMs: { [sectionName: string]: number };
  /** Units of work done by the task (blocks scanned, faces emitted, ...). */
  counters: { [counterName: string]: number };
  /** Every section as a call tree: calls, inclusive and self time per path. */
  callTree: CallTreeNode[];
  /** Cost grouped by domain key, by dimension (e.g. "worldgen.biome"). */
  breakdowns: { [dimension: string]: BreakdownEntry[] };
  /** Section intervals relative to executionStartedAtEpochMs; present only when tracing. */
  spans?: TraceSpan[];
  droppedSpans?: number;
}

/** Sent by the worker right after a result message has been posted. */
export interface WorkerResultTail {
  resultPostMs: number;
}

export interface WorkerRequestMessage {
  id: number;
  method: string;
  params?: unknown[];
  /** True when the main thread wants a WorkerTaskProfile with the result. */
  profile?: boolean;
  /** True when the profile should also carry timeline spans. */
  trace?: boolean;
}

export interface WorkerResponseMessage {
  id: number;
  result?: unknown;
  error?: string;
  progress?: number;
  profile?: WorkerTaskProfile;
  resultTail?: WorkerResultTail;
}

const MAX_TRACE_SPANS_PER_TASK = 2000;

interface ActiveTask {
  receivedAtEpochMs: number;
  executionStartedAtMs: number;
  recorder: CallTreeRecorder;
  counters: { [counterName: string]: number };
  isTracing: boolean;
}

let activeTask: ActiveTask | null = null;

export function workerEpochMs(): number {
  return performance.timeOrigin + performance.now();
}

export function isWorkerProfiling(): boolean {
  return activeTask !== null;
}

export function beginWorkerTask(profilingRequested: boolean, traceRequested = false) {
  if (!profilingRequested) {
    activeTask = null;
    return;
  }
  const executionStartedAtMs = performance.now();
  activeTask = {
    receivedAtEpochMs: workerEpochMs(),
    executionStartedAtMs,
    recorder: new CallTreeRecorder(() => performance.now(), {
      maxSpans: traceRequested ? MAX_TRACE_SPANS_PER_TASK : 0,
    }),
    counters: {},
    isTracing: traceRequested,
  };
}

/**
 * Opens a section. Pass `dimension` and `key` to also attribute the section's
 * self time to a breakdown, for example ("worldgen.biome", biomeName). Both
 * are plain strings so no object is allocated on the hot path.
 */
export function startWorkerSection(name: string, dimension?: string, key?: string) {
  activeTask?.recorder.begin(name, dimension, key);
}

/**
 * Opens a section on a loop too hot to time on every call (under about 10
 * microseconds per call). Counts every call, times one in `sampleEvery`, and
 * reports the rest as estimates from the running mean.
 */
export function startWorkerSampledSection(
  name: string,
  sampleEvery = 32,
  dimension?: string,
  key?: string,
) {
  activeTask?.recorder.begin(name, dimension, key, sampleEvery);
}

export function endWorkerSection() {
  activeTask?.recorder.end();
}

export function workerSection<Result>(
  name: string,
  run: () => Result,
  dimension?: string,
  key?: string,
): Result {
  const task = activeTask;
  if (!task) return run();
  task.recorder.begin(name, dimension, key);
  try {
    return run();
  } finally {
    task.recorder.end();
  }
}

export function workerSampledSection<Result>(
  name: string,
  run: () => Result,
  sampleEvery = 32,
  dimension?: string,
  key?: string,
): Result {
  const task = activeTask;
  if (!task) return run();
  task.recorder.begin(name, dimension, key, sampleEvery);
  try {
    return run();
  } finally {
    task.recorder.end();
  }
}

export function addWorkerCounter(name: string, amount: number) {
  if (!activeTask) return;
  activeTask.counters[name] = (activeTask.counters[name] ?? 0) + amount;
}

/** Attributes units of work to a breakdown key without timing anything (blocks per type, placements per feature). */
export function addWorkerKeyedUnits(dimension: string, key: string, units: number) {
  activeTask?.recorder.addKeyed(dimension, key, { units });
}

export function finishWorkerTask(): WorkerTaskProfile | null {
  const task = activeTask;
  activeTask = null;
  if (!task) return null;
  task.recorder.endTo(0);
  const finishedAtMs = performance.now();
  const callTree = task.recorder.toCallTree("task", "worker").nodes;

  const sectionSelfMs: { [sectionName: string]: number } = {};
  for (const node of callTree) {
    const leafName = node.path.slice(node.path.lastIndexOf(">") + 1);
    sectionSelfMs[leafName] = (sectionSelfMs[leafName] ?? 0) + node.selfMs;
  }

  const breakdowns: WorkerTaskProfile["breakdowns"] = {};
  for (const summary of task.recorder.toBreakdowns("worker")) {
    breakdowns[summary.dimension] = summary.entries;
  }

  const profile: WorkerTaskProfile = {
    receivedAtEpochMs: task.receivedAtEpochMs,
    executionStartedAtEpochMs: performance.timeOrigin + task.executionStartedAtMs,
    executionFinishedAtEpochMs: performance.timeOrigin + finishedAtMs,
    executionMs: finishedAtMs - task.executionStartedAtMs,
    sectionSelfMs,
    counters: task.counters,
    callTree,
    breakdowns,
  };
  if (task.isTracing) {
    const { spans, droppedSpans } = task.recorder.takeSpans();
    profile.spans = spans;
    profile.droppedSpans = droppedSpans;
  }
  return profile;
}
