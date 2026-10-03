import { BlockType } from "../blocks";
import { profiler } from "./index";
import { buildProfileReport } from "./report";
import {
  PROFILE_SCHEMA_VERSION,
  type BenchmarkOptions,
  type BenchmarkResult,
  type DistributionSummary,
  type ProfileSnapshot,
} from "./types";

export const DEFAULT_BENCHMARK_SEED = 20240607;
const DEFAULT_FLY_SECONDS = 20;
const DEFAULT_HOVER_SECONDS = 8;
const DEFAULT_EDIT_SECONDS = 8;
const DEFAULT_LIGHT_EDIT_SECONDS = 10;
const LIGHT_EDIT_SETTLE_PAUSE_MS = 150;
const LIGHT_EDIT_RING_RADIUS_BLOCKS = 8;
const LIGHT_EDIT_RING_POSITIONS = 8;
const HOVER_WARMUP_SECONDS = 3;
const FLIGHT_SPEED_BLOCKS_PER_SECOND = 12;
const FLIGHT_ALTITUDE_ABOVE_SURFACE = 8;
const HOVER_YAW_RADIANS_PER_SECOND = 0.5;
const EDIT_INTERVAL_SECONDS = 0.1;
const EDIT_RING_RADIUS_BLOCKS = 6;
const EDIT_RING_POSITIONS = 16;
const LOOKING_DOWN_PITCH_RADIANS = -0.3;
const FACING_POSITIVE_X_YAW_RADIANS = -Math.PI / 2;
const MAX_FRAME_DELTA_SECONDS = 0.25;

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface CameraPose {
  position: Vector3Like;
  yaw: number;
  pitch: number;
}

export interface BenchmarkBridge {
  /** Starts a fresh in-memory world that must never be persisted or listed. */
  enterBenchmarkWorld(seed: number): void;
  /** Resolves once the initial terrain, lighting and meshes are on screen. */
  waitUntilWorldLoaded(): Promise<void>;
  /** Puts the game in (or out of) the "playing" phase without pointer lock. */
  setPlaying(playing: boolean): void;
  setFlying(flying: boolean): void;
  setCameraPose(pose: CameraPose): void;
  getCameraPosition(): Vector3Like;
  editBlock(x: number, y: number, z: number, blockType: number): void;
  /** Edits a block and resolves once its relight and every re-mesh it caused are on screen. */
  editBlockAndSettle(
    x: number,
    y: number,
    z: number,
    blockType: number,
  ): Promise<void>;
  /** Registers a callback that runs inside every render frame. */
  onFrame(callback: (deltaSeconds: number) => void): () => void;
  /** Returns the game to the state it was in before the benchmark. */
  restore(): void;
  getSurfaceHeight(x: number, z: number): number;
}

export type BenchmarkPhaseKind =
  "world-load" | "fly" | "hover" | "edit" | "light-edit";

export interface BenchmarkPhasePlan {
  name: BenchmarkPhaseKind;
  /** null means "until the world finished loading". */
  durationSeconds: number | null;
  /** Seconds the driver runs before the profiler is reset and recording starts. */
  warmupSeconds: number;
}

export interface EditTarget {
  x: number;
  z: number;
  action: "place" | "break";
  blockType: number;
}

export function buildPhasePlan(
  options: BenchmarkOptions = {},
): BenchmarkPhasePlan[] {
  return [
    { name: "world-load", durationSeconds: null, warmupSeconds: 0 },
    {
      name: "fly",
      durationSeconds: options.flySeconds ?? DEFAULT_FLY_SECONDS,
      warmupSeconds: 0,
    },
    {
      name: "hover",
      durationSeconds: options.hoverSeconds ?? DEFAULT_HOVER_SECONDS,
      warmupSeconds: HOVER_WARMUP_SECONDS,
    },
    {
      name: "edit",
      durationSeconds: options.editSeconds ?? DEFAULT_EDIT_SECONDS,
      warmupSeconds: 0,
    },
    {
      name: "light-edit",
      durationSeconds: options.lightEditSeconds ?? DEFAULT_LIGHT_EDIT_SECONDS,
      warmupSeconds: 0,
    },
  ].filter(
    (phase) => phase.durationSeconds === null || phase.durationSeconds > 0,
  ) as BenchmarkPhasePlan[];
}

/** Straight line along +x so every second reveals fresh, ungenerated terrain. */
export function computeFlightPose(
  elapsedSeconds: number,
  startPosition: Vector3Like,
  speedBlocksPerSecond: number,
): CameraPose {
  return {
    position: {
      x: startPosition.x + speedBlocksPerSecond * elapsedSeconds,
      y: startPosition.y,
      z: startPosition.z,
    },
    yaw: FACING_POSITIVE_X_YAW_RADIANS,
    pitch: LOOKING_DOWN_PITCH_RADIANS,
  };
}

export function computeHoverPose(
  elapsedSeconds: number,
  position: Vector3Like,
): CameraPose {
  return {
    position,
    yaw:
      FACING_POSITIVE_X_YAW_RADIANS +
      HOVER_YAW_RADIANS_PER_SECOND * elapsedSeconds,
    pitch: LOOKING_DOWN_PITCH_RADIANS,
  };
}

/**
 * Edits come in pairs on a ring around the center: place a block, then break
 * it. Every second pair uses a light source so both the sunlight-only and the
 * block-light relight paths run.
 */
export function computeEditTarget(
  index: number,
  center: Vector3Like,
): EditTarget {
  const pairIndex = Math.floor(index / 2);
  const ringPosition = pairIndex % EDIT_RING_POSITIONS;
  const angle = (ringPosition / EDIT_RING_POSITIONS) * Math.PI * 2;
  const isPlacement = index % 2 === 0;
  const usesLightSource = pairIndex % 2 === 1;
  return {
    x: Math.round(center.x + Math.cos(angle) * EDIT_RING_RADIUS_BLOCKS),
    z: Math.round(center.z + Math.sin(angle) * EDIT_RING_RADIUS_BLOCKS),
    action: isPlacement ? "place" : "break",
    blockType: isPlacement
      ? usesLightSource
        ? BlockType.GLOWSTONE
        : BlockType.STONE
      : BlockType.AIR,
  };
}

/**
 * One edit at a time on a ring around the center, cycling through the four kinds
 * (place light, break light, place block, break block) so every position sees each.
 */
export function computeLightEditTarget(
  index: number,
  center: Vector3Like,
): EditTarget {
  const kindIndex = index % 4;
  const ringPosition = Math.floor(index / 4) % LIGHT_EDIT_RING_POSITIONS;
  const angle = (ringPosition / LIGHT_EDIT_RING_POSITIONS) * Math.PI * 2;
  const blockTypeByKind = [
    BlockType.GLOWSTONE,
    BlockType.AIR,
    BlockType.STONE,
    BlockType.AIR,
  ];
  return {
    x: Math.round(center.x + Math.cos(angle) * LIGHT_EDIT_RING_RADIUS_BLOCKS),
    z: Math.round(center.z + Math.sin(angle) * LIGHT_EDIT_RING_RADIUS_BLOCKS),
    action: kindIndex % 2 === 0 ? "place" : "break",
    blockType: blockTypeByKind[kindIndex],
  };
}

export async function runBenchmark(
  bridge: BenchmarkBridge,
  options: BenchmarkOptions = {},
): Promise<BenchmarkResult> {
  const seed = options.seed ?? DEFAULT_BENCHMARK_SEED;
  const startedAtIso = new Date().toISOString();
  const phases: BenchmarkResult["phases"] = [];
  const phaseSnapshots: ProfileSnapshot[] = [];
  const driver = new FrameDriver(bridge);

  profiler.setEnabled(true);
  try {
    for (const plan of buildPhasePlan(options)) {
      const snapshot =
        plan.name === "world-load"
          ? await runWorldLoadPhase(bridge, seed)
          : await runTimedPhase(bridge, driver, plan);
      phaseSnapshots.push(snapshot);
      phases.push({
        name: plan.name,
        durationSeconds: snapshot.profiledForMs / 1000,
        report: buildProfileReport(snapshot),
      });
    }
  } finally {
    driver.dispose();
    bridge.restore();
  }

  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    startedAtIso,
    seed,
    phases,
    overall: buildProfileReport(
      mergeSnapshots(phaseSnapshots, "benchmark-overall"),
    ),
  };
}

async function runWorldLoadPhase(
  bridge: BenchmarkBridge,
  seed: number,
): Promise<ProfileSnapshot> {
  profiler.reset("world-load");
  bridge.enterBenchmarkWorld(seed);
  await bridge.waitUntilWorldLoaded();
  bridge.setPlaying(true);
  bridge.setFlying(true);
  return profiler.snapshot("world-load");
}

async function runTimedPhase(
  bridge: BenchmarkBridge,
  driver: FrameDriver,
  plan: BenchmarkPhasePlan,
): Promise<ProfileSnapshot> {
  const startPosition = { ...bridge.getCameraPosition() };
  const flightStart = {
    x: startPosition.x,
    y:
      bridge.getSurfaceHeight(startPosition.x, startPosition.z) +
      FLIGHT_ALTITUDE_ABOVE_SURFACE,
    z: startPosition.z,
  };
  const durationSeconds = plan.durationSeconds ?? 0;
  let editIndex = 0;
  let nextEditAtSeconds = 0;

  if (plan.name === "light-edit") {
    return runLightEditPhase(bridge, driver, plan, startPosition);
  }

  const driveFrame = (elapsedSeconds: number) => {
    if (plan.name === "fly") {
      bridge.setCameraPose(
        computeFlightPose(
          elapsedSeconds,
          flightStart,
          FLIGHT_SPEED_BLOCKS_PER_SECOND,
        ),
      );
    } else {
      bridge.setCameraPose(computeHoverPose(elapsedSeconds, startPosition));
    }
    if (plan.name !== "edit") return;
    while (elapsedSeconds >= nextEditAtSeconds) {
      const target = computeEditTarget(editIndex++, startPosition);
      const groundY =
        Math.round(bridge.getSurfaceHeight(target.x, target.z)) + 1;
      bridge.editBlock(target.x, groundY, target.z, target.blockType);
      nextEditAtSeconds += EDIT_INTERVAL_SECONDS;
    }
  };

  if (plan.warmupSeconds > 0) {
    await driver.runFor(plan.warmupSeconds, driveFrame);
  }
  profiler.reset(plan.name);
  await driver.runFor(durationSeconds, driveFrame);
  return profiler.snapshot(plan.name);
}

/** Edits one block at a time, waiting for the light and meshes to settle before the next. */
async function runLightEditPhase(
  bridge: BenchmarkBridge,
  driver: FrameDriver,
  plan: BenchmarkPhasePlan,
  center: Vector3Like,
): Promise<ProfileSnapshot> {
  const durationMs = (plan.durationSeconds ?? 0) * 1000;
  const driveFrame = (elapsedSeconds: number) =>
    bridge.setCameraPose(computeHoverPose(elapsedSeconds, center));

  profiler.reset(plan.name);
  const startedAtMs = performance.now();
  const edits = (async () => {
    let editIndex = 0;
    while (performance.now() - startedAtMs < durationMs) {
      const target = computeLightEditTarget(editIndex++, center);
      const groundY =
        Math.round(bridge.getSurfaceHeight(target.x, target.z)) + 1;
      await bridge.editBlockAndSettle(
        target.x,
        groundY,
        target.z,
        target.blockType,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, LIGHT_EDIT_SETTLE_PAUSE_MS),
      );
    }
  })();
  await driver.runUntil(edits, driveFrame);
  return profiler.snapshot(plan.name);
}

/** Runs a per-frame callback inside the game's render loop for a fixed time. */
class FrameDriver {
  private unsubscribe: (() => void) | null = null;
  private activeFrame: ((deltaSeconds: number) => void) | null = null;

  constructor(private readonly bridge: BenchmarkBridge) {
    this.unsubscribe = bridge.onFrame((deltaSeconds) =>
      this.activeFrame?.(deltaSeconds),
    );
  }

  runFor(
    durationSeconds: number,
    driveFrame: (elapsedSeconds: number) => void,
  ): Promise<void> {
    return new Promise((resolve) => {
      let elapsedSeconds = 0;
      this.activeFrame = (deltaSeconds) => {
        elapsedSeconds += Math.min(deltaSeconds, MAX_FRAME_DELTA_SECONDS);
        driveFrame(elapsedSeconds);
        if (elapsedSeconds >= durationSeconds) {
          this.activeFrame = null;
          resolve();
        }
      };
    });
  }

  /** Drives the camera every frame until the given work finishes. */
  async runUntil(
    work: Promise<void>,
    driveFrame: (elapsedSeconds: number) => void,
  ): Promise<void> {
    let elapsedSeconds = 0;
    this.activeFrame = (deltaSeconds) => {
      elapsedSeconds += Math.min(deltaSeconds, MAX_FRAME_DELTA_SECONDS);
      driveFrame(elapsedSeconds);
    };
    try {
      await work;
    } finally {
      this.activeFrame = null;
    }
  }

  dispose() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.activeFrame = null;
  }
}

/**
 * Combines phase snapshots into one. Counts, totals and extremes are exact;
 * percentiles are the worst phase's value (an upper bound) and rates are
 * total divided by the combined profiled time.
 */
export function mergeSnapshots(
  snapshots: ProfileSnapshot[],
  label: string,
): ProfileSnapshot {
  const last = snapshots[snapshots.length - 1];
  const profiledForMs = snapshots.reduce(
    (sum, item) => sum + item.profiledForMs,
    0,
  );
  const profiledSeconds = Math.max(profiledForMs / 1000, 1e-9);

  const mergeNamed = <Entry extends DistributionSummary & { name: string }>(
    pick: (snapshot: ProfileSnapshot) => Entry[],
  ): Entry[] => {
    const byName = new Map<string, Entry[]>();
    for (const snapshot of snapshots) {
      for (const entry of pick(snapshot)) {
        byName.set(entry.name, [...(byName.get(entry.name) ?? []), entry]);
      }
    }
    return Array.from(byName.values()).map((entries) => {
      const merged = {
        ...entries[entries.length - 1],
        ...mergeDistributions(entries, profiledSeconds),
      };
      if ("selfTotal" in merged) {
        (merged as { selfTotal: number }).selfTotal = entries.reduce(
          (sum, entry) =>
            sum + (entry as unknown as { selfTotal: number }).selfTotal,
          0,
        );
      }
      return merged;
    });
  };

  const counterTotals = new Map<string, ProfileSnapshot["counters"][number]>();
  for (const snapshot of snapshots) {
    for (const counter of snapshot.counters) {
      const existing = counterTotals.get(counter.name);
      counterTotals.set(counter.name, {
        ...counter,
        total: (existing?.total ?? 0) + counter.total,
        recentPerSecond:
          ((existing?.total ?? 0) + counter.total) / profiledSeconds,
      });
    }
  }

  return {
    ...last,
    label,
    profiledForMs,
    frames: {
      ...last.frames,
      count: snapshots.reduce((sum, item) => sum + item.frames.count, 0),
      intervalMs: mergeDistributions(
        snapshots.map((item) => item.frames.intervalMs),
        profiledSeconds,
      ),
      busyMs: mergeDistributions(
        snapshots.map((item) => item.frames.busyMs),
        profiledSeconds,
      ),
      gpuMs: mergeDistributions(
        snapshots.map((item) => item.frames.gpuMs),
        profiledSeconds,
      ),
      framesOver16Point7Ms: snapshots.reduce(
        (sum, item) => sum + item.frames.framesOver16Point7Ms,
        0,
      ),
      framesOver33Ms: snapshots.reduce(
        (sum, item) => sum + item.frames.framesOver33Ms,
        0,
      ),
      framesOver50Ms: snapshots.reduce(
        (sum, item) => sum + item.frames.framesOver50Ms,
        0,
      ),
      worst: snapshots
        .flatMap((item) => item.frames.worst)
        .sort((first, second) => second.intervalMs - first.intervalMs)
        .slice(0, 20),
    },
    timers: mergeNamed((snapshot) => snapshot.timers),
    bytes: mergeNamed((snapshot) => snapshot.bytes),
    counters: Array.from(counterTotals.values()),
    events: snapshots.flatMap((item) => item.events),
  };
}

function mergeDistributions(
  distributions: DistributionSummary[],
  profiledSeconds: number,
): DistributionSummary {
  const nonEmpty = distributions.filter(
    (distribution) => distribution.count > 0,
  );
  if (nonEmpty.length === 0) return { ...distributions[0] };
  const count = nonEmpty.reduce((sum, item) => sum + item.count, 0);
  const total = nonEmpty.reduce((sum, item) => sum + item.total, 0);
  return {
    count,
    total,
    mean: total / count,
    min: Math.min(...nonEmpty.map((item) => item.min)),
    max: Math.max(...nonEmpty.map((item) => item.max)),
    p50: Math.max(...nonEmpty.map((item) => item.p50)),
    p95: Math.max(...nonEmpty.map((item) => item.p95)),
    p99: Math.max(...nonEmpty.map((item) => item.p99)),
    recentPerSecondTotal: total / profiledSeconds,
    recentPerSecondCount: count / profiledSeconds,
    perSecondHistory: distributions.flatMap((item) => item.perSecondHistory),
  };
}
