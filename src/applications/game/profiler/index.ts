import { Profiler } from "./profiler";

/** The one profiler instance for the main thread. Disabled until switched on. */
export const profiler = new Profiler();

export { Profiler } from "./profiler";
export { estimateTransferBytes } from "./transfer-size";
export {
  ingestWorkerTask,
  type WorkerTaskRecord,
} from "./worker-task-ingest";
export * from "./types";
