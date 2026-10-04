// Keyed min-heap scheduler (lowest priority value first, FIFO among equal priorities) with bounded in-flight
// accounting. Feed a worker pool just-in-time: dispatch only while canDispatch(), call completeDispatch() when a
// job finishes, and the pool never holds a long queue that cannot be reordered or cancelled.

export interface PrioritySchedulerOptions<T> {
  /** Maximum dispatched-but-uncompleted jobs. Defaults to unbounded. */
  maxInFlight?: number;
  /** Checked lazily when an entry reaches the top; cancelled entries are dropped instead of returned. */
  isCancelled?: (key: number, item: T) => boolean;
}

interface HeapEntry<T> {
  key: number;
  item: T;
  priority: number;
  sequence: number;
  heapIndex: number;
}

export class PriorityScheduler<T> {
  maxInFlight: number;
  private readonly heap: HeapEntry<T>[] = [];
  private readonly entryByKey = new Map<number, HeapEntry<T>>();
  private readonly isCancelled: ((key: number, item: T) => boolean) | undefined;
  private nextSequence = 0;
  private dispatchedCount = 0;
  private cancelledDropCount = 0;

  constructor(options: PrioritySchedulerOptions<T> = {}) {
    this.maxInFlight = options.maxInFlight ?? Number.POSITIVE_INFINITY;
    this.isCancelled = options.isCancelled;
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

  /** Adds the key, or replaces its item and priority while keeping its original arrival order. */
  schedule(key: number, item: T, priority: number): void {
    const existingEntry = this.entryByKey.get(key);
    if (existingEntry) {
      existingEntry.item = item;
      this.changePriority(existingEntry, priority);
      return;
    }
    const entry: HeapEntry<T> = { key, item, priority, sequence: this.nextSequence++, heapIndex: this.heap.length };
    this.heap.push(entry);
    this.entryByKey.set(key, entry);
    this.siftUp(entry.heapIndex);
  }

  reprioritize(key: number, priority: number): boolean {
    const entry = this.entryByKey.get(key);
    if (!entry) return false;
    this.changePriority(entry, priority);
    return true;
  }

  /** Recomputes every queued priority (for example after the camera turned) and rebuilds the heap in O(n). */
  reprioritizeAll(computePriority: (key: number, item: T) => number): void {
    for (const entry of this.heap) entry.priority = computePriority(entry.key, entry.item);
    for (let index = (this.heap.length >> 1) - 1; index >= 0; index--) this.siftDown(index);
  }

  remove(key: number): boolean {
    const entry = this.entryByKey.get(key);
    if (!entry) return false;
    this.removeAt(entry.heapIndex);
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
    if (!topEntry) return undefined;
    this.removeAt(0);
    return topEntry.item;
  }

  canDispatch(): boolean {
    return this.dispatchedCount < this.maxInFlight && this.peekPriority() !== undefined;
  }

  /** Pops the best live entry and counts it as in flight; undefined when empty or at the in-flight bound. */
  dispatchNext(): T | undefined {
    if (!this.canDispatch()) return undefined;
    this.dispatchedCount++;
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
  }

  clear(): void {
    this.heap.length = 0;
    this.entryByKey.clear();
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
    while (topEntry && this.isCancelled(topEntry.key, topEntry.item)) {
      this.removeAt(0);
      this.cancelledDropCount++;
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
    }
    this.heap[index] = entry;
    entry.heapIndex = index;
  }
}
