// One priority queue per worker, for work that runs faster on the worker that did its neighbors (worldgen caches
// the terrain around each column). A key always lands in the queue of its preferred worker; a worker takes the
// best entry of another worker's queue when its own is empty, or when its own best is more than
// maxPriorityGapForAffinity behind, so near work never waits on a busy worker while far work runs.

import { PriorityScheduler } from "./priority-scheduler";

export class AffinityQueues {
  private readonly queues: PriorityScheduler<number>[];

  constructor(
    readonly workerCount: number,
    private readonly preferredWorkerOf: (key: number) => number,
    private readonly maxPriorityGapForAffinity = Number.POSITIVE_INFINITY,
  ) {
    this.queues = Array.from({ length: workerCount }, () => new PriorityScheduler<number>());
  }

  get size(): number {
    let total = 0;
    for (const queue of this.queues) total += queue.size;
    return total;
  }

  queuedFor(workerIndex: number): number {
    return this.queues[workerIndex]!.size;
  }

  has(key: number): boolean {
    return this.queueOf(key).has(key);
  }

  schedule(key: number, priority: number): void {
    this.queueOf(key).schedule(key, key, priority);
  }

  remove(key: number): boolean {
    return this.queueOf(key).remove(key);
  }

  reprioritizeAll(computePriority: (key: number) => number): void {
    for (const queue of this.queues) queue.reprioritizeAll((key) => computePriority(key));
  }

  /** The best key for this worker: its own queue first, unless another queue holds much more urgent work. */
  takeFor(workerIndex: number): number | undefined {
    const ownQueue = this.queues[workerIndex]!;
    let bestQueue: PriorityScheduler<number> | undefined;
    let bestPriority = Number.POSITIVE_INFINITY;
    for (const queue of this.queues) {
      const priority = queue.peekPriority();
      if (priority !== undefined && priority < bestPriority) {
        bestPriority = priority;
        bestQueue = queue;
      }
    }
    const ownPriority = ownQueue.peekPriority();
    if (ownPriority !== undefined && ownPriority - bestPriority <= this.maxPriorityGapForAffinity) {
      return ownQueue.pop();
    }
    return bestQueue?.pop();
  }

  clear(): void {
    for (const queue of this.queues) queue.clear();
  }

  private queueOf(key: number): PriorityScheduler<number> {
    const workerIndex = this.preferredWorkerOf(key);
    return this.queues[((workerIndex % this.workerCount) + this.workerCount) % this.workerCount]!;
  }
}
