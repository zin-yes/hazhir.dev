import { describe, expect, test } from "bun:test";
import {
  chunkKeyX,
  chunkKeyY,
  chunkKeyZ,
  createChunkCoordinates,
  packChunkKey,
  type ChunkCoordinates,
} from "./chunk-key";
import { DIMENSIONS } from "../profiler/dimensions";
import { breakdownUnits, counterTotal, withEnabledProfiler } from "./profiler-readings.test-helper";
import { ChunkStreamPlanner, buildLoadOrder, type ChunkStreamConfig, type ChunkStreamPlan } from "./streaming-plan";

const FORWARD_NORTH = { x: 0, y: 0, z: -1 };

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function playerAt(chunkX: number, chunkY: number, chunkZ: number): ChunkCoordinates {
  return { chunkX, chunkY, chunkZ };
}

function applyPlan(known: Set<number>, plan: ChunkStreamPlan): void {
  for (const chunkKey of plan.toUnload) {
    if (!known.delete(chunkKey)) throw new Error(`unloaded a chunk that was not known: ${chunkKey}`);
  }
  for (const chunkKey of plan.toLoad) {
    if (known.has(chunkKey)) throw new Error(`requested a chunk that was already known: ${chunkKey}`);
    known.add(chunkKey);
  }
}

function copyPlan(plan: ChunkStreamPlan): { toLoad: number[]; toLoadPriorities: number[]; toUnload: number[] } {
  return {
    toLoad: [...plan.toLoad],
    toLoadPriorities: [...plan.toLoadPriorities],
    toUnload: [...plan.toUnload],
  };
}

function stableSurfaceHint(chunkX: number, chunkZ: number): number {
  return 4 + ((chunkX * 7 + chunkZ * 13) & 3) - 1;
}

describe("ChunkStreamPlanner initial load", () => {
  test("first update requests exactly the load volume, best priority first, and nothing to unload", () => {
    const config: ChunkStreamConfig = { horizontalRadius: 7, verticalUp: 3, verticalDown: 2 };
    const planner = new ChunkStreamPlanner(config);
    const known = new Set<number>();
    const plan = planner.update(playerAt(10, 4, -6), FORWARD_NORTH, known);
    const loadOrder = buildLoadOrder(config);
    const expectedKeys = new Set<number>();
    for (let index = 0; index < loadOrder.offsetCount; index++) {
      expectedKeys.add(packChunkKey(10 + loadOrder.offsetX[index]!, 4 + loadOrder.offsetY[index]!, -6 + loadOrder.offsetZ[index]!));
    }
    expect(plan.toLoad.length).toBe(expectedKeys.size);
    expect(new Set(plan.toLoad)).toEqual(expectedKeys);
    expect(plan.toUnload).toEqual([]);
    expect(plan.toLoad[0]).toBe(packChunkKey(10, 4, -6));
    for (let index = 1; index < plan.toLoadPriorities.length; index++) {
      expect(plan.toLoadPriorities[index]!).toBeGreaterThanOrEqual(plan.toLoadPriorities[index - 1]!);
    }
  });

  test("a chunk ahead of the camera outranks an equally distant chunk behind it", () => {
    const planner = new ChunkStreamPlanner({ horizontalRadius: 6, verticalUp: 1, verticalDown: 1 });
    const plan = planner.update(playerAt(0, 0, 0), FORWARD_NORTH, new Set());
    const aheadIndex = plan.toLoad.indexOf(packChunkKey(0, 0, -5));
    const behindIndex = plan.toLoad.indexOf(packChunkKey(0, 0, 5));
    expect(aheadIndex).toBeGreaterThanOrEqual(0);
    expect(aheadIndex).toBeLessThan(behindIndex);
  });

  test("a chunk near the surface outranks an equally distant chunk far from it", () => {
    const planner = new ChunkStreamPlanner({
      horizontalRadius: 6,
      verticalUp: 4,
      verticalDown: 4,
      surfaceChunkY: () => 4,
    });
    const plan = planner.update(playerAt(0, 4, 0), { x: 0, y: 0, z: 0 }, new Set());
    const nearSurfaceIndex = plan.toLoad.indexOf(packChunkKey(4, 4, 0));
    const farFromSurfaceIndex = plan.toLoad.indexOf(packChunkKey(0, 4 + 4, 0));
    expect(nearSurfaceIndex).toBeGreaterThanOrEqual(0);
    expect(farFromSurfaceIndex).toBeGreaterThanOrEqual(0);
    expect(nearSurfaceIndex).toBeLessThan(farFromSurfaceIndex);
  });

  test("zero forward vector applies no heading bias", () => {
    const planner = new ChunkStreamPlanner({ horizontalRadius: 5, verticalUp: 1, verticalDown: 1 });
    const plan = planner.update(playerAt(0, 0, 0), { x: 0, y: 0, z: 0 }, new Set());
    const aheadPriority = plan.toLoadPriorities[plan.toLoad.indexOf(packChunkKey(0, 0, -4))]!;
    const behindPriority = plan.toLoadPriorities[plan.toLoad.indexOf(packChunkKey(0, 0, 4))]!;
    expect(aheadPriority).toBe(behindPriority);
  });

  test("priorityOfKey reproduces the priority reported by the plan", () => {
    const planner = new ChunkStreamPlanner({
      horizontalRadius: 5,
      verticalUp: 2,
      verticalDown: 2,
      surfaceChunkY: stableSurfaceHint,
    });
    const plan = planner.update(playerAt(3, 4, 3), { x: 0.3, y: -0.2, z: -0.9 }, new Set());
    for (let index = 0; index < plan.toLoad.length; index += 7) {
      expect(planner.priorityOfKey(plan.toLoad[index]!)).toBeCloseTo(plan.toLoadPriorities[index]!, 10);
    }
  });
});

describe("ChunkStreamPlanner vertical limits", () => {
  const config: ChunkStreamConfig = {
    horizontalRadius: 8,
    verticalUp: 6,
    verticalDown: 6,
    surfaceChunkY: stableSurfaceHint,
    skipAboveSurfaceMargin: 1,
    skipBelowSurfaceMargin: 2,
    minChunkY: -2,
    maxChunkY: 10,
  };

  test("skips all-air and deep-solid chunks beyond the margins but keeps those within them", () => {
    const plan = new ChunkStreamPlanner(config).update(playerAt(0, 4, 0), FORWARD_NORTH, new Set());
    let keptNearSurface = 0;
    for (const chunkKey of plan.toLoad) {
      const chunkX = chunkKeyX(chunkKey);
      const chunkY = chunkKeyY(chunkKey);
      const chunkZ = chunkKeyZ(chunkKey);
      const surface = stableSurfaceHint(chunkX, chunkZ);
      const isNearPlayer = Math.abs(chunkX) <= 1 && Math.abs(chunkZ) <= 1 && Math.abs(chunkY - 4) <= 1;
      if (!isNearPlayer) {
        expect(chunkY).toBeLessThanOrEqual(surface + 1);
        expect(chunkY).toBeGreaterThanOrEqual(surface - 2);
      }
      expect(chunkY).toBeGreaterThanOrEqual(-2);
      expect(chunkY).toBeLessThanOrEqual(10);
      if (Math.abs(chunkY - surface) <= 1) keptNearSurface++;
    }
    expect(keptNearSurface).toBeGreaterThan(100);
    const withoutSkipping = new ChunkStreamPlanner({
      ...config,
      skipAboveSurfaceMargin: undefined,
      skipBelowSurfaceMargin: undefined,
    }).update(playerAt(0, 4, 0), FORWARD_NORTH, new Set());
    expect(plan.toLoad.length).toBeLessThan(withoutSkipping.toLoad.length * 0.8);
  });

  test("the player's immediate neighborhood is never skipped even when it is all air or solid", () => {
    const plan = new ChunkStreamPlanner({ ...config, surfaceChunkY: () => 0 }).update(playerAt(0, 8, 0), FORWARD_NORTH, new Set());
    expect(plan.toLoad).toContain(packChunkKey(0, 8, 0));
    expect(plan.toLoad).toContain(packChunkKey(1, 9, -1));
    expect(plan.toLoad).not.toContain(packChunkKey(5, 8, 0));
  });

  test("an unknown surface hint disables skipping for that column", () => {
    const unknownHintPlan = new ChunkStreamPlanner({ ...config, surfaceChunkY: () => undefined }).update(playerAt(0, 4, 0), FORWARD_NORTH, new Set());
    const knownHintPlan = new ChunkStreamPlanner({ ...config, surfaceChunkY: () => 4 }).update(playerAt(0, 4, 0), FORWARD_NORTH, new Set());
    expect(unknownHintPlan.toLoad).toContain(packChunkKey(3, 9, 0));
    expect(knownHintPlan.toLoad).not.toContain(packChunkKey(3, 9, 0));
  });
});

describe("ChunkStreamPlanner hysteresis", () => {
  test("oscillating across the load boundary never loads or unloads after the first crossing", () => {
    const planner = new ChunkStreamPlanner({ horizontalRadius: 8, verticalUp: 2, verticalDown: 2 });
    const known = new Set<number>();
    applyPlan(known, planner.update(playerAt(0, 0, 0), FORWARD_NORTH, known));
    applyPlan(known, planner.update(playerAt(1, 0, 0), FORWARD_NORTH, known));
    let churn = 0;
    for (let step = 0; step < 100; step++) {
      const plan = planner.update(playerAt(step % 2 === 0 ? 0 : 1, 0, 0), FORWARD_NORTH, known);
      churn += plan.toLoad.length + plan.toUnload.length;
      applyPlan(known, plan);
    }
    expect(churn).toBe(0);
  });

  test("no chunk is both loaded and unloaded in one update, and walking back and forth within the margin never reloads", () => {
    const planner = new ChunkStreamPlanner({ horizontalRadius: 6, verticalUp: 2, verticalDown: 2 });
    const known = new Set<number>();
    const lastTransition = new Map<number, "load" | "unload">();
    let flipCount = 0;
    const path = [0, 1, 2, 1, 0, 1, 2, 2, 1, 0, 0, 1, 2, 1, 0];
    for (const chunkX of path) {
      const plan = planner.update(playerAt(chunkX, 0, 0), FORWARD_NORTH, known);
      const unloaded = new Set(plan.toUnload);
      for (const chunkKey of plan.toLoad) {
        expect(unloaded.has(chunkKey)).toBe(false);
        if (lastTransition.get(chunkKey) === "unload") flipCount++;
        lastTransition.set(chunkKey, "load");
      }
      for (const chunkKey of plan.toUnload) lastTransition.set(chunkKey, "unload");
      applyPlan(known, plan);
    }
    expect(flipCount).toBe(0);
  });

  test("a chunk is only unloaded once it is outside the unload radius", () => {
    const planner = new ChunkStreamPlanner({ horizontalRadius: 6, verticalUp: 1, verticalDown: 1, horizontalUnloadRadius: 9 });
    const known = new Set<number>();
    applyPlan(known, planner.update(playerAt(0, 0, 0), FORWARD_NORTH, known));
    const westEdgeKey = packChunkKey(-6, 0, 0);
    expect(known.has(westEdgeKey)).toBe(true);
    for (let chunkX = 1; chunkX <= 3; chunkX++) {
      applyPlan(known, planner.update(playerAt(chunkX, 0, 0), FORWARD_NORTH, known));
      expect(known.has(westEdgeKey)).toBe(true);
    }
    const plan = planner.update(playerAt(4, 0, 0), FORWARD_NORTH, known);
    expect(plan.toUnload).toContain(westEdgeKey);
    expect(plan.toUnload).not.toContain(packChunkKey(-5, 0, 0));
  });

  test("rejects an unload radius smaller than the load radius", () => {
    expect(
      () => new ChunkStreamPlanner({ horizontalRadius: 8, verticalUp: 1, verticalDown: 1, horizontalUnloadRadius: 5 }),
    ).toThrow();
  });
});

describe("ChunkStreamPlanner incremental updates", () => {
  const randomWalkConfigs: ChunkStreamConfig[] = [
    { horizontalRadius: 6, verticalUp: 2, verticalDown: 2 },
    {
      horizontalRadius: 7,
      verticalUp: 3,
      verticalDown: 3,
      shape: "cylinder",
      horizontalUnloadRadius: 8,
      verticalUnloadMargin: 2,
      surfaceChunkY: stableSurfaceHint,
      skipAboveSurfaceMargin: 1,
      skipBelowSurfaceMargin: 2,
      minChunkY: -2,
      maxChunkY: 10,
    },
  ];

  for (const [configIndex, config] of randomWalkConfigs.entries()) {
    test(`random walk config ${configIndex}: incremental plans equal a full recompute and keep the known set consistent`, () => {
      const random = createSeededRandom(99 + configIndex);
      const incrementalPlanner = new ChunkStreamPlanner(config);
      const referencePlanner = new ChunkStreamPlanner(config);
      const loadOrder = buildLoadOrder(config);
      const unloadOrder = buildLoadOrder({
        horizontalRadius: config.horizontalUnloadRadius ?? config.horizontalRadius + 2,
        verticalUp: config.verticalUp + (config.verticalUnloadMargin ?? 1),
        verticalDown: config.verticalDown + (config.verticalUnloadMargin ?? 1),
        shape: config.shape,
      });
      const known = new Set<number>();
      const position = createChunkCoordinates();
      position.chunkY = 4;
      let incrementalUpdateCount = 0;
      let totalLoaded = 0;
      let totalUnloaded = 0;

      for (let step = 0; step < 400; step++) {
        const roll = random();
        if (roll < 0.04) {
          position.chunkX += Math.floor(random() * 21) - 10;
          position.chunkZ += Math.floor(random() * 21) - 10;
        } else {
          position.chunkX += Math.floor(random() * 5) - 2;
          position.chunkY += random() < 0.3 ? Math.floor(random() * 3) - 1 : 0;
          position.chunkZ += Math.floor(random() * 5) - 2;
        }
        const forward = { x: random() - 0.5, y: random() - 0.5, z: random() - 0.5 };

        referencePlanner.invalidate();
        const referencePlan = copyPlan(referencePlanner.update(position, forward, known));
        const incrementalPlan = copyPlan(incrementalPlanner.update(position, forward, known));
        if (!incrementalPlanner.lastUpdateWasFull) incrementalUpdateCount++;

        expect(new Set(incrementalPlan.toLoad)).toEqual(new Set(referencePlan.toLoad));
        expect(new Set(incrementalPlan.toUnload)).toEqual(new Set(referencePlan.toUnload));
        expect(incrementalPlan.toLoad).toEqual(referencePlan.toLoad);
        expect(incrementalPlan.toLoad.length).toBe(new Set(incrementalPlan.toLoad).size);

        applyPlan(known, { ...incrementalPlan, playerChunkChanged: true });
        totalLoaded += incrementalPlan.toLoad.length;
        totalUnloaded += incrementalPlan.toUnload.length;

        for (const chunkKey of known) {
          const isInsideUnloadVolume = unloadOrder.contains(
            chunkKeyX(chunkKey) - position.chunkX,
            chunkKeyY(chunkKey) - position.chunkY,
            chunkKeyZ(chunkKey) - position.chunkZ,
          );
          if (!isInsideUnloadVolume) throw new Error(`known chunk outside unload volume at step ${step}`);
        }
        for (let index = 0; index < loadOrder.offsetCount; index++) {
          const chunkY = position.chunkY + loadOrder.offsetY[index]!;
          if (config.minChunkY !== undefined && chunkY < config.minChunkY) continue;
          if (config.maxChunkY !== undefined && chunkY > config.maxChunkY) continue;
          const chunkKey = packChunkKey(position.chunkX + loadOrder.offsetX[index]!, chunkY, position.chunkZ + loadOrder.offsetZ[index]!);
          if (known.has(chunkKey)) continue;
          const surface = config.surfaceChunkY?.(position.chunkX + loadOrder.offsetX[index]!, position.chunkZ + loadOrder.offsetZ[index]!);
          const isNearPlayer =
            Math.abs(loadOrder.offsetX[index]!) <= 1 && Math.abs(loadOrder.offsetY[index]!) <= 1 && Math.abs(loadOrder.offsetZ[index]!) <= 1;
          const isSkippable =
            surface !== undefined &&
            !isNearPlayer &&
            (chunkY > surface + config.skipAboveSurfaceMargin! || chunkY < surface - config.skipBelowSurfaceMargin!);
          if (!isSkippable) throw new Error(`load volume chunk missing at step ${step}`);
        }
      }
      expect(incrementalUpdateCount).toBeGreaterThan(300);
      expect(totalLoaded).toBeGreaterThan(1000);
      expect(totalUnloaded).toBeGreaterThan(1000);
    });
  }

  test("staying in the same chunk does no work, but invalidate re-requests chunks missing from the known set", () => {
    const planner = new ChunkStreamPlanner({ horizontalRadius: 5, verticalUp: 2, verticalDown: 2 });
    const known = new Set<number>();
    applyPlan(known, planner.update(playerAt(0, 0, 0), FORWARD_NORTH, known));
    const idlePlan = planner.update(playerAt(0, 0, 0), { x: 1, y: 0, z: 0 }, known);
    expect(idlePlan.playerChunkChanged).toBe(false);
    expect(idlePlan.toLoad).toEqual([]);
    expect(planner.lastUpdateOperations).toBe(0);

    const failedKeys = [packChunkKey(1, 0, 1), packChunkKey(-2, 1, 3)];
    for (const failedKey of failedKeys) known.delete(failedKey);
    expect(planner.update(playerAt(0, 0, 0), FORWARD_NORTH, known).toLoad).toEqual([]);
    planner.invalidate();
    const recoveryPlan = planner.update(playerAt(0, 0, 0), FORWARD_NORTH, known);
    expect(new Set(recoveryPlan.toLoad)).toEqual(new Set(failedKeys));
    expect(planner.lastUpdateWasFull).toBe(true);
  });

  test("a teleport unloads every chunk outside the new unload volume and loads the new volume", () => {
    const config: ChunkStreamConfig = { horizontalRadius: 5, verticalUp: 1, verticalDown: 1 };
    const planner = new ChunkStreamPlanner(config);
    const known = new Set<number>();
    applyPlan(known, planner.update(playerAt(0, 0, 0), FORWARD_NORTH, known));
    const previousKnownCount = known.size;
    const plan = planner.update(playerAt(100, 0, 100), FORWARD_NORTH, known);
    expect(plan.toUnload.length).toBe(previousKnownCount);
    expect(plan.toLoad.length).toBe(buildLoadOrder(config).offsetCount);
    expect(planner.lastUpdateWasFull).toBe(true);
  });

  test("changing the configuration recomputes and grows the loaded area", () => {
    const planner = new ChunkStreamPlanner({ horizontalRadius: 3, verticalUp: 1, verticalDown: 1 });
    const known = new Set<number>();
    applyPlan(known, planner.update(playerAt(0, 0, 0), FORWARD_NORTH, known));
    const smallCount = known.size;
    planner.setConfig({ horizontalRadius: 6, verticalUp: 1, verticalDown: 1 });
    const plan = planner.update(playerAt(0, 0, 0), FORWARD_NORTH, known);
    expect(plan.toLoad.length).toBeGreaterThan(smallCount);
    applyPlan(known, plan);
    expect(known.size).toBe(buildLoadOrder({ horizontalRadius: 6, verticalUp: 1, verticalDown: 1 }).offsetCount);
  });
});

describe("ChunkStreamPlanner cost scaling", () => {
  function measureOneChunkMove(horizontalRadius: number): { operations: number; volumeSize: number; milliseconds: number[] } {
    const planner = new ChunkStreamPlanner({ horizontalRadius, verticalUp: 4, verticalDown: 4 });
    const known = new Set<number>();
    applyPlan(known, planner.update(playerAt(0, 0, 0), FORWARD_NORTH, known));
    const milliseconds: number[] = [];
    let operations = 0;
    for (let chunkX = 1; chunkX < 40; chunkX++) {
      if (chunkX < 12) {
        applyPlan(known, planner.update(playerAt(chunkX, 0, 0), FORWARD_NORTH, known));
        continue;
      }
      const startedAt = performance.now();
      const plan = planner.update(playerAt(chunkX, 0, 0), FORWARD_NORTH, known);
      milliseconds.push(performance.now() - startedAt);
      operations = planner.lastUpdateOperations;
      expect(planner.lastUpdateWasFull).toBe(false);
      expect(plan.toLoad.length).toBeGreaterThan(0);
      expect(plan.toUnload.length).toBeGreaterThan(0);
      applyPlan(known, plan);
    }
    return { operations, volumeSize: planner.loadVolumeSize, milliseconds };
  }

  test("operations of a one chunk move scale with the shell, not the volume", () => {
    const small = measureOneChunkMove(8);
    const large = measureOneChunkMove(24);
    expect(large.operations).toBeLessThan(large.volumeSize / 5);
    expect(large.volumeSize / small.volumeSize).toBeGreaterThan(8);
    expect(large.operations / small.operations).toBeLessThan(4.5);
  });

  test("a one chunk move at radius 24 plans in under 2 ms", () => {
    const { milliseconds } = measureOneChunkMove(24);
    const sorted = [...milliseconds].sort((left, right) => left - right);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    expect(median).toBeLessThan(2);
  });
});

describe("ChunkStreamPlanner profiling", () => {
  test("decision counters add up to the candidates considered and match the plan", () => {
    const config: ChunkStreamConfig = {
      horizontalRadius: 8,
      verticalUp: 6,
      verticalDown: 6,
      surfaceChunkY: stableSurfaceHint,
      skipAboveSurfaceMargin: 1,
      skipBelowSurfaceMargin: 2,
      minChunkY: -2,
      maxChunkY: 10,
    };
    const known = new Set<number>();
    withEnabledProfiler(() => {
      const planner = new ChunkStreamPlanner(config);
      const firstPlan = planner.update(playerAt(0, 4, 0), FORWARD_NORTH, known);
      const requestedByFirstUpdate = firstPlan.toLoad.length;
      applyPlan(known, firstPlan);
      expect(counterTotal("game.streaming.candidatesConsidered")).toBe(planner.loadVolumeSize);
      expect(breakdownUnits(DIMENSIONS.streamingDecision, "requested")).toBe(requestedByFirstUpdate);
      const skippedOrRejected =
        breakdownUnits(DIMENSIONS.streamingDecision, "skippedAboveSurface") +
        breakdownUnits(DIMENSIONS.streamingDecision, "skippedBelowSurface") +
        breakdownUnits(DIMENSIONS.streamingDecision, "rejectedBelowWorld") +
        breakdownUnits(DIMENSIONS.streamingDecision, "rejectedAboveWorld");
      expect(skippedOrRejected).toBeGreaterThan(50);
      expect(requestedByFirstUpdate + skippedOrRejected).toBe(planner.loadVolumeSize);

      const secondPlan = planner.update(playerAt(1, 4, 0), FORWARD_NORTH, known);
      expect(counterTotal("game.streaming.incrementalUpdates")).toBe(1);
      expect(counterTotal("game.streaming.fullRecomputes")).toBe(1);
      expect(breakdownUnits(DIMENSIONS.streamingDecision, "unloaded")).toBe(secondPlan.toUnload.length);
      expect(counterTotal("game.streaming.shellCacheMisses")).toBeGreaterThanOrEqual(2);
    });
  });
});
