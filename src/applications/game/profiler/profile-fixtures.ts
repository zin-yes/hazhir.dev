import { Profiler } from "./profiler";
import { ingestWorkerTask } from "./worker-task-ingest";
import type {
  BreakdownEntry,
  CallTreeNode,
  MeshGeometryStats,
  ProfileSnapshot,
  SamplingSummary,
  TraceSpan,
} from "./types";

/**
 * Test helper: drives the real Profiler with a fake clock through a simulated
 * play session so report, hint and markdown tests run on realistic snapshots
 * (nested scopes, worker round trips, frame spikes) instead of tidy fixtures.
 */

export interface SimulatedScope {
  name: string;
  milliseconds: number;
  /** Scopes nested inside this one, to any depth; their time is part of `milliseconds`. */
  children?: SimulatedScope[];
}

/** A worker section with its own time excluding children, nested to any depth. */
export interface SimulatedSection {
  name: string;
  selfMs: number;
  /** Defaults to 1. */
  calls?: number;
  /** Marks the time as extrapolated from sampled calls. */
  estimated?: boolean;
  children?: SimulatedSection[];
}

export interface SimulatedBreakdownEntry {
  key: string;
  selfMs: number;
  units?: number;
  calls?: number;
}

export interface SimulatedWorkerTask {
  poolName: string;
  method: string;
  workerCount: number;
  everyFrames: number;
  executionMs: number;
  /** Flat sections; ignored when `nestedSections` is given. */
  sectionSelfMs?: { [sectionName: string]: number };
  /** Nested sections per task; also drives the call tree and trace spans. */
  nestedSections?: SimulatedSection[];
  /** Cost per key per dimension recorded by each task. */
  breakdowns?: { [dimension: string]: SimulatedBreakdownEntry[] };
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
  /** Main-thread breakdown amounts recorded every frame (cost per key per dimension). */
  frameBreakdowns?: { dimension: string; key: string; selfMs?: number; units?: number; calls?: number }[];
  /** Captures timeline spans for main-thread scopes and worker sections. */
  trace?: boolean;
  sampling?: SamplingSummary;
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
  if (scenario.trace) profiler.setTracing(true);
  if (scenario.sampling) profiler.setSamplingSummaryProvider(() => scenario.sampling ?? null);
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

    const runScope = (scope: SimulatedScope) => {
      profiler.measure(scope.name, () => {
        const children = scope.children ?? [];
        const childMs = children.reduce((sum, child) => sum + child.milliseconds, 0);
        nowMs += scope.milliseconds - childMs;
        children.forEach(runScope);
      });
    };
    for (const scope of scenario.scopes) {
      runScope(scope);
      spentMs += scope.milliseconds;
    }
    for (const breakdown of scenario.frameBreakdowns ?? []) {
      profiler.recordBreakdown(breakdown.dimension, breakdown.key, breakdown);
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
      ingestSimulatedTask(profiler, task, nowMs, scenario.trace === true);
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

interface FlattenedSections {
  callTree: CallTreeNode[];
  sectionSelfMs: { [sectionName: string]: number };
  spans: TraceSpan[];
}

function flattenSections(sections: SimulatedSection[]): FlattenedSections {
  const flattened: FlattenedSections = { callTree: [], sectionSelfMs: {}, spans: [] };
  let cursorMs = 0;
  const visit = (section: SimulatedSection, parentPath: string, startMs: number, depth: number): number => {
    const path = parentPath === "" ? section.name : `${parentPath}>${section.name}`;
    const calls = section.calls ?? 1;
    const node: CallTreeNode = {
      path,
      calls,
      totalMs: section.selfMs,
      selfMs: section.selfMs,
      maxMs: section.selfMs / calls,
      estimated: section.estimated === true,
    };
    flattened.callTree.push(node);
    flattened.sectionSelfMs[section.name] = (flattened.sectionSelfMs[section.name] ?? 0) + section.selfMs;
    const spanIndex = flattened.spans.length;
    flattened.spans.push({ name: section.name, startMs, durationMs: section.selfMs, depth });
    let childStartMs = startMs + section.selfMs;
    for (const child of section.children ?? []) {
      const childTotalMs = visit(child, path, childStartMs, depth + 1);
      node.totalMs += childTotalMs;
      childStartMs += childTotalMs;
    }
    flattened.spans[spanIndex].durationMs = node.totalMs;
    return node.totalMs;
  };
  for (const section of sections) cursorMs += visit(section, "", cursorMs, 0);
  return flattened;
}

function ingestSimulatedTask(
  profiler: Profiler,
  task: SimulatedWorkerTask,
  completedAtMs: number,
  captureSpans: boolean,
) {
  const flattened = flattenSections(
    task.nestedSections ??
      Object.entries(task.sectionSelfMs ?? {}).map(([name, selfMs]) => ({ name, selfMs })),
  );
  const breakdowns: { [dimension: string]: BreakdownEntry[] } = {};
  for (const [dimension, entries] of Object.entries(task.breakdowns ?? {})) {
    breakdowns[dimension] = entries.map((entry) => ({
      key: entry.key,
      calls: entry.calls ?? 1,
      selfMs: entry.selfMs,
      totalMs: entry.selfMs,
      units: entry.units ?? 0,
    }));
  }

  const epochBaseMs = performance.timeOrigin;
  const enqueuedAtMs = completedAtMs - 20;
  const dispatchedAtMs = enqueuedAtMs + task.queueWaitMs;
  const receivedAtEpochMs = epochBaseMs + dispatchedAtMs + 1;
  const finishedAtEpochMs = receivedAtEpochMs + task.executionMs;
  ingestWorkerTask(profiler, {
    poolName: task.poolName,
    method: task.method,
    enqueuedAtMs,
    dispatchedAtMs,
    completedAtMs,
    postedToWorkerAtEpochMs: epochBaseMs + dispatchedAtMs,
    receivedFromWorkerAtEpochMs: finishedAtEpochMs + task.resultPostMs + 1,
    paramBytes: task.paramBytes,
    resultBytes: task.resultBytes,
    failed: false,
    queueDepthAtEnqueue: task.queueDepth,
    workerResultPostMs: task.resultPostMs,
    workerTrackName: `${task.poolName} worker`,
    workerProfile: {
      receivedAtEpochMs,
      executionStartedAtEpochMs: receivedAtEpochMs,
      executionFinishedAtEpochMs: finishedAtEpochMs,
      executionMs: task.executionMs,
      sectionSelfMs: flattened.sectionSelfMs,
      counters: task.counters,
      callTree: flattened.callTree,
      breakdowns,
      spans: captureSpans ? flattened.spans : undefined,
      droppedSpans: 0,
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

/**
 * A chunk generation worker task with nested, partly sampled sections and
 * tagged breakdowns (per biome, biome x stage, per block). Section times add
 * up to 33 ms of the 44 ms execution, leaving 25% uninstrumented.
 */
export function worldgenTask(overrides: Partial<SimulatedWorkerTask> = {}): SimulatedWorkerTask {
  return {
    poolName: "worldgen",
    method: "generateChunk",
    workerCount: 2,
    everyFrames: 5,
    executionMs: 44,
    nestedSections: [
      {
        name: "noise",
        selfMs: 6,
        children: [{ name: "density", selfMs: 4, calls: 4096, estimated: true }],
      },
      { name: "carve", selfMs: 3 },
      {
        name: "features",
        selfMs: 4,
        children: [
          { name: "placeTree", selfMs: 14, calls: 6 },
          { name: "placeOre", selfMs: 2, calls: 10 },
        ],
      },
    ],
    breakdowns: {
      "worldgen.biome": [
        { key: "forest", selfMs: 20, units: 4096, calls: 1 },
        { key: "desert", selfMs: 5, units: 4096, calls: 1 },
        { key: "plains", selfMs: 3, units: 4096, calls: 1 },
      ],
      "worldgen.biomeStage": [
        { key: "forest|features", selfMs: 15, calls: 1 },
        { key: "forest|noise", selfMs: 4, calls: 1 },
        { key: "desert|noise", selfMs: 2, calls: 1 },
        { key: "desert|features", selfMs: 3, calls: 1 },
        { key: "desert|carve", selfMs: 1, calls: 1 },
      ],
      "worldgen.block": [
        { key: "stone", selfMs: 0, units: 20000, calls: 1 },
        { key: "dirt", selfMs: 0, units: 5000, calls: 1 },
      ],
    },
    counters: { blocksGenerated: 32768 },
    paramBytes: 256,
    resultBytes: 65536,
    mainPostMs: 0.1,
    resultPostMs: 0.4,
    queueWaitMs: 2,
    queueDepth: 1,
    ...overrides,
  };
}

/** Six seconds of play with nested main-thread scopes, one worldgen worker and a captured trace. */
export function worldgenScenario(overrides: Partial<SimulatedScenario> = {}): SimulatedScenario {
  return {
    seconds: 6,
    frameIntervalMs: 20,
    scopes: [
      {
        name: "main.frame.render",
        milliseconds: 4,
        children: [
          {
            name: "main.gl.upload",
            milliseconds: 1,
            children: [{ name: "main.gl.bufferData", milliseconds: 0.6 }],
          },
        ],
      },
      { name: "main.player.update", milliseconds: 0.4 },
    ],
    spike: { everyFrames: 90, scopeName: "main.chunks.addChunkMesh", milliseconds: 45 },
    gpuFrameMs: 4,
    workerTasks: [worldgenTask()],
    frameBreakdowns: [
      { dimension: "ui.surface", key: "hud", selfMs: 0.3, calls: 1 },
      { dimension: "ui.surface", key: "minimap", selfMs: 0.1, calls: 1 },
    ],
    trace: true,
    sampling: {
      sampleIntervalMs: 1,
      totalSamples: 2000,
      durationMs: 2000,
      topSelf: [
        { functionName: "packVertices", resource: "mesh-worker.js", line: 212, samples: 640, selfMs: 640 },
        { functionName: "", resource: "game.js", line: 31, samples: 120, selfMs: 120 },
      ],
      topStacks: [{ frames: ["tick", "updateChunks", "packVertices"], samples: 640 }],
    },
    ...overrides,
  };
}
