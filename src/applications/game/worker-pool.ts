const WARM_UP_MESSAGE_ID = -1;

export class WorkerPool {
  private workers: Worker[] = [];
  private queue: {
    method: string;
    params: any[];
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    onProgress?: (fraction: number) => void;
  }[] = [];
  private activeWorkers: Map<
    Worker,
    {
      resolve: (value: any) => void;
      reject: (reason: any) => void;
      onProgress?: (fraction: number) => void;
      id: number;
    }
  > = new Map();
  private workersAwaitingWarmUp: Map<Worker, () => void> = new Map();
  private workerReadiness: Map<Worker, Promise<void>> = new Map();
  private workerFactory: () => Worker;
  private maxWorkers: number;
  private currentId = 0;

  constructor(workerFactory: () => Worker, maxWorkers: number) {
    this.workerFactory = workerFactory;
    this.maxWorkers = maxWorkers;
  }

  exec(
    method: string,
    params: any[],
    onProgress?: (fraction: number) => void,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      this.queue.push({ method, params, resolve, reject, onProgress });
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

  private spawnWorker(): Worker {
    const worker = this.workerFactory();
    worker.onmessage = (event) => this.handleMessage(worker, event);
    worker.onerror = (error) => this.handleError(worker, error);
    this.workers.push(worker);
    return worker;
  }

  private processQueue() {
    if (this.queue.length === 0) return;

    if (this.workers.length < this.maxWorkers) {
      this.spawnWorker();
    }

    const availableWorker = this.workers.find(
      (w) => !this.activeWorkers.has(w)
    );

    if (availableWorker) {
      const task = this.queue.shift();
      if (task) {
        const id = this.currentId++;
        this.activeWorkers.set(availableWorker, {
          resolve: task.resolve,
          reject: task.reject,
          onProgress: task.onProgress,
          id,
        });
        availableWorker.postMessage({
          id,
          method: task.method,
          params: task.params,
        });
      }
    }
  }

  private handleMessage(worker: Worker, event: MessageEvent) {
    const { id, result, error, progress } = event.data;

    if (id === WARM_UP_MESSAGE_ID) {
      this.workersAwaitingWarmUp.get(worker)?.();
      this.workersAwaitingWarmUp.delete(worker);
      return;
    }

    const task = this.activeWorkers.get(worker);

    if (task && task.id === id && progress !== undefined) {
      task.onProgress?.(progress);
      return;
    }

    if (task && task.id === id) {
      this.activeWorkers.delete(worker);
      if (error) {
        task.reject(error);
      } else {
        task.resolve(result);
      }
      this.processQueue();
    }
  }

  private handleError(worker: Worker, error: ErrorEvent) {
    const task = this.activeWorkers.get(worker);
    if (task) {
      this.activeWorkers.delete(worker);
      task.reject(error);
      this.processQueue();
    }
  }

  terminate() {
    this.workers.forEach((w) => w.terminate());
    this.workers = [];
    this.activeWorkers.clear();
    this.workersAwaitingWarmUp.clear();
    this.workerReadiness.clear();
    this.queue = [];
  }
}
