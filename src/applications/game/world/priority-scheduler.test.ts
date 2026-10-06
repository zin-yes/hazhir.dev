import { describe, expect, test } from "bun:test";
import { PriorityScheduler } from "./priority-scheduler";
import { counterTotal, gaugeLast, timerCallCount, withEnabledProfiler } from "./profiler-readings.test-helper";

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

describe("PriorityScheduler ordering", () => {
  test("pops lowest priority first", () => {
    const scheduler = new PriorityScheduler<string>();
    scheduler.schedule(1, "far", 9);
    scheduler.schedule(2, "near", 1);
    scheduler.schedule(3, "middle", 5);
    expect([scheduler.pop(), scheduler.pop(), scheduler.pop(), scheduler.pop()]).toEqual([
      "near",
      "middle",
      "far",
      undefined,
    ]);
  });

  test("equal priorities come out in insertion order", () => {
    const scheduler = new PriorityScheduler<number>();
    for (let key = 0; key < 200; key++) scheduler.schedule(key, key, key % 3);
    const poppedKeys: number[] = [];
    for (let item = scheduler.pop(); item !== undefined; item = scheduler.pop()) poppedKeys.push(item);
    const expectedKeys = Array.from({ length: 200 }, (_, key) => key).sort(
      (left, right) => (left % 3) - (right % 3) || left - right,
    );
    expect(poppedKeys).toEqual(expectedKeys);
  });

  test("rescheduling a key replaces its item and keeps its arrival order among ties", () => {
    const scheduler = new PriorityScheduler<string>();
    scheduler.schedule(1, "first", 2);
    scheduler.schedule(2, "second", 2);
    scheduler.schedule(1, "first-updated", 2);
    expect(scheduler.size).toBe(2);
    expect(scheduler.pop()).toBe("first-updated");
    expect(scheduler.pop()).toBe("second");
  });

  test("random operations always match a brute-force reference", () => {
    const random = createSeededRandom(1234);
    const scheduler = new PriorityScheduler<number>();
    const reference = new Map<number, { priority: number; sequence: number }>();
    let sequence = 0;
    for (let step = 0; step < 20_000; step++) {
      const key = Math.floor(random() * 300);
      const priority = Math.floor(random() * 40);
      const operation = random();
      if (operation < 0.4) {
        scheduler.schedule(key, key, priority);
        const existing = reference.get(key);
        reference.set(key, { priority, sequence: existing ? existing.sequence : sequence++ });
      } else if (operation < 0.6) {
        expect(scheduler.reprioritize(key, priority)).toBe(reference.has(key));
        const existing = reference.get(key);
        if (existing) existing.priority = priority;
      } else if (operation < 0.75) {
        expect(scheduler.remove(key)).toBe(reference.delete(key));
      } else {
        let expectedKey: number | undefined;
        let best: { priority: number; sequence: number } | undefined;
        for (const [candidateKey, candidate] of reference) {
          if (!best || candidate.priority < best.priority || (candidate.priority === best.priority && candidate.sequence < best.sequence)) {
            best = candidate;
            expectedKey = candidateKey;
          }
        }
        expect(scheduler.pop()).toBe(expectedKey);
        if (expectedKey !== undefined) reference.delete(expectedKey);
      }
      expect(scheduler.size).toBe(reference.size);
    }
  });

  test("reprioritize moves an entry in both directions", () => {
    const scheduler = new PriorityScheduler<string>();
    scheduler.schedule(1, "a", 1);
    scheduler.schedule(2, "b", 2);
    scheduler.schedule(3, "c", 3);
    scheduler.reprioritize(3, 0);
    scheduler.reprioritize(1, 10);
    expect([scheduler.pop(), scheduler.pop(), scheduler.pop()]).toEqual(["c", "b", "a"]);
  });

  test("reprioritizeAll reorders every queued entry", () => {
    const scheduler = new PriorityScheduler<number>();
    for (let key = 0; key < 100; key++) scheduler.schedule(key, key, key);
    scheduler.reprioritizeAll((key) => 100 - key);
    expect(scheduler.pop()).toBe(99);
    expect(scheduler.pop()).toBe(98);
    expect(scheduler.size).toBe(98);
  });
});

describe("PriorityScheduler cancellation", () => {
  test("remove drops the entry", () => {
    const scheduler = new PriorityScheduler<string>();
    scheduler.schedule(1, "a", 1);
    scheduler.schedule(2, "b", 2);
    expect(scheduler.remove(1)).toBe(true);
    expect(scheduler.remove(1)).toBe(false);
    expect(scheduler.has(1)).toBe(false);
    expect(scheduler.pop()).toBe("b");
  });

  test("the lazy predicate skips entries that became cancelled after scheduling", () => {
    const cancelledKeys = new Set<number>();
    const scheduler = new PriorityScheduler<number>({ isCancelled: (key) => cancelledKeys.has(key) });
    for (let key = 0; key < 10; key++) scheduler.schedule(key, key, key);
    cancelledKeys.add(0);
    cancelledKeys.add(1);
    cancelledKeys.add(5);
    expect(scheduler.peek()).toBe(2);
    const popped: number[] = [];
    for (let item = scheduler.pop(); item !== undefined; item = scheduler.pop()) popped.push(item);
    expect(popped).toEqual([2, 3, 4, 6, 7, 8, 9]);
    expect(scheduler.cancelledEntryCount).toBe(3);
  });

  test("a fully cancelled queue cannot dispatch", () => {
    const scheduler = new PriorityScheduler<number>({ maxInFlight: 4, isCancelled: () => true });
    scheduler.schedule(1, 1, 1);
    expect(scheduler.canDispatch()).toBe(false);
    expect(scheduler.takeBatch(5)).toEqual([]);
    expect(scheduler.inFlightCount).toBe(0);
  });
});

describe("PriorityScheduler in-flight accounting", () => {
  test("never dispatches beyond maxInFlight and resumes after completions", () => {
    const scheduler = new PriorityScheduler<number>({ maxInFlight: 3 });
    for (let key = 0; key < 10; key++) scheduler.schedule(key, key, key);
    expect(scheduler.takeBatch(10)).toEqual([0, 1, 2]);
    expect(scheduler.canDispatch()).toBe(false);
    expect(scheduler.dispatchNext()).toBeUndefined();
    scheduler.completeDispatch();
    scheduler.completeDispatch();
    expect(scheduler.inFlightCount).toBe(1);
    expect(scheduler.takeBatch(1)).toEqual([3]);
    expect(scheduler.takeBatch(10)).toEqual([4]);
    expect(scheduler.inFlightCount).toBe(3);
    expect(scheduler.size).toBe(5);
  });

  test("a late high priority entry jumps ahead of everything still queued", () => {
    const scheduler = new PriorityScheduler<number>({ maxInFlight: 1 });
    for (let key = 0; key < 50; key++) scheduler.schedule(key, key, 100 + key);
    expect(scheduler.takeBatch(1)).toEqual([0]);
    scheduler.completeDispatch();
    scheduler.schedule(999, 999, 0);
    expect(scheduler.takeBatch(1)).toEqual([999]);
  });

  test("takeBatch honours its own count below the in-flight bound", () => {
    const scheduler = new PriorityScheduler<number>({ maxInFlight: 8 });
    for (let key = 0; key < 8; key++) scheduler.schedule(key, key, key);
    expect(scheduler.takeBatch(2)).toEqual([0, 1]);
    expect(scheduler.inFlightCount).toBe(2);
  });

  test("completing with nothing in flight is a bug and throws", () => {
    expect(() => new PriorityScheduler<number>().completeDispatch()).toThrow();
  });

  test("pop does not count as in flight", () => {
    const scheduler = new PriorityScheduler<number>({ maxInFlight: 1 });
    scheduler.schedule(1, 1, 1);
    scheduler.pop();
    expect(scheduler.inFlightCount).toBe(0);
  });
});

describe("PriorityScheduler profiling", () => {
  test("records lane traffic: enqueues, replacements, cancelled drops, in-flight blocks and one wait per dequeue", () => {
    const cancelledKeys = new Set([3, 4]);
    withEnabledProfiler(() => {
      const scheduler = new PriorityScheduler<number>({
        maxInFlight: 2,
        isCancelled: (key) => cancelledKeys.has(key),
        profilerLane: "testLane",
      });
      for (let key = 0; key < 6; key++) scheduler.schedule(key, key, key);
      scheduler.schedule(5, 5, 0.5);
      scheduler.reprioritize(2, 10);
      scheduler.reprioritize(99, 1);
      expect(scheduler.takeBatch(5)).toEqual([0, 5]);
      expect(scheduler.dispatchNext()).toBeUndefined();
      scheduler.completeDispatch();
      expect(scheduler.dispatchNext()).toBe(1);
      scheduler.completeDispatch();
      scheduler.completeDispatch();
      expect([scheduler.pop(), scheduler.pop(), scheduler.pop()]).toEqual([2, undefined, undefined]);

      expect(counterTotal("game.scheduler.testLane.enqueued")).toBe(6);
      expect(counterTotal("game.scheduler.testLane.replaced")).toBe(1);
      expect(counterTotal("game.scheduler.testLane.reprioritized")).toBe(1);
      expect(counterTotal("game.scheduler.testLane.reprioritizeMissed")).toBe(1);
      expect(counterTotal("game.scheduler.testLane.dispatched")).toBe(3);
      expect(counterTotal("game.scheduler.testLane.blockedByInFlight")).toBe(1);
      expect(counterTotal("game.scheduler.testLane.cancelledDropped")).toBe(2);
      expect(counterTotal("game.scheduler.testLane.dequeued")).toBe(4);
      expect(timerCallCount("latency.scheduler.testLane.wait")).toBe(4);
      expect(counterTotal("game.scheduler.testLane.starved")).toBe(2);
      scheduler.publishProfilerGauges();
      expect(gaugeLast("queue.scheduler.testLane.depth")).toBe(0);
    });
  });
});
