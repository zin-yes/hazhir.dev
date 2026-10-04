import { describe, expect, test } from "bun:test";
import { simulateSnapshot, worldgenScenario } from "./profile-fixtures";
import { exportTrace, type TraceEvent } from "./trace-export";

const snapshot = simulateSnapshot(worldgenScenario());
const exported = JSON.parse(exportTrace(snapshot)) as { traceEvents: TraceEvent[]; displayTimeUnit: string };
const events = exported.traceEvents;
const completeEvents = events.filter((event) => event.ph === "X");

function threadNames() {
  return new Map(
    events
      .filter((event) => event.ph === "M" && event.name === "thread_name")
      .map((event) => [event.tid, event.args?.name as string]),
  );
}

describe("exportTrace", () => {
  test("captured something worth exporting", () => {
    expect(snapshot.trace?.tracks.map((track) => track.name)).toEqual(["main", "worldgen worker"]);
    expect(completeEvents.length).toBeGreaterThan(500);
  });

  test("names the process and one thread per track", () => {
    expect(events.some((event) => event.ph === "M" && event.name === "process_name")).toBe(true);
    expect([...threadNames().values()]).toEqual(["main", "worldgen worker", "worst frames"]);
  });

  test("writes complete events in microseconds with the real section durations", () => {
    const names = threadNames();
    const placeTree = completeEvents.filter((event) => event.name === "placeTree");
    expect(placeTree.length).toBe(60);
    for (const event of placeTree) {
      expect(event.dur).toBe(14_000);
      expect(names.get(event.tid)).toBe("worldgen worker");
    }
    const upload = completeEvents.find((event) => event.name === "main.gl.upload");
    expect(upload?.dur).toBeCloseTo(1_000, 3);
    expect(names.get(upload!.tid)).toBe("main");
  });

  test("keeps nested spans inside their parents so the flame view nests", () => {
    for (const childName of ["main.gl.bufferData", "placeOre"]) {
      const child = completeEvents.find((event) => event.name === childName)!;
      const parents = completeEvents.filter(
        (event) =>
          event.tid === child.tid &&
          (event.args?.depth as number) === (child.args?.depth as number) - 1 &&
          event.ts! <= child.ts! + 1e-6 &&
          event.ts! + event.dur! >= child.ts! + child.dur! - 1e-6,
      );
      expect(parents.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("never emits a negative timestamp or duration", () => {
    for (const event of events.filter((candidate) => candidate.ts !== undefined)) {
      expect(event.ts!).toBeGreaterThanOrEqual(0);
      expect(event.dur ?? 0).toBeGreaterThanOrEqual(0);
    }
  });

  test("draws each worst frame as a begin and end pair as long as the frame", () => {
    const worst = snapshot.frames.worst[0];
    const begin = events.find((event) => event.ph === "b" && event.id === `frame-${worst.frameId}`)!;
    const end = events.find((event) => event.ph === "e" && event.id === `frame-${worst.frameId}`)!;
    expect(end.ts! - begin.ts!).toBeCloseTo(worst.intervalMs * 1000, 3);
    expect(begin.args?.topScopes).toEqual(worst.topScopes);
    expect(begin.tid).toBe(end.tid);
  });

  test("still produces a loadable file when tracing was off", () => {
    const untraced = simulateSnapshot(worldgenScenario({ trace: false }));
    const parsed = JSON.parse(exportTrace(untraced)) as { traceEvents: TraceEvent[] };
    expect(untraced.trace).toBeNull();
    expect(parsed.traceEvents.some((event) => event.ph === "X")).toBe(false);
    expect(parsed.traceEvents.some((event) => event.ph === "b")).toBe(true);
  });
});
