import {
  estimateTransferBytes,
  ingestWorkerTask,
  profiler,
  type WorkerTaskRecord,
} from "./profiler";
import type { WorkerResponseMessage } from "./profiler/worker-recorder";

const WARM_UP_MESSAGE_ID = -1;

export interface WorkerRequest {
  params: any[];
  /** Buffers the worker takes ownership of instead of copying. */
  transfer?: Transferable[];
}

interface QueuedTask {
  method: string;
  /** Built when a worker is free, so it reads the newest state. Returns null to skip the task. */
  buildRequest: () => WorkerRequest | null;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  onProgress?: (fraction: number) => void;
  /** Tasks sharing a key prefer the same worker, so it can reuse state cached from earlier tasks. */
  affinityKey?: number;
  enqueuedAtMs: number;
  queueDepthAtEnqueue: number;
}

export interface ExecOptions {
  affinityKey?: number;
}

/** 4 measured best filling radius 8 to 12 (15-17 s, against 21 s at 3); 6 and 8 rebuilt more base terrain per column. */
export const AFFINITY_TILE_SIZE_IN_CHUNKS = 4;

/**
 * Groups chunk columns into square tiles that share a worker, so the neighbor terrain that decoration needs is
 * cached once per tile instead of once per worker; vertical neighbours share a key.
 */
export function chunkColumnAffinityKey(chunkX: number, chunkZ: number): number {
  const tileX = Math.floor(chunkX / AFFINITY_TILE_SIZE_IN_CHUNKS);
  const tileZ = Math.floor(chunkZ / AFFINITY_TILE_SIZE_IN_CHUNKS);
  return tileX + tileZ * 2;
}

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function currentEpochMs() {
  return performance.timeOrigin + performance.now();
}

export class WorkerPool {
  private workers: Worker[] = [];
  private queue: QueuedTask[] = [];
  private activeWorkers: Map<
    Worker,
    {
      resolve: (value: any) => void;
      reject: (reason: any) => void;
      onProgress?: (fraction: number) => void;
      id: number;
      method: string;
      isProfiled: boolean;
      workerTrackName: string;
      enqueuedAtMs: number;
      queueDepthAtEnqueue: number;
      dispatchedAtMs: number;
      postedToWorkerAtEpochMs: number;
      paramBytes: number;
    }
  > = new Map();
  private recordsAwaitingResultTail: Map<number, WorkerTaskRecord> = new Map();
  private workersAwaitingWarmUp: Map<Worker, () => void> = new Map();
  private workerReadiness: Map<Worker, Promise<void>> = new Map();
  private workerFactory: () => Worker;
  private maxWorkers: number;
  private currentId = 0;
  private name: string;

  constructor(workerFactory: () => Worker, maxWorkers: number, name = "pool") {
    this.workerFactory = workerFactory;
    this.maxWorkers = maxWorkers;
    this.name = name;
    profiler.registerWorkerPool(name, maxWorkers);
  }

  exec(
    method: string,
    params: any[],
    onProgress?: (fraction: number) => void,
    options?: ExecOptions,
  ): Promise<any> {
    return this.enqueue(method, () => ({ params }), onProgress, options?.affinityKey);
  }

  /**
   * Queues work whose parameters are built just before it runs, so it reads the
   * newest state however long it waited. Resolves to null when buildRequest
   * returns null.
   */
  execLazy(
    method: string,
    buildRequest: () => WorkerRequest | null,
    options?: ExecOptions,
  ): Promise<any> {
    return this.enqueue(method, buildRequest, undefined, options?.affinityKey);
  }

  private enqueue(
    method: string,
    buildRequest: () => WorkerRequest | null,
    onProgress?: (fraction: number) => void,
    affinityKey?: number,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const isProfiling = profiler.enabled;
      this.queue.push({
        method,
        buildRequest,
        resolve,
        reject,
        onProgress,
        affinityKey,
        enqueuedAtMs: isProfiling ? performance.now() : 0,
        queueDepthAtEnqueue: this.countTasksWaitingForWorker(),
      });
      this.processQueue();
    });
  }

  /**
   * Spawns every worker up front and resolves once each has loaded its
   * script, calling onWorkerReady as each one comes online.
   */
  warmUp(onWorkerReady?: () => void): Promise<void> {
    while (this.workers.length < this.maxWorkers) this.spawnWorker();
    const warmUps = this.workers.map((worker) => {
      let readiness = this.workerReadiness.get(worker);
      if (!readiness) {
        readiness = new Promise<void>((resolve) => {
          this.workersAwaitingWarmUp.set(worker, resolve);
          worker.postMessage({ id: WARM_UP_MESSAGE_ID, method: "ping" });
        });
        this.workerReadiness.set(worker, readiness);
      }
      return readiness.then(() => onWorkerReady?.());
    });
    return Promise.all(warmUps).then(() => undefined);
  }

  /** Tasks already waiting, plus this one when every worker is busy. */
  private countTasksWaitingForWorker(): number {
    const isWorkerAvailable = this.activeWorkers.size < this.maxWorkers;
    return this.queue.length + (isWorkerAvailable ? 0 : 1);
  }

  private spawnWorker(): Worker {
    const worker = this.workerFactory();
    worker.onmessage = (event) => this.handleMessage(worker, event);
    worker.onerror = (error) => this.handleError(worker, error);
    this.workers.push(worker);
    return worker;
  }

  private processQueue() {
    while (this.queue.length > 0) {
      if (this.workers.length < this.maxWorkers) {
        this.spawnWorker();
      }
      // A task's preferred worker must exist before it can be matched, so affinity tasks spawn the whole pool.
      if (this.queue.some((queued) => queued.affinityKey !== undefined)) {
        while (this.workers.length < this.maxWorkers) this.spawnWorker();
      }

      const idleWorkers = this.workers.filter((worker) => !this.activeWorkers.has(worker));
      if (idleWorkers.length === 0) return;
      let chosenWorker = idleWorkers[0]!;
      let taskIndex = -1;
      for (const worker of idleWorkers) {
        taskIndex = this.indexOfOwnTask(worker);
        if (taskIndex !== -1) {
          chosenWorker = worker;
          break;
        }
      }
      const task = this.queue.splice(Math.max(taskIndex, 0), 1)[0]!;
      const request = task.buildRequest();
      if (!request) {
        task.resolve(null);
        continue;
      }
      this.dispatch(chosenWorker, task, request);
    }
  }

  /**
   * The oldest task that prefers this worker or has no preference, or -1. An idle worker with nothing of its own
   * takes the oldest task of a busy worker instead of idling (processQueue falls back to index 0).
   */
  private indexOfOwnTask(worker: Worker): number {
    const workerIndex = this.workers.indexOf(worker);
    return this.queue.findIndex(
      (queued) =>
        queued.affinityKey === undefined ||
        mod(queued.affinityKey, this.maxWorkers) === workerIndex,
    );
  }

  private dispatch(worker: Worker, task: QueuedTask, request: WorkerRequest) {
    const id = this.currentId++;
    const isProfiled = profiler.enabled;
    const dispatchedAtMs = isProfiled ? performance.now() : 0;
    const paramBytes = isProfiled ? estimateTransferBytes(request.params) : 0;
    const activeTask = {
      resolve: task.resolve,
      reject: task.reject,
      onProgress: task.onProgress,
      id,
      method: task.method,
      isProfiled,
      workerTrackName: `${this.name} worker ${this.workers.indexOf(worker)}`,
      enqueuedAtMs: task.enqueuedAtMs || dispatchedAtMs,
      queueDepthAtEnqueue: task.queueDepthAtEnqueue,
      dispatchedAtMs,
      postedToWorkerAtEpochMs: 0,
      paramBytes,
    };
    this.activeWorkers.set(worker, activeTask);
    const transfer = request.transfer ?? [];
    if (isProfiled) {
      const postScope = profiler.begin(
        `main.workerPost.${this.name}.${task.method}`,
      );
      worker.postMessage(
        {
          id,
          method: task.method,
          params: request.params,
          profile: true,
          trace: profiler.isTracing,
        },
        transfer,
      );
      profiler.end(postScope);
      activeTask.postedToWorkerAtEpochMs = currentEpochMs();
    } else {
      worker.postMessage(
        { id, method: task.method, params: request.params },
        transfer,
      );
    }
  }

  private handleMessage(worker: Worker, event: MessageEvent) {
    const { id, result, error, progress, profile, resultTail } =
      event.data as WorkerResponseMessage;

    if (id === WARM_UP_MESSAGE_ID) {
      this.workersAwaitingWarmUp.get(worker)?.();
      this.workersAwaitingWarmUp.delete(worker);
      return;
    }

    if (resultTail) {
      this.finishRecordWithResultTail(id, resultTail.resultPostMs);
      return;
    }

    const task = this.activeWorkers.get(worker);

    if (task && task.id === id && progress !== undefined) {
      task.onProgress?.(progress);
      return;
    }

    if (task && task.id === id) {
      const receivedFromWorkerAtEpochMs = task.isProfiled ? currentEpochMs() : 0;
      const resultScope = task.isProfiled
        ? profiler.begin(`main.workerResult.${this.name}.${task.method}`)
        : 0;
      this.activeWorkers.delete(worker);
      if (error) {
        task.reject(error);
      } else {
        task.resolve(result);
      }
      this.processQueue();
      profiler.end(resultScope);

      if (task.isProfiled) {
        const record: WorkerTaskRecord = {
          poolName: this.name,
          method: task.method,
          enqueuedAtMs: task.enqueuedAtMs,
          dispatchedAtMs: task.dispatchedAtMs,
          completedAtMs: performance.now(),
          postedToWorkerAtEpochMs: task.postedToWorkerAtEpochMs,
          receivedFromWorkerAtEpochMs,
          paramBytes: task.paramBytes,
          resultBytes: error ? 0 : estimateTransferBytes(result),
          failed: Boolean(error),
          queueDepthAtEnqueue: task.queueDepthAtEnqueue,
          workerProfile: profile ?? null,
          workerResultPostMs: null,
          workerTrackName: task.workerTrackName,
        };
        const isTailExpected = profile && !error;
        if (isTailExpected) {
          this.recordsAwaitingResultTail.set(id, record);
        } else {
          ingestWorkerTask(profiler, record);
        }
      }
    }
  }

  private finishRecordWithResultTail(taskId: number, resultPostMs: number) {
    const record = this.recordsAwaitingResultTail.get(taskId);
    if (!record) return;
    this.recordsAwaitingResultTail.delete(taskId);
    record.workerResultPostMs = resultPostMs;
    ingestWorkerTask(profiler, record);
  }

  private flushRecordsAwaitingResultTail() {
    this.recordsAwaitingResultTail.forEach((record) =>
      ingestWorkerTask(profiler, record),
    );
    this.recordsAwaitingResultTail.clear();
  }

  private handleError(worker: Worker, error: ErrorEvent) {
    const task = this.activeWorkers.get(worker);
    if (task) {
      this.activeWorkers.delete(worker);
      task.reject(error);
      if (task.isProfiled) {
        ingestWorkerTask(profiler, {
          poolName: this.name,
          method: task.method,
          enqueuedAtMs: task.enqueuedAtMs,
          dispatchedAtMs: task.dispatchedAtMs,
          completedAtMs: performance.now(),
          postedToWorkerAtEpochMs: task.postedToWorkerAtEpochMs,
          receivedFromWorkerAtEpochMs: currentEpochMs(),
          paramBytes: task.paramBytes,
          resultBytes: 0,
          failed: true,
          queueDepthAtEnqueue: task.queueDepthAtEnqueue,
          workerProfile: null,
          workerResultPostMs: null,
        });
      }
      this.processQueue();
    }
  }

  terminate() {
    this.flushRecordsAwaitingResultTail();
    this.workers.forEach((w) => w.terminate());
    this.workers = [];
    this.activeWorkers.clear();
    this.workersAwaitingWarmUp.clear();
    this.workerReadiness.clear();
    this.queue = [];
  }
}
