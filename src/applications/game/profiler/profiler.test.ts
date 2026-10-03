import { describe, expect, test } from "bun:test";
import { Profiler } from "./profiler";
import { ingestWorkerTask, type WorkerTaskRecord } from "./worker-task-ingest";

function createProfilerWithClock() {
  let nowMs = 1000;
  const profiler = new Profiler(() => nowMs);
  profiler.setEnabled(true);
  return {
    profiler,
    advance(milliseconds: number) {
      nowMs += milliseconds;
    },
  };
}

function timerNamed(profiler: Profiler, name: string) {
  const timer = profiler.snapshot().timers.find((candidate) => candidate.name === name);
  if (!timer) throw new Error(`missing timer ${name}`);
  return timer;
}

describe("Profiler scopes", () => {
  test("splits inclusive and self time for nested scopes", () => {
    const { profiler, advance } = createProfilerWithClock();
    const outer = profiler.begin("outer");
    advance(2);
    const inner = profiler.begin("inner");
    advance(5);
    profiler.end(inner);
    advance(1);
    profiler.end(outer);

    const outerTimer = timerNamed(profiler, "outer");
    const innerTimer = timerNamed(profiler, "inner");
    expect(outerTimer.total).toBe(8);
    expect(outerTimer.selfTotal).toBe(3);
    expect(innerTimer.total).toBe(5);
    expect(innerTimer.parent).toBe("outer");
  });

  test("a throwing measured function still closes its scope", () => {
    const { profiler, advance } = createProfilerWithClock();
    expect(() =>
      profiler.measure("explodes", () => {
        advance(4);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    profiler.measure("after", () => advance(1));

    expect(timerNamed(profiler, "explodes").total).toBe(4);
    expect(timerNamed(profiler, "after").parent).toBeNull();
  });

  test("ending an outer scope closes an inner scope that was never ended", () => {
    const { profiler, advance } = createProfilerWithClock();
    const outer = profiler.begin("outer");
    profiler.begin("leaked");
    advance(3);
    profiler.end(outer);

    expect(timerNamed(profiler, "leaked").total).toBe(3);
    expect(timerNamed(profiler, "outer").selfTotal).toBe(0);
  });

  test("records nothing while disabled", () => {
    const profiler = new Profiler(() => 0);
    profiler.measure("ignored", () => 1);
    profiler.addCounter("ignored");
    profiler.recordBytes("ignored", 10);
    const snapshot = profiler.snapshot();
    expect(snapshot.timers).toEqual([]);
    expect(snapshot.counters).toEqual([]);
    expect(snapshot.bytes).toEqual([]);
  });
});

describe("Profiler frames", () => {
  test("attributes a long interval to its heaviest scope and the unmeasured remainder", () => {
    const { profiler, advance } = createProfilerWithClock();
    profiler.beginFrame();
    advance(16);
    profiler.beginFrame();

    profiler.measure("handler.meshUpload", () => advance(30));
    profiler.measure("physics", () => advance(2));
    advance(18);
    profiler.noteFrame("drawCalls", 120);
    profiler.beginFrame();

    const worst = profiler.snapshot().frames.worst;
    expect(worst.length).toBe(1);
    expect(worst[0].intervalMs).toBe(50);
    expect(worst[0].busyMs).toBe(32);
    expect(worst[0].unattributedMs).toBe(18);
    expect(worst[0].topScopes[0]).toEqual({ name: "handler.meshUpload", selfMs: 30 });
  });

  test("notes belong to the frame that set them", () => {
    const { profiler, advance } = createProfilerWithClock();
    profiler.beginFrame();
    profiler.noteFrame("drawCalls", 7);
    advance(40);
    profiler.beginFrame();
    advance(40);
    profiler.beginFrame();

    const worst = profiler.snapshot().frames.worst;
    const noted = worst.find((frame) => frame.notes.drawCalls === 7);
    expect(noted).toBeDefined();
    expect(worst.some((frame) => frame.notes.drawCalls === undefined)).toBe(true);
  });

  test("late GPU time lands on the frame it was measured for", () => {
    const { profiler, advance } = createProfilerWithClock();
    profiler.beginFrame();
    const drawnFrameId = profiler.currentFrameId;
    advance(25);
    profiler.beginFrame();
    profiler.attachGpuFrameTime(drawnFrameId, 11);

    const frames = profiler.snapshot().frames;
    expect(frames.recentGpuMs[0]).toBe(11);
    expect(frames.worst[0].gpuMs).toBe(11);
    expect(frames.gpuMs.total).toBe(11);
  });
});

describe("ingestWorkerTask", () => {
  test("derives queue wait, transfer latencies and work counters from timestamps", () => {
    const { profiler } = createProfilerWithClock();
    profiler.registerWorkerPool("mesh", 3);
    const record: WorkerTaskRecord = {
      poolName: "mesh",
      method: "generateMesh",
      enqueuedAtMs: 100,
      dispatchedAtMs: 112,
      completedAtMs: 160,
      postedToWorkerAtEpochMs: 5000,
      receivedFromWorkerAtEpochMs: 5050,
      paramBytes: 131072,
      resultBytes: 400000,
      failed: false,
      queueDepthAtEnqueue: 4,
      workerResultPostMs: 3,
      workerProfile: {
        receivedAtEpochMs: 5004,
        executionStartedAtEpochMs: 5004,
        executionFinishedAtEpochMs: 5044,
        executionMs: 40,
        sectionSelfMs: { faceLoop: 30, pack: 10 },
        counters: { facesEmitted: 5000 },
      },
    };
    ingestWorkerTask(profiler, record);

    const snapshot = profiler.snapshot();
    const timer = (name: string) => snapshot.timers.find((candidate) => candidate.name === name)?.total;
    expect(timer("queue.mesh.generateMesh.wait")).toBe(12);
    expect(timer("latency.mesh.generateMesh.roundTrip")).toBe(60);
    expect(timer("worker.mesh.generateMesh.exec")).toBe(40);
    expect(timer("worker.mesh.generateMesh.faceLoop")).toBe(30);
    expect(timer("transfer.mesh.generateMesh.toWorker")).toBe(4);
    expect(timer("transfer.mesh.generateMesh.workerSerialize")).toBe(3);
    expect(timer("transfer.mesh.generateMesh.toMain")).toBe(3);
    expect(snapshot.counters.find((c) => c.name === "work.mesh.generateMesh.facesEmitted")?.total).toBe(5000);
    expect(snapshot.bytes.find((b) => b.name === "bytes.mesh.generateMesh.result")?.max).toBe(400000);
    expect(snapshot.workerPools[0].tasksCompleted).toBe(1);
  });
});
