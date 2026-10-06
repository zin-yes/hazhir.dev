import { describe, expect, test } from "bun:test";
import { beginWorkerTask, finishWorkerTask } from "@/applications/game/profiler/worker-recorder";
import { beginColdStart, defineColdStartLabel, endColdStart } from "./cold-start-ledger";
import { beginHotCounting, defineHotCounter, endHotCounting, hotCounterProbe, noteHot, noteHotAmount } from "./hot-counters";

const SLOT_A = defineHotCounter("test.hotCounters.a");
const SLOT_B = defineHotCounter("test.hotCounters.b");
const SETUP_LABEL = defineColdStartLabel("testSetup");

describe("hot counters", () => {
  test("bumps made while no profile is recording are dropped", () => {
    noteHot(SLOT_A);
    expect(hotCounterProbe.counts).toBeNull();

    beginWorkerTask(true);
    const didBegin = beginHotCounting();
    noteHot(SLOT_A);
    endHotCounting(didBegin);
    const profile = finishWorkerTask()!;

    expect(profile.counters["test.hotCounters.a"]).toBe(1);
  });

  test("nested windows flush at each close and add up across the task", () => {
    beginWorkerTask(true);
    const outer = beginHotCounting();
    noteHotAmount(SLOT_A, 5);
    const inner = beginHotCounting();
    noteHot(SLOT_A);
    noteHotAmount(SLOT_B, 3);
    endHotCounting(inner);
    expect(hotCounterProbe.counts).not.toBeNull();
    noteHot(SLOT_B);
    endHotCounting(outer);
    const profile = finishWorkerTask()!;

    expect(hotCounterProbe.counts).toBeNull();
    expect(profile.counters["test.hotCounters.a"]).toBe(6);
    expect(profile.counters["test.hotCounters.b"]).toBe(4);
  });

  test("a closed window leaves no counts behind for the next task", () => {
    beginWorkerTask(true);
    const first = beginHotCounting();
    noteHotAmount(SLOT_A, 7);
    endHotCounting(first);
    finishWorkerTask();

    beginWorkerTask(true);
    const second = beginHotCounting();
    noteHot(SLOT_B);
    endHotCounting(second);
    const profile = finishWorkerTask()!;

    expect(profile.counters["test.hotCounters.a"]).toBeUndefined();
    expect(profile.counters["test.hotCounters.b"]).toBe(1);
  });
});

describe("cold start ledger", () => {
  function spinFor(milliseconds: number): void {
    const until = performance.now() + milliseconds;
    while (performance.now() < until) continue;
  }

  test("an event recorded before profiling shows up in the next profiled task, once", () => {
    const token = beginColdStart(SETUP_LABEL);
    spinFor(3);
    endColdStart(SETUP_LABEL, token, 120);

    beginWorkerTask(true);
    const firstWindow = beginHotCounting();
    endHotCounting(firstWindow);
    const firstProfile = finishWorkerTask()!;

    expect(firstProfile.counters[SETUP_LABEL.deferredCallsCounterName]).toBe(1);
    expect(firstProfile.counters[SETUP_LABEL.deferredUnitsCounterName]).toBe(120);
    expect(firstProfile.counters[SETUP_LABEL.deferredMicrosecondsCounterName]).toBeGreaterThanOrEqual(2500);

    beginWorkerTask(true);
    const secondWindow = beginHotCounting();
    endHotCounting(secondWindow);
    const secondProfile = finishWorkerTask()!;
    expect(secondProfile.counters[SETUP_LABEL.deferredCallsCounterName]).toBeUndefined();
  });

  test("an event during a profiled task becomes a section and counts, not a deferred entry", () => {
    beginWorkerTask(true);
    const token = beginColdStart(SETUP_LABEL);
    spinFor(2);
    endColdStart(SETUP_LABEL, token, 40);
    const profile = finishWorkerTask()!;

    const sectionNode = profile.callTree.find((node) => node.path === SETUP_LABEL.sectionName)!;
    expect(sectionNode.calls).toBe(1);
    expect(sectionNode.totalMs).toBeGreaterThanOrEqual(1.5);
    expect(profile.counters[SETUP_LABEL.unitsCounterName]).toBe(40);
    expect(profile.counters[SETUP_LABEL.deferredCallsCounterName]).toBeUndefined();
  });
});
