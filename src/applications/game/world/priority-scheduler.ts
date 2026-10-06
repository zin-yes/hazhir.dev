// Keyed min-heap scheduler (lowest priority value first, FIFO among equal priorities) with bounded in-flight
// accounting. Feed a worker pool just-in-time: dispatch only while canDispatch(), call completeDispatch() when a
// job finishes, and the pool never holds a long queue that cannot be reordered or cancelled.

import { profiler } from "../profiler";
import { DIMENSIONS } from "../profiler/dimensions";

export interface PrioritySchedulerOptions<T> {
  /** Maximum dispatched-but-uncompleted jobs. Defaults to unbounded. */
  maxInFlight?: number;
  /** Checked lazily when an entry reaches the top; cancelled entries are dropped instead of returned. */
  isCancelled?: (key: number, item: T) => boolean;
  /** Names this queue in the profiler (for example "lighting"); without it the scheduler records nothing. */
  profilerLane?: string;
  /** A second lane that also receives everything this queue records, for a lane made of several queues. */
  profilerRollupLane?: string;
}

interface HeapEntry<T> {
  key: number;
  item: T;
  priority: number;
  sequence: number;
  heapIndex: number;
  /** profiler.now() when the entry first joined the queue, or -1 when it was not measured. */
  enqueuedAtMs: number;
}

const NOT_TIMED = -1;

/** Metric names of one lane, built once so recording never builds strings. */
class SchedulerLaneMetrics {
  readonly lane: string;
  readonly enqueued: string;
  readonly replaced: string;
  readonly dequeued: string;
  readonly dispatched: string;
  readonly completed: string;
  readonly removed: string;
  readonly transferredIn: string;
  readonly transferredOut: string;
  readonly cleared: string;
  readonly cancelledDropped: string;
  readonly cancelChecks: string;
  readonly reprioritized: string;
  readonly reprioritizeMissed: string;
  readonly reprioritizeAllCalls: string;
  readonly reprioritizeAllEntries: string;
  readonly starved: string;
  readonly blockedByInFlight: string;
  readonly waitTimer: string;
  readonly dispatchedPriorityGauge: string;
  readonly reprioritizeAllScope: string;
  readonly heapifyScope: string;
  readonly depthGauge: string;
  readonly depthPeakGauge: string;
  readonly inFlightGauge: string;
  readonly inFlightPeakGauge: string;
  readonly heapMovesCounter: string;

  constructor(lane: string) {
    this.lane = lane;
    this.enqueued = `game.scheduler.${lane}.enqueued`;
    this.replaced = `game.scheduler.${lane}.replaced`;
    this.dequeued = `game.scheduler.${lane}.dequeued`;
    this.dispatched = `game.scheduler.${lane}.dispatched`;
    this.completed = `game.scheduler.${lane}.completed`;
    this.removed = `game.scheduler.${lane}.removed`;
    this.transferredIn = `game.scheduler.${lane}.transferredIn`;
    this.transferredOut = `game.scheduler.${lane}.transferredOut`;
    this.cleared = `game.scheduler.${lane}.cleared`;
    this.cancelledDropped = `game.scheduler.${lane}.cancelledDropped`;
    this.cancelChecks = `game.scheduler.${lane}.cancelChecks`;
    this.reprioritized = `game.scheduler.${lane}.reprioritized`;
    this.reprioritizeMissed = `game.scheduler.${lane}.reprioritizeMissed`;
    this.reprioritizeAllCalls = `game.scheduler.${lane}.reprioritizeAllCalls`;
    this.reprioritizeAllEntries = `game.scheduler.${lane}.reprioritizeAllEntries`;
    this.starved = `game.scheduler.${lane}.starved`;
    this.blockedByInFlight = `game.scheduler.${lane}.blockedByInFlight`;
    this.waitTimer = `latency.scheduler.${lane}.wait`;
    this.dispatchedPriorityGauge = `game.scheduler.${lane}.dispatchedPriority`;
    this.reprioritizeAllScope = `main.scheduler.${lane}.reprioritizeAll`;
    this.heapifyScope = `main.scheduler.${lane}.reprioritizeAll.heapify`;
    this.depthGauge = `queue.scheduler.${lane}.depth`;
    this.depthPeakGauge = `queue.scheduler.${lane}.depthPeak`;
    this.inFlightGauge = `queue.scheduler.${lane}.inFlight`;
    this.inFlightPeakGauge = `queue.scheduler.${lane}.inFlightPeak`;
    this.heapMovesCounter = `game.scheduler.${lane}.heapMoves`;
  }
}

export class PriorityScheduler<T> {
  maxInFlight: number;
  private readonly heap: HeapEntry<T>[] = [];
  private readonly entryByKey = new Map<number, HeapEntry<T>>();
  private readonly isCancelled: ((key: number, item: T) => boolean) | undefined;
  private readonly laneMetrics: SchedulerLaneMetrics[] = [];
  private nextSequence = 0;
  private dispatchedCount = 0;
  private cancelledDropCount = 0;
  private peakDepthSinceSample = 0;
  private peakInFlightSinceSample = 0;
  private heapMovesSinceSample = 0;

  constructor(options: PrioritySchedulerOptions<T> = {}) {
    this.maxInFlight = options.maxInFlight ?? Number.POSITIVE_INFINITY;
    this.isCancelled = options.isCancelled;
    if (options.profilerLane) this.laneMetrics.push(new SchedulerLaneMetrics(options.profilerLane));
    if (options.profilerRollupLane) this.laneMetrics.push(new SchedulerLaneMetrics(options.profilerRollupLane));
  }

  /** Queued entries, including cancelled ones not yet discovered by peek/pop. */
  get size(): number {
    return this.heap.length;
  }

  get inFlightCount(): number {
    return this.dispatchedCount;
  }

  /** How many entries the lazy cancellation predicate has discarded so far. */
  get cancelledEntryCount(): number {
    return this.cancelledDropCount;
  }

  has(key: number): boolean {
    return this.entryByKey.has(key);
  }

  /** The queued item of a key, or undefined when it is not queued. */
  itemOf(key: number): T | undefined {
    return this.entryByKey.get(key)?.item;
  }

  /**
   * Adds the key, or replaces its item and priority while keeping its original arrival order.
   */
  schedule(key: number, item: T, priority: number): void {
    const existingEntry = this.entryByKey.get(key);
    if (existingEntry) {
      existingEntry.item = item;
      this.changePriority(existingEntry, priority);
      this.countOnLanes("replaced", 1);
      return;
    }
    this.insertEntry(key, item, priority, this.measuredNow());
    this.countOnLanes("enqueued", 1);
  }

  /**
   * Moves a queued key to another queue of the same lane, keeping the time it has been waiting so the wait timer
   * still measures the whole queue time. Returns false when the key is not queued here.
   */
  moveTo(key: number, target: PriorityScheduler<T>, priority: number): boolean {
    const entry = this.entryByKey.get(key);
    if (!entry) return false;
    const { item, enqueuedAtMs } = entry;
    this.removeAt(entry.heapIndex);
    this.countOnLanes("transferredOut", 1);
    target.insertEntry(key, item, priority, enqueuedAtMs);
    target.countOnLanes("transferredIn", 1);
    return true;
  }

  private insertEntry(key: number, item: T, priority: number, enqueuedAtMs: number): void {
    const entry: HeapEntry<T> = {
      key,
      item,
      priority,
      sequence: this.nextSequence++,
      heapIndex: this.heap.length,
      enqueuedAtMs,
    };
    this.heap.push(entry);
    this.entryByKey.set(key, entry);
    this.siftUp(entry.heapIndex);
    if (this.heap.length > this.peakDepthSinceSample) this.peakDepthSinceSample = this.heap.length;
  }

  reprioritize(key: number, priority: number): boolean {
    const entry = this.entryByKey.get(key);
    if (!entry) {
      this.countOnLanes("reprioritizeMissed", 1);
      return false;
    }
    this.changePriority(entry, priority);
    this.countOnLanes("reprioritized", 1);
    return true;
  }

  /** Recomputes every queued priority (for example after the camera turned) and rebuilds the heap in O(n). */
  reprioritizeAll(computePriority: (key: number, item: T) => number): void {
    const scopeToken = this.beginLaneScope("reprioritizeAllScope");
    try {
      for (const entry of this.heap) entry.priority = computePriority(entry.key, entry.item);
      const heapifyToken = this.beginLaneScope("heapifyScope");
      for (let index = (this.heap.length >> 1) - 1; index >= 0; index--) this.siftDown(index);
      profiler.end(heapifyToken);
    } finally {
      profiler.end(scopeToken);
    }
    this.countOnLanes("reprioritizeAllCalls", 1);
    this.countOnLanes("reprioritizeAllEntries", this.heap.length);
  }

  remove(key: number): boolean {
    const entry = this.entryByKey.get(key);
    if (!entry) return false;
    this.removeAt(entry.heapIndex);
    this.countOnLanes("removed", 1);
    return true;
  }

  peek(): T | undefined {
    this.discardCancelledTop();
    return this.heap[0]?.item;
  }

  peekPriority(): number | undefined {
    this.discardCancelledTop();
    return this.heap[0]?.priority;
  }

  /** Removes and returns the best live entry without touching in-flight accounting. */
  pop(): T | undefined {
    this.discardCancelledTop();
    const topEntry = this.heap[0];
    if (!topEntry) {
      this.countOnLanes("starved", 1);
      return undefined;
    }
    this.removeAt(0);
    this.recordDequeue(topEntry);
    return topEntry.item;
  }

  canDispatch(): boolean {
    return this.dispatchedCount < this.maxInFlight && this.peekPriority() !== undefined;
  }

  /** Pops the best live entry and counts it as in flight; undefined when empty or at the in-flight bound. */
  dispatchNext(): T | undefined {
    if (!this.canDispatch()) {
      if (this.dispatchedCount >= this.maxInFlight && this.heap.length > 0) this.countOnLanes("blockedByInFlight", 1);
      else this.countOnLanes("starved", 1);
      return undefined;
    }
    this.dispatchedCount++;
    if (this.dispatchedCount > this.peakInFlightSinceSample) this.peakInFlightSinceSample = this.dispatchedCount;
    this.countOnLanes("dispatched", 1);
    return this.pop();
  }

  /** Dispatches up to maxCount entries, best first, never exceeding the in-flight bound. */
  takeBatch(maxCount: number): T[] {
    const batch: T[] = [];
    while (batch.length < maxCount && this.canDispatch()) {
      batch.push(this.dispatchNext() as T);
    }
    return batch;
  }

  completeDispatch(): void {
    if (this.dispatchedCount === 0) throw new Error("completeDispatch called with nothing in flight");
    this.dispatchedCount--;
    this.countOnLanes("completed", 1);
  }

  clear(): void {
    this.countOnLanes("cleared", this.heap.length);
    this.heap.length = 0;
    this.entryByKey.clear();
  }

  /**
   * Publishes depth and in-flight gauges plus the peaks reached since the last call. Called by whoever samples
   * the queues once a second, so the hot paths record nothing about levels.
   */
  publishProfilerGauges(): void {
    if (!profiler.enabled) return;
    for (const metrics of this.laneMetrics) {
      profiler.sampleGauge(metrics.depthGauge, this.heap.length);
      profiler.sampleGauge(metrics.depthPeakGauge, Math.max(this.peakDepthSinceSample, this.heap.length));
      profiler.sampleGauge(metrics.inFlightGauge, this.dispatchedCount);
      profiler.sampleGauge(metrics.inFlightPeakGauge, Math.max(this.peakInFlightSinceSample, this.dispatchedCount));
      profiler.addCounter(metrics.heapMovesCounter, this.heapMovesSinceSample);
    }
    this.peakDepthSinceSample = this.heap.length;
    this.peakInFlightSinceSample = this.dispatchedCount;
    this.heapMovesSinceSample = 0;
  }

  private measuredNow(): number {
    return this.laneMetrics.length > 0 && profiler.enabled ? profiler.now() : NOT_TIMED;
  }

  private countOnLanes(
    counter: "enqueued" | "replaced" | "removed" | "transferredIn" | "transferredOut" | "cleared" | "dispatched" | "completed" | "starved" | "blockedByInFlight" | "reprioritized" | "reprioritizeMissed" | "reprioritizeAllCalls" | "reprioritizeAllEntries" | "cancelledDropped" | "cancelChecks",
    amount: number,
  ): void {
    if (this.laneMetrics.length === 0 || !profiler.enabled || amount === 0) return;
    for (const metrics of this.laneMetrics) profiler.addCounter(metrics[counter], amount);
  }

  private beginLaneScope(scope: "reprioritizeAllScope" | "heapifyScope"): number {
    if (this.laneMetrics.length === 0) return 0;
    return profiler.begin(this.laneMetrics[0]![scope]);
  }

  private recordDequeue(entry: HeapEntry<T>): void {
    if (this.laneMetrics.length === 0 || !profiler.enabled) return;
    const waitMs = entry.enqueuedAtMs === NOT_TIMED ? NOT_TIMED : profiler.now() - entry.enqueuedAtMs;
    for (const metrics of this.laneMetrics) {
      profiler.addCounter(metrics.dequeued);
      profiler.sampleGauge(metrics.dispatchedPriorityGauge, entry.priority);
      if (waitMs === NOT_TIMED) continue;
      profiler.recordTimer(metrics.waitTimer, waitMs, "latency");
      profiler.recordBreakdown(DIMENSIONS.schedulerLane, metrics.lane, { units: 1, calls: 1, selfMs: waitMs });
    }
  }

  private changePriority(entry: HeapEntry<T>, priority: number): void {
    const previousPriority = entry.priority;
    entry.priority = priority;
    if (priority < previousPriority) this.siftUp(entry.heapIndex);
    else if (priority > previousPriority) this.siftDown(entry.heapIndex);
  }

  private discardCancelledTop(): void {
    if (!this.isCancelled) return;
    let topEntry = this.heap[0];
    while (topEntry) {
      this.countOnLanes("cancelChecks", 1);
      if (!this.isCancelled(topEntry.key, topEntry.item)) break;
      this.removeAt(0);
      this.cancelledDropCount++;
      this.countOnLanes("cancelledDropped", 1);
      topEntry = this.heap[0];
    }
  }

  private removeAt(heapIndex: number): void {
    const removedEntry = this.heap[heapIndex]!;
    const lastEntry = this.heap.pop()!;
    this.entryByKey.delete(removedEntry.key);
    if (lastEntry === removedEntry) return;
    this.heap[heapIndex] = lastEntry;
    lastEntry.heapIndex = heapIndex;
    this.siftUp(heapIndex);
    this.siftDown(lastEntry.heapIndex);
  }

  private isBefore(left: HeapEntry<T>, right: HeapEntry<T>): boolean {
    return left.priority < right.priority || (left.priority === right.priority && left.sequence < right.sequence);
  }

  private siftUp(startIndex: number): void {
    const entry = this.heap[startIndex]!;
    let index = startIndex;
    while (index > 0) {
      const parentIndex = (index - 1) >> 1;
      const parentEntry = this.heap[parentIndex]!;
      if (!this.isBefore(entry, parentEntry)) break;
      this.heap[index] = parentEntry;
      parentEntry.heapIndex = index;
      index = parentIndex;
      this.heapMovesSinceSample++;
    }
    this.heap[index] = entry;
    entry.heapIndex = index;
  }

  private siftDown(startIndex: number): void {
    const entry = this.heap[startIndex]!;
    const length = this.heap.length;
    let index = startIndex;
    for (;;) {
      const leftIndex = index * 2 + 1;
      if (leftIndex >= length) break;
      const rightIndex = leftIndex + 1;
      const betterChildIndex =
        rightIndex < length && this.isBefore(this.heap[rightIndex]!, this.heap[leftIndex]!) ? rightIndex : leftIndex;
      const betterChild = this.heap[betterChildIndex]!;
      if (!this.isBefore(betterChild, entry)) break;
      this.heap[index] = betterChild;
      betterChild.heapIndex = index;
      index = betterChildIndex;
      this.heapMovesSinceSample++;
    }
    this.heap[index] = entry;
    entry.heapIndex = index;
  }
}
