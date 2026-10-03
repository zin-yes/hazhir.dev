import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { profiler } from "./profiler";
import type {
  WorkerRequestMessage,
  WorkerTaskProfile,
} from "./profiler/worker-recorder";
import { WorkerPool } from "./worker-pool";

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  receivedRequests: WorkerRequestMessage[] = [];

  postMessage(message: WorkerRequestMessage) {
    this.receivedRequests.push(message);
  }

  terminate() {}

  deliver(data: object) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

function createPool(workerCount: number, name = "mesh") {
  const workers: FakeWorker[] = [];
  const pool = new WorkerPool(
    () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    },
    workerCount,
    name,
  );
  return { pool, workers };
}

function plausibleWorkerProfile(executionMs: number): WorkerTaskProfile {
  const nowEpochMs = performance.timeOrigin + performance.now();
  return {
    receivedAtEpochMs: nowEpochMs,
    executionStartedAtEpochMs: nowEpochMs,
    executionFinishedAtEpochMs: nowEpochMs + executionMs,
    executionMs,
    sectionSelfMs: { faceGeneration: executionMs * 0.8 },
    counters: { facesEmitted: 120 },
  };
}

function timerNamed(name: string) {
  return profiler.snapshot().timers.find((timer) => timer.name === name);
}

describe("WorkerPool profiling", () => {
  beforeEach(() => {
    profiler.setEnabled(true);
    profiler.reset("worker-pool-test");
  });

  afterEach(() => {
    profiler.setEnabled(false);
  });

  test("records worker time, payload sizes and serialization cost for one task", async () => {
    const { pool, workers } = createPool(1);
    const chunkBuffer = new Uint8Array(32 * 32 * 32).buffer;
    const resultBuffer = new ArrayBuffer(4000);

    const pending = pool.exec("generateMesh", [chunkBuffer, { center: chunkBuffer }]);
    const request = workers[0].receivedRequests[0];
    expect(request.profile).toBe(true);

    workers[0].deliver({
      id: request.id,
      result: resultBuffer,
      profile: plausibleWorkerProfile(5),
    });
    workers[0].deliver({ id: request.id, resultTail: { resultPostMs: 1.5 } });
    await pending;

    const snapshot = profiler.snapshot();
    expect(timerNamed("worker.mesh.generateMesh.exec")?.total).toBe(5);
    expect(timerNamed("worker.mesh.generateMesh.faceGeneration")?.total).toBe(4);
    expect(timerNamed("transfer.mesh.generateMesh.workerSerialize")?.total).toBe(1.5);
    expect(timerNamed("main.workerPost.mesh.generateMesh")?.domain).toBe("main-cpu");
    expect(timerNamed("main.workerResult.mesh.generateMesh")?.count).toBe(1);

    const paramBytes = snapshot.bytes.find((meter) => meter.name === "bytes.mesh.generateMesh.params");
    expect(paramBytes?.max).toBe(32768 + "center".length);
    const resultBytes = snapshot.bytes.find((meter) => meter.name === "bytes.mesh.generateMesh.result");
    expect(resultBytes?.max).toBe(4000);
    expect(
      snapshot.counters.find((counter) => counter.name === "work.mesh.generateMesh.facesEmitted")?.total,
    ).toBe(120);
    expect(snapshot.workerPools.find((summary) => summary.name === "mesh")?.tasksCompleted).toBe(1);
  });

  test("tasks beyond the worker count wait in the queue and show queue wait", async () => {
    const { pool, workers } = createPool(2);
    const pendingTasks = [0, 1, 2].map((index) => pool.exec("generateChunk", [index]));
    expect(workers.length).toBe(2);

    await Bun.sleep(25);
    const firstRequest = workers[0].receivedRequests[0];
    workers[0].deliver({ id: firstRequest.id, result: new ArrayBuffer(8), profile: plausibleWorkerProfile(1) });
    workers[0].deliver({ id: firstRequest.id, resultTail: { resultPostMs: 0.1 } });
    const thirdRequest = workers[0].receivedRequests[1];
    expect(thirdRequest).toBeDefined();
    workers[0].deliver({ id: thirdRequest.id, result: new ArrayBuffer(8), profile: plausibleWorkerProfile(1) });
    workers[0].deliver({ id: thirdRequest.id, resultTail: { resultPostMs: 0.1 } });
    const secondRequest = workers[1].receivedRequests[0];
    workers[1].deliver({ id: secondRequest.id, result: new ArrayBuffer(8), profile: plausibleWorkerProfile(1) });
    workers[1].deliver({ id: secondRequest.id, resultTail: { resultPostMs: 0.1 } });
    await Promise.all(pendingTasks);

    const queueWait = timerNamed("queue.mesh.generateChunk.wait");
    expect(queueWait?.count).toBe(3);
    expect(queueWait?.max).toBeGreaterThanOrEqual(20);
    expect(queueWait?.min).toBeLessThan(5);
    const queueDepth = profiler.snapshot().gauges.find((gauge) => gauge.name === "pool.mesh.queueDepth");
    expect(queueDepth?.max).toBeGreaterThanOrEqual(1);
  });

  test("a failed task rejects and is counted as failed", async () => {
    const { pool, workers } = createPool(1);
    const pending = pool.exec("generateMesh", [1]);
    const request = workers[0].receivedRequests[0];
    workers[0].deliver({ id: request.id, error: "mesh exploded", profile: plausibleWorkerProfile(2) });

    await expect(pending).rejects.toBe("mesh exploded");
    const summary = profiler.snapshot().workerPools.find((pool) => pool.name === "mesh");
    expect(summary?.tasksFailed).toBe(1);
    expect(summary?.tasksCompleted).toBe(0);
    expect(timerNamed("worker.mesh.generateMesh.exec")?.total).toBe(2);
  });

  test("terminating before the result tail arrives still records the task", async () => {
    const { pool, workers } = createPool(1);
    const pending = pool.exec("generateMesh", [1]);
    const request = workers[0].receivedRequests[0];
    workers[0].deliver({ id: request.id, result: new ArrayBuffer(16), profile: plausibleWorkerProfile(3) });
    await pending;
    pool.terminate();

    expect(timerNamed("worker.mesh.generateMesh.exec")?.total).toBe(3);
    expect(timerNamed("transfer.mesh.generateMesh.workerSerialize")).toBeUndefined();
  });

  test("progress messages still reach the caller and do not complete the task", async () => {
    const { pool, workers } = createPool(1);
    const progressFractions: number[] = [];
    const pending = pool.exec("loadTextureArray", ["origin"], (fraction) => progressFractions.push(fraction));
    const request = workers[0].receivedRequests[0];
    workers[0].deliver({ id: request.id, progress: 0.5 });
    workers[0].deliver({ id: request.id, result: "done", profile: plausibleWorkerProfile(1) });
    workers[0].deliver({ id: request.id, resultTail: { resultPostMs: 0 } });

    expect(await pending).toBe("done");
    expect(progressFractions).toEqual([0.5]);
  });
});

describe("WorkerPool with the profiler disabled", () => {
  test("resolves results, sends no profile flag and records nothing", async () => {
    profiler.setEnabled(false);
    profiler.reset("worker-pool-disabled-test");
    const { pool, workers } = createPool(1, "disabledPool");
    const pending = pool.exec("generateChunk", [new ArrayBuffer(64)]);
    const request = workers[0].receivedRequests[0];
    expect(request.profile).toBeUndefined();
    workers[0].deliver({ id: request.id, result: "chunk" });

    expect(await pending).toBe("chunk");
    const snapshot = profiler.snapshot();
    expect(snapshot.timers.filter((timer) => timer.name.includes("disabledPool"))).toEqual([]);
    expect(snapshot.bytes).toEqual([]);
  });
});
