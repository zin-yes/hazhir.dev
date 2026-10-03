import { describe, expect, test } from "bun:test";
import { BlockType } from "../blocks";
import {
  type BenchmarkBridge,
  buildPhasePlan,
  computeEditTarget,
  computeFlightPose,
  computeHoverPose,
  computeLightEditTarget,
  mergeSnapshots,
  runBenchmark,
} from "./benchmark";
import { Profiler } from "./profiler";

describe("buildPhasePlan", () => {
  test("defaults to load, fly, hover (with warmup), edit and light-edit in order", () => {
    const plan = buildPhasePlan();
    expect(plan.map((phase) => phase.name)).toEqual([
      "world-load",
      "fly",
      "hover",
      "edit",
      "light-edit",
    ]);
    expect(plan[0].durationSeconds).toBeNull();
    expect(
      plan.find((phase) => phase.name === "hover")!.warmupSeconds,
    ).toBeGreaterThan(0);
  });

  test("a phase set to zero seconds is dropped but the load phase stays", () => {
    const plan = buildPhasePlan({
      flySeconds: 0,
      editSeconds: 0,
      lightEditSeconds: 0,
      hoverSeconds: 5,
    });
    expect(plan.map((phase) => phase.name)).toEqual(["world-load", "hover"]);
    expect(plan[1].durationSeconds).toBe(5);
  });
});

describe("computeFlightPose", () => {
  test("covers speed times elapsed blocks along x at constant altitude", () => {
    const pose = computeFlightPose(2.5, { x: 10, y: 70, z: -4 }, 12);
    expect(pose.position).toEqual({ x: 40, y: 70, z: -4 });
  });

  test("faces the direction of travel so new chunks are in view", () => {
    const pose = computeFlightPose(0, { x: 0, y: 0, z: 0 }, 12);
    const forwardX = -Math.sin(pose.yaw) * Math.cos(pose.pitch);
    const forwardZ = -Math.cos(pose.yaw) * Math.cos(pose.pitch);
    expect(forwardX).toBeGreaterThan(0.9);
    expect(Math.abs(forwardZ)).toBeLessThan(1e-9);
  });
});

describe("computeLightEditTarget", () => {
  const center = { x: 100, y: 60, z: -50 };

  test("cycles place light, break, place block, break at one spot before moving on", () => {
    const cycle = [0, 1, 2, 3].map((index) =>
      computeLightEditTarget(index, center),
    );
    expect(cycle.map((target) => target.blockType)).toEqual([
      BlockType.GLOWSTONE,
      BlockType.AIR,
      BlockType.STONE,
      BlockType.AIR,
    ]);
    for (const target of cycle)
      expect([target.x, target.z]).toEqual([cycle[0].x, cycle[0].z]);
    const nextSpot = computeLightEditTarget(4, center);
    expect([nextSpot.x, nextSpot.z]).not.toEqual([cycle[0].x, cycle[0].z]);
  });
});

describe("computeHoverPose", () => {
  test("keeps the position and turns the camera over time", () => {
    const position = { x: 1, y: 2, z: 3 };
    const early = computeHoverPose(0, position);
    const later = computeHoverPose(4, position);
    expect(later.position).toEqual(position);
    expect(later.yaw).toBeGreaterThan(early.yaw);
  });
});

describe("computeEditTarget", () => {
  const center = { x: 100, y: 60, z: -50 };

  test("breaks exactly the block it just placed", () => {
    for (let pair = 0; pair < 40; pair++) {
      const placement = computeEditTarget(pair * 2, center);
      const removal = computeEditTarget(pair * 2 + 1, center);
      expect(placement.action).toBe("place");
      expect(removal.action).toBe("break");
      expect([removal.x, removal.z]).toEqual([placement.x, placement.z]);
      expect(removal.blockType).toBe(BlockType.AIR);
    }
  });

  test("exercises both ordinary blocks and light sources", () => {
    const placedTypes = new Set<number>();
    for (let index = 0; index < 20; index += 2) {
      placedTypes.add(computeEditTarget(index, center).blockType);
    }
    expect(placedTypes).toEqual(
      new Set([BlockType.STONE, BlockType.GLOWSTONE]),
    );
  });

  test("stays within the ring around the center", () => {
    for (let index = 0; index < 64; index++) {
      const target = computeEditTarget(index, center);
      const distance = Math.hypot(target.x - center.x, target.z - center.z);
      expect(distance).toBeGreaterThan(4);
      expect(distance).toBeLessThan(8);
    }
  });
});

describe("mergeSnapshots", () => {
  function snapshotWithScope(
    totalMs: number,
    count: number,
    maxMs: number,
    seconds: number,
  ) {
    let nowMs = 0;
    const profiler = new Profiler(() => nowMs);
    profiler.setEnabled(true);
    for (let call = 0; call < count; call++) {
      profiler.recordTimer(
        "main.chunk.buildGeometry",
        totalMs / count,
        "main-cpu",
      );
    }
    profiler.recordTimer("main.chunk.buildGeometry", maxMs, "main-cpu");
    profiler.addCounter("game.setBlock.calls", count);
    nowMs = seconds * 1000;
    return profiler.snapshot("phase");
  }

  test("sums totals and counts, keeps the true max and derives rates from combined time", () => {
    const first = snapshotWithScope(10, 10, 3, 2);
    const second = snapshotWithScope(30, 10, 9, 2);
    const merged = mergeSnapshots([first, second], "overall");

    const timer = merged.timers.find(
      (candidate) => candidate.name === "main.chunk.buildGeometry",
    )!;
    expect(timer.count).toBe(22);
    expect(timer.total).toBeCloseTo(10 + 3 + 30 + 9, 5);
    expect(timer.max).toBe(9);
    expect(timer.selfTotal).toBeCloseTo(52, 5);
    expect(timer.recentPerSecondTotal).toBeCloseTo(52 / 4, 5);
    expect(
      merged.counters.find((c) => c.name === "game.setBlock.calls")!.total,
    ).toBe(20);
    expect(merged.label).toBe("overall");
  });
});

describe("runBenchmark", () => {
  function createFakeBridge() {
    let frameCallback: ((deltaSeconds: number) => void) | null = null;
    const edits: { x: number; y: number; z: number; blockType: number }[] = [];
    const settledEdits: {
      x: number;
      y: number;
      z: number;
      blockType: number;
    }[] = [];
    const poses: { x: number; y: number; z: number }[] = [];
    const calls: string[] = [];
    const bridge: BenchmarkBridge = {
      enterBenchmarkWorld: (seed) => calls.push(`enter:${seed}`),
      waitUntilWorldLoaded: async () => {},
      setPlaying: (playing) => calls.push(`playing:${playing}`),
      setFlying: (flying) => calls.push(`flying:${flying}`),
      setCameraPose: (pose) => poses.push({ ...pose.position }),
      getCameraPosition: () => ({ x: 0, y: 70, z: 0 }),
      editBlock: (x, y, z, blockType) => edits.push({ x, y, z, blockType }),
      editBlockAndSettle: async (x, y, z, blockType) => {
        settledEdits.push({ x, y, z, blockType });
      },
      onFrame: (callback) => {
        frameCallback = callback;
        return () => {
          frameCallback = null;
        };
      },
      restore: () => calls.push("restore"),
      getSurfaceHeight: () => 60,
    };
    return {
      bridge,
      edits,
      settledEdits,
      poses,
      calls,
      pumpFrame: () => frameCallback?.(0.1),
    };
  }

  test("runs every phase in order, drives the camera and edits, then restores", async () => {
    const fake = createFakeBridge();
    const pump = setInterval(fake.pumpFrame, 0);
    const result = await runBenchmark(fake.bridge, {
      seed: 7,
      flySeconds: 1,
      hoverSeconds: 1,
      editSeconds: 1,
      lightEditSeconds: 0.3,
    });
    clearInterval(pump);

    expect(result.seed).toBe(7);
    expect(result.phases.map((phase) => phase.name)).toEqual([
      "world-load",
      "fly",
      "hover",
      "edit",
      "light-edit",
    ]);
    expect(fake.settledEdits.length).toBeGreaterThanOrEqual(2);
    expect(fake.calls[0]).toBe("enter:7");
    expect(fake.calls).toContain("playing:true");
    expect(fake.calls[fake.calls.length - 1]).toBe("restore");

    const flightXs = fake.poses.map((pose) => pose.x);
    expect(Math.max(...flightXs)).toBeGreaterThan(10);
    expect(fake.edits.length).toBeGreaterThanOrEqual(8);
    expect(fake.edits.every((edit) => edit.y === 61)).toBe(true);
    expect(result.overall.snapshot.label).toBe("benchmark-overall");
  });

  test("restores the game even when the world never finishes loading", async () => {
    const fake = createFakeBridge();
    fake.bridge.waitUntilWorldLoaded = async () => {
      throw new Error("timeout");
    };
    await expect(runBenchmark(fake.bridge)).rejects.toThrow("timeout");
    expect(fake.calls[fake.calls.length - 1]).toBe("restore");
  });
});
