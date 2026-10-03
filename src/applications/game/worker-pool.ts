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
  enqueuedAtMs: number;
  queueDepthAtEnqueue: number;
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
  ): Promise<any> {
    return this.enqueue(method, () => ({ params }), onProgress);
  }

  /**
   * Queues work whose parameters are built just before it runs, so it reads the
   * newest state however long it waited. Resolves to null when buildRequest
   * returns null.
   */
  execLazy(
    method: string,
    buildRequest: () => WorkerRequest | null,
  ): Promise<any> {
    return this.enqueue(method, buildRequest);
  }

  private enqueue(
    method: string,
    buildRequest: () => WorkerRequest | null,
    onProgress?: (fraction: number) => void,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const isProfiling = profiler.enabled;
      this.queue.push({
        method,
        buildRequest,
        resolve,
        reject,
        onProgress,
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

      const availableWorker = this.workers.find(
        (w) => !this.activeWorkers.has(w)
      );
      if (!availableWorker) return;

      const task = this.queue.shift()!;
      const request = task.buildRequest();
      if (!request) {
        task.resolve(null);
        continue;
      }
      this.dispatch(availableWorker, task, request);
    }
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
        { id, method: task.method, params: request.params, profile: true },
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
