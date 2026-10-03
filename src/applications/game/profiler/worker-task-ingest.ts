import type { Profiler } from "./profiler";
import type { WorkerTaskProfile } from "./worker-recorder";

/** Everything the main thread knows about one finished worker task. */
export interface WorkerTaskRecord {
  poolName: string;
  method: string;
  /** Main-thread performance.now() when the task entered the pool queue. */
  enqueuedAtMs: number;
  /** Main-thread performance.now() just before postMessage to the worker. */
  dispatchedAtMs: number;
  /** Main-thread performance.now() when the result message was handled. */
  completedAtMs: number;
  /** Main-thread epoch milliseconds right after postMessage returned. */
  postedToWorkerAtEpochMs: number;
  /** Main-thread epoch milliseconds when the result message handler started. */
  receivedFromWorkerAtEpochMs: number;
  paramBytes: number;
  resultBytes: number;
  failed: boolean;
  queueDepthAtEnqueue: number;
  workerProfile: WorkerTaskProfile | null;
  /** Worker time spent inside postMessage for the result (structured clone). */
  workerResultPostMs: number | null;
}

/**
 * Turns one worker task record into profiler metrics:
 *   worker.<pool>.<method>.exec / .<section>   worker CPU time
 *   queue.<pool>.<method>.wait                 time waiting for a free worker
 *   latency.<pool>.<method>.roundTrip          enqueue to result handled
 *   transfer.<pool>.<method>.toWorker/toMain/workerSerialize
 *   bytes.<pool>.<method>.params/result        structured-clone payload sizes
 *   work.<pool>.<method>.<counter>             units of work done in the task
 */
export function ingestWorkerTask(profiler: Profiler, record: WorkerTaskRecord) {
  if (!profiler.enabled) return;
  const prefix = `${record.poolName}.${record.method}`;

  profiler.recordTimer(`queue.${prefix}.wait`, record.dispatchedAtMs - record.enqueuedAtMs, "latency");
  profiler.recordTimer(`latency.${prefix}.roundTrip`, record.completedAtMs - record.enqueuedAtMs, "latency");
  profiler.recordBytes(`bytes.${prefix}.params`, record.paramBytes);
  profiler.recordBytes(`bytes.${prefix}.result`, record.resultBytes);
  profiler.sampleGauge(`pool.${record.poolName}.queueDepth`, record.queueDepthAtEnqueue);

  const workerProfile = record.workerProfile;
  if (!workerProfile) {
    profiler.recordPoolTask(record.poolName, record.completedAtMs - record.dispatchedAtMs, record.failed);
    return;
  }

  profiler.recordPoolTask(record.poolName, workerProfile.executionMs, record.failed);
  profiler.recordTimer(`worker.${prefix}.exec`, workerProfile.executionMs, "worker-cpu");
  for (const [sectionName, selfMs] of Object.entries(workerProfile.sectionSelfMs)) {
    profiler.recordTimer(`worker.${prefix}.${sectionName}`, selfMs, "worker-cpu");
  }
  for (const [counterName, amount] of Object.entries(workerProfile.counters)) {
    profiler.addCounter(`work.${prefix}.${counterName}`, amount, "units");
  }

  const toWorkerMs = workerProfile.receivedAtEpochMs - record.postedToWorkerAtEpochMs;
  profiler.recordTimer(`transfer.${prefix}.toWorker`, Math.max(0, toWorkerMs), "transfer");

  if (record.workerResultPostMs !== null) {
    profiler.recordTimer(`transfer.${prefix}.workerSerialize`, record.workerResultPostMs, "transfer");
    const resultPostedAtEpochMs =
      workerProfile.executionFinishedAtEpochMs + record.workerResultPostMs;
    const toMainMs = record.receivedFromWorkerAtEpochMs - resultPostedAtEpochMs;
    profiler.recordTimer(`transfer.${prefix}.toMain`, Math.max(0, toMainMs), "transfer");
  }
}
