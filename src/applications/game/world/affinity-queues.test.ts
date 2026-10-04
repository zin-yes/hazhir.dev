import { describe, expect, test } from "bun:test";
import { AffinityQueues } from "./affinity-queues";

describe("AffinityQueues", () => {
  const preferredWorker = (key: number) => Math.floor(key / 100);

  test("a worker takes its own keys best first before anything else", () => {
    const queues = new AffinityQueues(3, preferredWorker);
    queues.schedule(105, 5);
    queues.schedule(101, 1);
    queues.schedule(201, 0.5);
    queues.schedule(103, 3);
    expect([queues.takeFor(1), queues.takeFor(1), queues.takeFor(1)]).toEqual([101, 103, 105]);
    expect(queues.takeFor(2)).toBe(201);
  });

  test("a worker with nothing of its own takes the best key of the other queues", () => {
    const queues = new AffinityQueues(3, preferredWorker);
    queues.schedule(7, 4);
    queues.schedule(150, 2);
    queues.schedule(260, 3);
    expect(queues.takeFor(2)).toBe(260);
    expect(queues.takeFor(2)).toBe(150);
    expect(queues.takeFor(2)).toBe(7);
    expect(queues.takeFor(2)).toBeUndefined();
  });

  test("removed and re-ranked keys come out in the new order", () => {
    const queues = new AffinityQueues(2, preferredWorker);
    for (const key of [100, 101, 102, 103]) queues.schedule(key, key);
    queues.remove(101);
    queues.reprioritizeAll((key) => -key);
    expect([queues.takeFor(1), queues.takeFor(1), queues.takeFor(1)]).toEqual([103, 102, 100]);
    expect(queues.size).toBe(0);
  });

  test("a worker leaves its own far work for a much more urgent key of another queue", () => {
    const queues = new AffinityQueues(3, preferredWorker, 2);
    queues.schedule(110, 9);
    queues.schedule(111, 3.5);
    queues.schedule(220, 1);
    expect(queues.takeFor(1)).toBe(220);
    expect(queues.takeFor(1)).toBe(111);
    queues.schedule(230, 8);
    expect(queues.takeFor(1)).toBe(110);
  });

  test("an idle worker takes over a whole tile, but splits off single keys of the tile its owner is working on", () => {
    const tileOf = (key: number) => Math.floor(key / 10);
    const queues = new AffinityQueues(2, () => 0, 2, tileOf);
    for (const key of [10, 11, 12, 20, 21, 22]) queues.schedule(key, key / 10);
    expect(queues.takeFor(0)).toBe(10);
    expect(queues.takeFor(1)).toBe(11);
    expect(queues.takeFor(1)).toBe(12);
    expect(queues.takeFor(1)).toBe(20);
    expect(queues.takeFor(0)).toBe(21);
    expect(queues.takeFor(1)).toBe(22);
    expect(queues.size).toBe(0);
  });
});
