import { describe, expect, test } from "bun:test";
import {
  aggregateSamples,
  MAX_STACK_FRAMES_KEPT,
  SamplingProfiler,
  TRUNCATED_STACK_MARKER,
  type JsSelfProfilingSample,
  type JsSelfProfilingTrace,
} from "./sampling-profiler";

const GAME_RESOURCE = "https://hazhir.dev/_next/static/chunks/game.js?v=3";
const THREE_RESOURCE = "https://hazhir.dev/_next/static/chunks/node_modules_three.js";
const SAMPLE_INTERVAL_MS = 2;

function buildSamples(stackCounts: { stackId?: number; count: number }[]): JsSelfProfilingSample[] {
  const samples: JsSelfProfilingSample[] = [];
  for (const { stackId, count } of stackCounts) {
    for (let repeat = 0; repeat < count; repeat += 1) {
      samples.push({ timestamp: samples.length * SAMPLE_INTERVAL_MS, stackId });
    }
  }
  return samples;
}

/**
 * main loop > renderFrame > WebGLRenderer.render > projectObject x3 (recursion)
 * main loop > buildGeometry > fillFaces (two frame ids, same function)
 * renderFrame > anonymous closure, renderFrame > native frame without name or resource
 */
function buildRealisticTrace(): JsSelfProfilingTrace {
  return {
    resources: [GAME_RESOURCE, THREE_RESOURCE],
    frames: [
      { name: "mainLoop", resourceId: 0, line: 10, column: 4 },
      { name: "renderFrame", resourceId: 0, line: 50, column: 2 },
      { name: "buildGeometry", resourceId: 0, line: 120, column: 8 },
      { name: "fillFaces", resourceId: 0, line: 200, column: 12 },
      { name: "render", resourceId: 1, line: 800, column: 6 },
      { name: "projectObject", resourceId: 1, line: 300, column: 14 },
      { name: "", resourceId: 0, line: 77, column: 3 },
      {},
      { name: "fillFaces", resourceId: 0, line: 200, column: 40 },
    ],
    stacks: [
      { frameId: 0 },
      { frameId: 1, parentId: 0 },
      { frameId: 4, parentId: 1 },
      { frameId: 5, parentId: 2 },
      { frameId: 5, parentId: 3 },
      { frameId: 5, parentId: 4 },
      { frameId: 2, parentId: 0 },
      { frameId: 3, parentId: 6 },
      { frameId: 8, parentId: 6 },
      { frameId: 6, parentId: 1 },
      { frameId: 7, parentId: 1 },
    ],
    samples: buildSamples([
      { stackId: 5, count: 6 },
      { stackId: undefined, count: 2 },
      { stackId: 4, count: 2 },
      { stackId: 3, count: 1 },
      { stackId: 7, count: 4 },
      { stackId: 8, count: 3 },
      { stackId: undefined, count: 3 },
      { stackId: 6, count: 2 },
      { stackId: 9, count: 3 },
      { stackId: 10, count: 1 },
      { stackId: 1, count: 2 },
      { stackId: 0, count: 1 },
    ]),
  };
}

describe("aggregateSamples", () => {
  const aggregate = aggregateSamples(buildRealisticTrace(), SAMPLE_INTERVAL_MS);

  test("counts only samples with a stack and reports idle separately", () => {
    expect(aggregate.totalSamples).toBe(25);
    expect(aggregate.idleSamples).toBe(5);
    expect(aggregate.sampleIntervalMs).toBe(SAMPLE_INTERVAL_MS);
    expect(aggregate.durationMs).toBe((30 - 1) * SAMPLE_INTERVAL_MS + SAMPLE_INTERVAL_MS);
  });

  test("self time goes to the leaf function, recursion included, ranked by samples", () => {
    expect(aggregate.topSelf.map((entry) => [entry.functionName, entry.samples])).toEqual([
      ["projectObject", 9],
      ["fillFaces", 7],
      ["(anonymous)", 3],
      ["buildGeometry", 2],
      ["renderFrame", 2],
      ["(anonymous)", 1],
      ["mainLoop", 1],
    ]);
    const projectObject = aggregate.topSelf[0]!;
    expect(projectObject.resource).toBe(THREE_RESOURCE);
    expect(projectObject.line).toBe(300);
    expect(projectObject.selfMs).toBe(9 * SAMPLE_INTERVAL_MS);
  });

  test("merges frames with the same name, resource and line across frame ids", () => {
    const fillFacesEntries = aggregate.topSelf.filter((entry) => entry.functionName === "fillFaces");
    expect(fillFacesEntries).toHaveLength(1);
    expect(fillFacesEntries[0]!.samples).toBe(7);
  });

  test("keeps unnamed frames apart by resource and line", () => {
    const anonymousEntries = aggregate.topSelf.filter((entry) => entry.functionName === "(anonymous)");
    expect(anonymousEntries.map((entry) => [entry.resource, entry.line, entry.samples])).toEqual([
      [GAME_RESOURCE, 77, 3],
      ["", 0, 1],
    ]);
  });

  test("self samples add up to total busy samples", () => {
    const selfTotal = aggregate.topSelf.reduce((sum, entry) => sum + entry.samples, 0);
    expect(selfTotal).toBe(aggregate.totalSamples);
  });

  test("inclusive time counts a recursive function once per sample", () => {
    const inclusiveByName = new Map(
      aggregate.topInclusive.map((entry) => [`${entry.functionName}:${entry.line}`, entry]),
    );
    const projectObject = inclusiveByName.get("projectObject:300")!;
    expect(projectObject.samples).toBe(9);
    expect(projectObject.inclusiveMs).toBe(9 * SAMPLE_INTERVAL_MS);
    expect(projectObject.samples).toBeLessThanOrEqual(aggregate.totalSamples);
  });

  test("inclusive time of shared ancestors covers all descendants", () => {
    const inclusiveSamples = Object.fromEntries(
      aggregate.topInclusive.map((entry) => [entry.functionName + entry.line, entry.samples]),
    );
    expect(inclusiveSamples["mainLoop10"]).toBe(25);
    expect(inclusiveSamples["renderFrame50"]).toBe(9 + 3 + 1 + 2);
    expect(inclusiveSamples["render800"]).toBe(9);
    expect(inclusiveSamples["buildGeometry120"]).toBe(2 + 4 + 3);
    expect(aggregate.topInclusive[0]!.functionName).toBe("mainLoop");
  });

  test("top stacks are root first and ranked by samples", () => {
    expect(aggregate.topStacks.map((stack) => stack.samples).slice(0, 2)).toEqual([7, 6]);
    const recursiveStack = aggregate.topStacks[1]!;
    expect(recursiveStack.frames).toEqual([
      "mainLoop (game.js:10)",
      "renderFrame (game.js:50)",
      "render (node_modules_three.js:800)",
      "projectObject (node_modules_three.js:300)",
      "projectObject (node_modules_three.js:300)",
      "projectObject (node_modules_three.js:300)",
    ]);
    const stackSampleTotal = aggregate.topStacks.reduce((sum, stack) => sum + stack.samples, 0);
    expect(stackSampleTotal).toBe(25);
  });

  test("stacks that differ only by frame id of the same function are one stack", () => {
    const fillFacesStacks = aggregate.topStacks.filter(
      (stack) => stack.frames[stack.frames.length - 1] === "fillFaces (game.js:200)",
    );
    expect(fillFacesStacks).toHaveLength(1);
    expect(fillFacesStacks[0]!.samples).toBe(7);
  });

  test("a trace of only idle samples yields an empty summary", () => {
    const idleOnly = aggregateSamples(
      { resources: [], frames: [], stacks: [], samples: buildSamples([{ count: 4 }]) },
      SAMPLE_INTERVAL_MS,
    );
    expect(idleOnly.totalSamples).toBe(0);
    expect(idleOnly.idleSamples).toBe(4);
    expect(idleOnly.topSelf).toEqual([]);
  });

  test("very deep stacks are truncated at the root side and keep the leaf", () => {
    const depth = MAX_STACK_FRAMES_KEPT + 20;
    const frames = Array.from({ length: depth }, (_, index) => ({
      name: `level${index}`,
      resourceId: 0,
      line: index + 1,
    }));
    const stacks = frames.map((_, index) => ({
      frameId: index,
      parentId: index === 0 ? undefined : index - 1,
    }));
    const deepAggregate = aggregateSamples(
      { resources: [GAME_RESOURCE], frames, stacks, samples: buildSamples([{ stackId: depth - 1, count: 3 }]) },
      SAMPLE_INTERVAL_MS,
    );
    const frameList = deepAggregate.topStacks[0]!.frames;
    expect(frameList[0]).toBe(TRUNCATED_STACK_MARKER);
    expect(frameList).toHaveLength(MAX_STACK_FRAMES_KEPT + 1);
    expect(frameList[frameList.length - 1]).toBe(`level${depth - 1} (game.js:${depth})`);
  });

  test("a corrupt parent cycle terminates", () => {
    const cyclic = aggregateSamples(
      {
        resources: [GAME_RESOURCE],
        frames: [{ name: "loopy", resourceId: 0, line: 1 }],
        stacks: [{ frameId: 0, parentId: 1 }, { frameId: 0, parentId: 0 }],
        samples: buildSamples([{ stackId: 0, count: 2 }]),
      },
      SAMPLE_INTERVAL_MS,
    );
    expect(cyclic.topInclusive[0]!.samples).toBe(2);
  });
});

type ProfilerConstructorOptions = { sampleInterval: number; maxBufferSize: number };

function buildWorkTrace(sampleCount: number, functionName = "work"): JsSelfProfilingTrace {
  return {
    resources: [GAME_RESOURCE],
    frames: [{ name: functionName, resourceId: 0, line: 5 }],
    stacks: [{ frameId: 0 }],
    samples: buildSamples([{ stackId: 0, count: sampleCount }]),
  };
}

function createFakeProfilerEnvironment(options: {
  minimumIntervalMs?: number;
  constructorError?: Error;
  stopError?: Error;
  samplesPerTrace?: number[];
}) {
  const instances: FakeProfiler[] = [];
  const pendingSampleCounts = [...(options.samplesPerTrace ?? [])];

  class FakeProfiler {
    readonly sampleInterval: number;
    readonly bufferFullListeners: (() => void)[] = [];
    readonly constructorOptions: ProfilerConstructorOptions;
    stopCalls = 0;

    constructor(constructorOptions: ProfilerConstructorOptions) {
      if (options.constructorError) throw options.constructorError;
      if (constructorOptions.sampleInterval < (options.minimumIntervalMs ?? 1)) {
        throw new RangeError("sampleInterval below the supported minimum");
      }
      this.constructorOptions = constructorOptions;
      this.sampleInterval = constructorOptions.sampleInterval;
      instances.push(this);
    }

    addEventListener(_type: "samplebufferfull", listener: () => void) {
      this.bufferFullListeners.push(listener);
    }

    async stop(): Promise<JsSelfProfilingTrace> {
      this.stopCalls += 1;
      if (options.stopError) throw options.stopError;
      return buildWorkTrace(pendingSampleCounts.shift() ?? 0);
    }

    fireBufferFull() {
      for (const listener of this.bufferFullListeners) listener();
    }
  }

  return { instances, constructorForProfiler: () => FakeProfiler };
}

describe("SamplingProfiler", () => {
  test("reports unsupported when the API is missing", async () => {
    const profiler = new SamplingProfiler(() => null);
    expect(profiler.isSupported()).toBe(false);
    expect(await profiler.start()).toBe(false);
    expect(profiler.summary()).toBeNull();
    expect(profiler.lastFailureReason()).toContain("not available");
  });

  test("start then stop aggregates the trace", async () => {
    const environment = createFakeProfilerEnvironment({ samplesPerTrace: [7] });
    const profiler = new SamplingProfiler(environment.constructorForProfiler);
    expect(await profiler.start(1)).toBe(true);
    expect(profiler.isRunning()).toBe(true);
    await profiler.stop();
    expect(profiler.isRunning()).toBe(false);
    const summary = profiler.summary()!;
    expect(summary.totalSamples).toBe(7);
    expect(summary.topSelf[0]!.functionName).toBe("work");
    expect(summary.sampleIntervalMs).toBe(1);
  });

  test("clamps to the smallest interval the browser accepts", async () => {
    const environment = createFakeProfilerEnvironment({ minimumIntervalMs: 8, samplesPerTrace: [3] });
    const profiler = new SamplingProfiler(environment.constructorForProfiler);
    expect(await profiler.start(1)).toBe(true);
    expect(environment.instances[0]!.constructorOptions.sampleInterval).toBe(8);
    await profiler.stop();
    expect(profiler.summary()!.sampleIntervalMs).toBe(8);
    expect(profiler.summary()!.topSelf[0]!.selfMs).toBe(3 * 8);
  });

  test("a missing Document-Policy header fails start without throwing", async () => {
    const notAllowed = new Error("js-profiling disabled by document policy");
    notAllowed.name = "NotAllowedError";
    const environment = createFakeProfilerEnvironment({ constructorError: notAllowed });
    const profiler = new SamplingProfiler(environment.constructorForProfiler);
    expect(await profiler.start()).toBe(false);
    expect(profiler.isRunning()).toBe(false);
    expect(profiler.lastFailureReason()).toContain("Document-Policy: js-profiling");
    expect(profiler.summary()).toBeNull();
  });

  test("a rejected stop is recorded and does not break later runs", async () => {
    const environment = createFakeProfilerEnvironment({ stopError: new Error("profiler detached") });
    const profiler = new SamplingProfiler(environment.constructorForProfiler);
    await profiler.start();
    await profiler.stop();
    expect(profiler.lastFailureReason()).toContain("profiler detached");
    expect(profiler.summary()).toBeNull();
    expect(await profiler.start()).toBe(true);
  });

  test("a full buffer is collected and sampling restarts, merging all runs", async () => {
    const environment = createFakeProfilerEnvironment({ samplesPerTrace: [20, 5, 4] });
    const profiler = new SamplingProfiler(environment.constructorForProfiler, 20);
    await profiler.start(1);
    expect(environment.instances[0]!.constructorOptions.maxBufferSize).toBe(20);

    environment.instances[0]!.fireBufferFull();
    await profiler.start();
    expect(environment.instances.length).toBe(2);
    expect(profiler.isRunning()).toBe(true);

    environment.instances[1]!.fireBufferFull();
    await profiler.start();
    expect(environment.instances.length).toBe(3);

    await profiler.stop();
    const summary = profiler.summary()!;
    expect(summary.totalSamples).toBe(20 + 5 + 4);
    expect(summary.topSelf).toHaveLength(1);
    expect(summary.topSelf[0]!.samples).toBe(29);
    expect(summary.durationMs).toBeGreaterThan(0);
  });

  test("a stale buffer-full event from a replaced profiler is ignored", async () => {
    const environment = createFakeProfilerEnvironment({ samplesPerTrace: [3, 2] });
    const profiler = new SamplingProfiler(environment.constructorForProfiler);
    await profiler.start();
    const firstProfiler = environment.instances[0]!;
    await profiler.flush();
    expect(environment.instances.length).toBe(2);

    firstProfiler.fireBufferFull();
    await profiler.start();
    expect(firstProfiler.stopCalls).toBe(1);
    expect(environment.instances.length).toBe(2);
  });

  test("reset drops collected samples and keeps sampling", async () => {
    const environment = createFakeProfilerEnvironment({ samplesPerTrace: [6, 6, 2] });
    const profiler = new SamplingProfiler(environment.constructorForProfiler);
    await profiler.start();
    await profiler.flush();
    expect(profiler.summary()!.totalSamples).toBe(6);

    await profiler.reset();
    expect(profiler.summary()).toBeNull();
    expect(profiler.isRunning()).toBe(true);

    await profiler.stop();
    expect(profiler.summary()!.totalSamples).toBe(2);
  });
});
