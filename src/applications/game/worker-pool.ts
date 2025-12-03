export class WorkerPool {
  private workers: Worker[] = [];
  private queue: {
    method: string;
    params: any[];
    resolve: (value: any) => void;
    reject: (reason: any) => void;
  }[] = [];
  private activeWorkers: Map<
    Worker,
    { resolve: (value: any) => void; reject: (reason: any) => void; id: number }
  > = new Map();
  private workerFactory: () => Worker;
  private maxWorkers: number;
  private currentId = 0;

  constructor(workerFactory: () => Worker, maxWorkers: number) {
    this.workerFactory = workerFactory;
    this.maxWorkers = maxWorkers;
  }

  exec(method: string, params: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      this.queue.push({ method, params, resolve, reject });
      this.processQueue();
    });
  }

  private processQueue() {
    if (this.queue.length === 0) return;

    if (this.workers.length < this.maxWorkers) {
      const worker = this.workerFactory();
      worker.onmessage = (event) => this.handleMessage(worker, event);
      worker.onerror = (error) => this.handleError(worker, error);
      this.workers.push(worker);
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
    const { id, result, error } = event.data;
    const task = this.activeWorkers.get(worker);

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
    this.queue = [];
  }
}
