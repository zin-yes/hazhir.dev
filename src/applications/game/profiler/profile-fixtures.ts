import { Profiler } from "./profiler";
import { ingestWorkerTask } from "./worker-task-ingest";
import type { MeshGeometryStats, ProfileSnapshot } from "./types";

/**
 * Test helper: drives the real Profiler with a fake clock through a simulated
 * play session so report, hint and markdown tests run on realistic snapshots
 * (nested scopes, worker round trips, frame spikes) instead of tidy fixtures.
 */

export interface SimulatedScope {
  name: string;
  milliseconds: number;
  /** Scopes nested inside this one; their time is part of `milliseconds`. */
  children?: { name: string; milliseconds: number }[];
}

export interface SimulatedWorkerTask {
  poolName: string;
  method: string;
  workerCount: number;
  everyFrames: number;
  executionMs: number;
  sectionSelfMs: { [sectionName: string]: number };
  counters: { [counterName: string]: number };
  paramBytes: number;
  resultBytes: number;
  mainPostMs: number;
  resultPostMs: number;
  queueWaitMs: number;
  queueDepth: number;
}

export interface SimulatedScenario {
  seconds: number;
  frameIntervalMs: number;
  scopes: SimulatedScope[];
  spike?: { everyFrames: number; scopeName: string; milliseconds: number };
  gpuFrameMs?: number;
  frameGauges?: { name: string; value: number; unit?: string }[];
  secondGauges?: { name: string; value: number; unit?: string }[];
  frameCounters?: { name: string; amount: number; unit?: string }[];
  workerTasks?: SimulatedWorkerTask[];
  meshes?: { chunkName: string; stats: MeshGeometryStats }[];
  events?: { kind: "long-task" | "long-animation-frame" | "gc-estimate"; durationMs: number; detail: string }[];
  structuredCloneMegabytesPerSecond?: number;
}

export function simulateSession(scenario: SimulatedScenario): Profiler {
  let nowMs = 1000;
  const profiler = new Profiler(() => nowMs);
  profiler.setEnabled(true);
  profiler.setSessionInfo({
    gpuRenderer: "Simulated GPU",
    gpuTimerSupported: true,
    gpuTimerMode: "disjoint-timer-query",
    structuredCloneMegabytesPerSecond: scenario.structuredCloneMegabytesPerSecond ?? 800,
  });
  for (const task of scenario.workerTasks ?? []) {
    profiler.registerWorkerPool(task.poolName, task.workerCount);
  }
  for (const mesh of scenario.meshes ?? []) profiler.recordMesh(mesh.chunkName, mesh.stats);
  for (const event of scenario.events ?? []) profiler.logEvent(event.kind, event.durationMs, event.detail);

  const framesPerSecond = Math.round(1000 / scenario.frameIntervalMs);
  const totalFrames = scenario.seconds * framesPerSecond;

  for (let frame = 0; frame < totalFrames; frame++) {
    profiler.beginFrame();
    const frameId = profiler.currentFrameId;
    let spentMs = 0;

    for (const scope of scenario.scopes) {
      profiler.measure(scope.name, () => {
        const childMs = (scope.children ?? []).reduce((sum, child) => sum + child.milliseconds, 0);
        nowMs += scope.milliseconds - childMs;
        for (const child of scope.children ?? []) {
          profiler.measure(child.name, () => {
            nowMs += child.milliseconds;
          });
        }
      });
      spentMs += scope.milliseconds;
    }

    const spike = scenario.spike;
    if (spike && frame > 0 && frame % spike.everyFrames === 0) {
      profiler.measure(spike.scopeName, () => {
        nowMs += spike.milliseconds;
      });
      spentMs += spike.milliseconds;
    }

    for (const task of scenario.workerTasks ?? []) {
      if (frame % task.everyFrames !== 0) continue;
      profiler.measure(`main.workerPost.${task.poolName}.${task.method}`, () => {
        nowMs += task.mainPostMs;
      });
      spentMs += task.mainPostMs;
      ingestSimulatedTask(profiler, task, nowMs);
    }

    if (scenario.gpuFrameMs !== undefined) {
      profiler.recordTimer("gpu.frame", scenario.gpuFrameMs, "gpu");
      profiler.attachGpuFrameTime(frameId, scenario.gpuFrameMs);
    }
    for (const gauge of scenario.frameGauges ?? []) {
      profiler.sampleGauge(gauge.name, gauge.value, gauge.unit);
    }
    for (const counter of scenario.frameCounters ?? []) {
      profiler.addCounter(counter.name, counter.amount, counter.unit);
    }

    nowMs += Math.max(0, scenario.frameIntervalMs - spentMs);
    profiler.endFrame();

    if (frame % framesPerSecond === 0) {
      for (const gauge of scenario.secondGauges ?? []) {
        profiler.sampleGauge(gauge.name, gauge.value, gauge.unit);
      }
    }
  }
  profiler.beginFrame();
  return profiler;
}

export function simulateSnapshot(scenario: SimulatedScenario): ProfileSnapshot {
  return simulateSession(scenario).snapshot("simulated");
}

function ingestSimulatedTask(profiler: Profiler, task: SimulatedWorkerTask, completedAtMs: number) {
  const enqueuedAtMs = completedAtMs - 20;
  const dispatchedAtMs = enqueuedAtMs + task.queueWaitMs;
  const receivedAtEpochMs = dispatchedAtMs + 1;
  const finishedAtEpochMs = receivedAtEpochMs + task.executionMs;
  ingestWorkerTask(profiler, {
    poolName: task.poolName,
    method: task.method,
    enqueuedAtMs,
    dispatchedAtMs,
    completedAtMs,
    postedToWorkerAtEpochMs: dispatchedAtMs,
    receivedFromWorkerAtEpochMs: finishedAtEpochMs + task.resultPostMs + 1,
    paramBytes: task.paramBytes,
    resultBytes: task.resultBytes,
    failed: false,
    queueDepthAtEnqueue: task.queueDepth,
    workerResultPostMs: task.resultPostMs,
    workerProfile: {
      receivedAtEpochMs,
      executionStartedAtEpochMs: receivedAtEpochMs,
      executionFinishedAtEpochMs: finishedAtEpochMs,
      executionMs: task.executionMs,
      sectionSelfMs: task.sectionSelfMs,
      counters: task.counters,
    },
  });
}

/** A busy desktop session: chunk streaming, remeshing, React re-renders, GL uploads. */
export function busyGameScenario(overrides: Partial<SimulatedScenario> = {}): SimulatedScenario {
  const meshStats = (chunkIndex: number): MeshGeometryStats => {
    const vertexCount = 9000 + chunkIndex * 100;
    return {
      kind: "opaque",
      vertexCount,
      triangleCount: vertexCount / 2,
      bytesByAttribute: {
        positions: vertexCount * 12,
        normals: vertexCount * 12,
        uvs: vertexCount * 8,
        textureIndices: vertexCount * 4,
        lightLevels: vertexCount * 4,
        ambientOcclusion: vertexCount * 4,
        indices: (vertexCount / 2) * 12,
      },
    };
  };
  return {
    seconds: 12,
    frameIntervalMs: 20,
    scopes: [
      {
        name: "main.frame.render",
        milliseconds: 6,
        children: [{ name: "main.gl.upload", milliseconds: 1.5 }],
      },
      { name: "main.frame.updateIndicator", milliseconds: 1.2 },
      { name: "main.player.update", milliseconds: 0.4 },
      { name: "main.react.gameRender", milliseconds: 0.8 },
    ],
    spike: { everyFrames: 90, scopeName: "main.chunks.addChunkMesh", milliseconds: 45 },
    gpuFrameMs: 5,
    frameGauges: [
      { name: "gpu.drawCalls", value: 180 },
      { name: "gpu.triangles", value: 410000 },
    ],
    secondGauges: [
      { name: "memory.geometryBytes", value: 48 * 1024 * 1024, unit: "bytes" },
      { name: "memory.chunkDataBytes", value: 2 * 1024 * 1024, unit: "bytes" },
    ],
    workerTasks: [
      {
        poolName: "mesh",
        method: "generateMesh",
        workerCount: 3,
        everyFrames: 2,
        executionMs: 28,
        sectionSelfMs: { faceLoop: 21, pack: 6 },
        counters: { facesEmitted: 5200, blocksScanned: 32768 },
        paramBytes: 32768 * 2 + 6 * 2048,
        resultBytes: 520_000,
        mainPostMs: 0.35,
        resultPostMs: 1.1,
        queueWaitMs: 4,
        queueDepth: 3,
      },
    ],
    meshes: Array.from({ length: 24 }, (_, chunkIndex) => ({
      chunkName: `${chunkIndex},0,0`,
      stats: meshStats(chunkIndex),
    })),
    ...overrides,
  };
}
