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
 * production code. Do not wrap sub-0.1ms operations in sections: browsers
 * clamp performance.now() (typically 100 microseconds), so wrap whole phases
 * and use counters for per-item work.
 */

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
}

export interface WorkerResponseMessage {
  id: number;
  result?: unknown;
  error?: string;
  progress?: number;
  profile?: WorkerTaskProfile;
  resultTail?: WorkerResultTail;
}

interface ActiveSection {
  name: string;
  startedAtMs: number;
  childMs: number;
}

interface ActiveTask {
  receivedAtEpochMs: number;
  executionStartedAtMs: number;
  sections: { [sectionName: string]: number };
  counters: { [counterName: string]: number };
  stack: ActiveSection[];
}

let activeTask: ActiveTask | null = null;

export function workerEpochMs(): number {
  return performance.timeOrigin + performance.now();
}

export function isWorkerProfiling(): boolean {
  return activeTask !== null;
}

export function beginWorkerTask(profilingRequested: boolean) {
  if (!profilingRequested) {
    activeTask = null;
    return;
  }
  activeTask = {
    receivedAtEpochMs: workerEpochMs(),
    executionStartedAtMs: performance.now(),
    sections: {},
    counters: {},
    stack: [],
  };
}

export function startWorkerSection(name: string) {
  if (!activeTask) return;
  activeTask.stack.push({ name, startedAtMs: performance.now(), childMs: 0 });
}

export function endWorkerSection() {
  const task = activeTask;
  if (!task) return;
  const section = task.stack.pop();
  if (!section) return;
  const durationMs = performance.now() - section.startedAtMs;
  task.sections[section.name] =
    (task.sections[section.name] ?? 0) + (durationMs - section.childMs);
  const parent = task.stack[task.stack.length - 1];
  if (parent) parent.childMs += durationMs;
}

export function workerSection<Result>(name: string, run: () => Result): Result {
  if (!activeTask) return run();
  startWorkerSection(name);
  try {
    return run();
  } finally {
    endWorkerSection();
  }
}

export function addWorkerCounter(name: string, amount: number) {
  if (!activeTask) return;
  activeTask.counters[name] = (activeTask.counters[name] ?? 0) + amount;
}

export function finishWorkerTask(): WorkerTaskProfile | null {
  const task = activeTask;
  activeTask = null;
  if (!task) return null;
  const finishedAtMs = performance.now();
  return {
    receivedAtEpochMs: task.receivedAtEpochMs,
    executionStartedAtEpochMs:
      performance.timeOrigin + task.executionStartedAtMs,
    executionFinishedAtEpochMs: performance.timeOrigin + finishedAtMs,
    executionMs: finishedAtMs - task.executionStartedAtMs,
    sectionSelfMs: task.sections,
    counters: task.counters,
  };
}
