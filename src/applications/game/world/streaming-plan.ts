// Pure planning core of a chunk streamer: no THREE, no workers. Given the player's chunk, the camera forward
// vector and the keys of chunks already known (loaded or in flight), it says which chunks to request (best first)
// and which to drop.
//
// Incremental model: when the player steps by a small delta, only the "shell" of offsets that enter the load
// volume (and leave the unload volume) is examined. Shells are derived once per delta and cached, so a one chunk
// move costs O(shell) instead of O(volume). Load and unload use different volumes (hysteresis): a chunk loads
// inside the load volume but is only dropped once it leaves the larger unload volume.
//
// Contract with the caller: chunks listed in toLoad must be added to the known set before the next update, and
// chunks listed in toUnload removed. Anything else that changes the known set (a failed load) needs invalidate().

import {
  chunkKeyX,
  chunkKeyY,
  chunkKeyZ,
  offsetChunkKey,
  packChunkKey,
  type ChunkCoordinates,
} from "./chunk-key";
import { profiler } from "../profiler";
import { DIMENSIONS } from "../profiler/dimensions";
import { buildLoadOrder, type LoadOrder, type LoadVolumeShape } from "./load-order";

export { buildLoadOrder, type LoadOrder, type LoadVolumeConfig, type LoadVolumeShape } from "./load-order";
export { PriorityScheduler, type PrioritySchedulerOptions } from "./priority-scheduler";

export interface ChunkStreamConfig {
  horizontalRadius: number;
  verticalUp: number;
  verticalDown: number;
  shape?: LoadVolumeShape;
  /** Chunks beyond this horizontal radius are unloaded. Defaults to horizontalRadius + 2. */
  horizontalUnloadRadius?: number;
  /** Extra vertical chunks kept above and below the load volume before unloading. Defaults to 1. */
  verticalUnloadMargin?: number;
  /** Extra priority distance, in chunks, for a chunk directly behind the camera. Defaults to 3. */
  forwardBiasChunks?: number;
  /** Priority distance added per chunk of vertical distance from the column's surface chunk. Defaults to 0.5. */
  surfaceBandWeight?: number;
  /** Lowest and highest chunk y that exist; chunks outside are never requested. */
  minChunkY?: number;
  maxChunkY?: number;
  /** Chunk y that contains the terrain surface of a column, or undefined while unknown. Must be stable per column. */
  surfaceChunkY?: (chunkX: number, chunkZ: number) => number | undefined;
  /** With a surface hint, chunks more than this many chunks above the surface (all air) are not requested. */
  skipAboveSurfaceMargin?: number;
  /** With a surface hint, chunks more than this many chunks below the surface (deep solid) are not requested. */
  skipBelowSurfaceMargin?: number;
}

export interface KnownChunkKeys {
  has(chunkKey: number): boolean;
  keys(): Iterable<number>;
}

export interface ChunkStreamPlan {
  /** Chunk keys to request, best priority first. Reused by the planner: valid until the next update. */
  toLoad: number[];
  /** Priority of each toLoad entry (lower is more urgent), same order. */
  toLoadPriorities: number[];
  /** Chunk keys to drop, unordered. */
  toUnload: number[];
  /** False when the player stayed in the same chunk and nothing was recomputed. */
  playerChunkChanged: boolean;
}

export interface PlannerForwardVector {
  x: number;
  y: number;
  z: number;
}

const DEFAULT_UNLOAD_HORIZONTAL_MARGIN = 2;
const DEFAULT_UNLOAD_VERTICAL_MARGIN = 1;
const DEFAULT_FORWARD_BIAS_CHUNKS = 3;
const DEFAULT_SURFACE_BAND_WEIGHT = 0.5;
const MAX_INCREMENTAL_DELTA = 3;
const NEVER_SKIPPED_NEIGHBORHOOD = 1;

/** Why a candidate or known chunk ended up where it did, counted per update and published once per update. */
class StreamingDecisionCounts {
  candidatesConsidered = 0;
  alreadyKnown = 0;
  rejectedBelowWorld = 0;
  rejectedAboveWorld = 0;
  skippedAboveSurface = 0;
  skippedBelowSurface = 0;
  requested = 0;
  unloadExamined = 0;
  unloadKept = 0;
  unloaded = 0;
  shellCacheHits = 0;
  shellCacheMisses = 0;

  clear() {
    this.candidatesConsidered = 0;
    this.alreadyKnown = 0;
    this.rejectedBelowWorld = 0;
    this.rejectedAboveWorld = 0;
    this.skippedAboveSurface = 0;
    this.skippedBelowSurface = 0;
    this.requested = 0;
    this.unloadExamined = 0;
    this.unloadKept = 0;
    this.unloaded = 0;
    this.shellCacheHits = 0;
    this.shellCacheMisses = 0;
  }
}

function recordDecision(reason: string, chunkCount: number) {
  if (chunkCount === 0) return;
  profiler.addCounter(`game.streaming.decision.${reason}`, chunkCount);
  profiler.recordBreakdown(DIMENSIONS.streamingDecision, reason, { units: chunkCount, calls: 1 });
}

export class ChunkStreamPlanner {
  private config!: ChunkStreamConfig;
  private loadOrder!: LoadOrder;
  private unloadOrder!: LoadOrder;
  private readonly loadShellByDelta = new Map<number, Int32Array>();
  private readonly unloadShellByDelta = new Map<number, Int32Array>();

  private hasPlayerPosition = false;
  private needsFullRecompute = true;
  private playerChunkX = 0;
  private playerChunkY = 0;
  private playerChunkZ = 0;
  private forwardX = 0;
  private forwardY = 0;
  private forwardZ = 0;

  private readonly plan: ChunkStreamPlan = { toLoad: [], toLoadPriorities: [], toUnload: [], playerChunkChanged: false };
  private readonly candidateKeys: number[] = [];
  private readonly candidatePriorities: number[] = [];
  private readonly sortedCandidateIndices: number[] = [];

  private readonly decisions = new StreamingDecisionCounts();
  private operationCountOfLastUpdate = 0;
  private totalOperationCount = 0;
  private lastUpdateWasFullRecompute = false;

  constructor(config: ChunkStreamConfig) {
    this.setConfig(config);
  }

  setConfig(config: ChunkStreamConfig): void {
    const configToken = profiler.begin("main.streaming.plan.setConfig");
    try {
      this.applyConfig(config);
    } finally {
      profiler.end(configToken);
    }
  }

  private applyConfig(config: ChunkStreamConfig): void {
    this.config = config;
    const { horizontalRadius, verticalUp, verticalDown, shape } = config;
    const horizontalUnloadRadius = config.horizontalUnloadRadius ?? horizontalRadius + DEFAULT_UNLOAD_HORIZONTAL_MARGIN;
    const verticalUnloadMargin = config.verticalUnloadMargin ?? DEFAULT_UNLOAD_VERTICAL_MARGIN;
    if (horizontalUnloadRadius < horizontalRadius || verticalUnloadMargin < 0) {
      throw new Error("unload volume must not be smaller than the load volume");
    }
    this.loadOrder = buildLoadOrder({ horizontalRadius, verticalUp, verticalDown, shape });
    this.unloadOrder = buildLoadOrder({
      horizontalRadius: horizontalUnloadRadius,
      verticalUp: verticalUp + verticalUnloadMargin,
      verticalDown: verticalDown + verticalUnloadMargin,
      shape,
    });
    this.loadShellByDelta.clear();
    this.unloadShellByDelta.clear();
    this.needsFullRecompute = true;
    profiler.addCounter("game.streaming.configChanges");
    profiler.sampleGauge("game.streaming.loadVolumeChunks", this.loadOrder.offsetCount);
    profiler.sampleGauge("game.streaming.unloadVolumeChunks", this.unloadOrder.offsetCount);
  }

  /** Forces the next update to recompute from scratch, for example after a failed load or a new surface hint. */
  invalidate(): void {
    this.needsFullRecompute = true;
    profiler.addCounter("game.streaming.invalidations");
  }

  /** Candidate checks performed by the most recent update; scales with the shell, not the volume. */
  get lastUpdateOperations(): number {
    return this.operationCountOfLastUpdate;
  }

  get totalOperations(): number {
    return this.totalOperationCount;
  }

  get lastUpdateWasFull(): boolean {
    return this.lastUpdateWasFullRecompute;
  }

  get loadVolumeSize(): number {
    return this.loadOrder.offsetCount;
  }

  /** Priority of an arbitrary chunk relative to the last known player position and heading (lower is more urgent). */
  priorityOfChunk(chunkX: number, chunkY: number, chunkZ: number): number {
    profiler.addCounter("game.streaming.priorityLookups");
    return this.computePriority(chunkX, chunkY, chunkZ, chunkX - this.playerChunkX, chunkY - this.playerChunkY, chunkZ - this.playerChunkZ);
  }

  priorityOfKey(chunkKey: number): number {
    return this.priorityOfChunk(chunkKeyX(chunkKey), chunkKeyY(chunkKey), chunkKeyZ(chunkKey));
  }

  update(playerChunk: ChunkCoordinates, forward: PlannerForwardVector, known: KnownChunkKeys): ChunkStreamPlan {
    this.storeForward(forward);
    const plan = this.plan;
    plan.toLoad.length = 0;
    plan.toLoadPriorities.length = 0;
    plan.toUnload.length = 0;
    this.operationCountOfLastUpdate = 0;
    this.lastUpdateWasFullRecompute = false;
    this.decisions.clear();

    const deltaX = playerChunk.chunkX - this.playerChunkX;
    const deltaY = playerChunk.chunkY - this.playerChunkY;
    const deltaZ = playerChunk.chunkZ - this.playerChunkZ;
    const playerMoved = !this.hasPlayerPosition || deltaX !== 0 || deltaY !== 0 || deltaZ !== 0;
    plan.playerChunkChanged = playerMoved || this.needsFullRecompute;
    if (!plan.playerChunkChanged) {
      profiler.addCounter("game.streaming.updatesWithoutMove");
      return plan;
    }
    const updateToken = profiler.begin("main.streaming.plan.recompute");

    const previousChunkX = this.playerChunkX;
    const previousChunkY = this.playerChunkY;
    const previousChunkZ = this.playerChunkZ;
    this.playerChunkX = playerChunk.chunkX;
    this.playerChunkY = playerChunk.chunkY;
    this.playerChunkZ = playerChunk.chunkZ;

    const canUseShells =
      this.hasPlayerPosition &&
      !this.needsFullRecompute &&
      Math.max(Math.abs(deltaX), Math.abs(deltaY), Math.abs(deltaZ)) <= MAX_INCREMENTAL_DELTA;

    this.candidateKeys.length = 0;
    this.candidatePriorities.length = 0;
    try {
      if (canUseShells) {
        this.collectShellPlan(deltaX, deltaY, deltaZ, previousChunkX, previousChunkY, previousChunkZ, known);
      } else {
        this.lastUpdateWasFullRecompute = true;
        this.collectFullPlan(known);
      }
      this.hasPlayerPosition = true;
      this.needsFullRecompute = false;
      this.totalOperationCount += this.operationCountOfLastUpdate;
      this.writeSortedLoadList();
    } finally {
      profiler.end(updateToken);
    }
    if (profiler.enabled) {
      this.publishUpdateMetrics(plan, known, Math.max(Math.abs(deltaX), Math.abs(deltaY), Math.abs(deltaZ)));
    }
    return plan;
  }

  private publishUpdateMetrics(plan: ChunkStreamPlan, known: KnownChunkKeys, playerStepChunks: number): void {
    const decisions = this.decisions;
    profiler.addCounter(
      this.lastUpdateWasFullRecompute ? "game.streaming.fullRecomputes" : "game.streaming.incrementalUpdates",
    );
    profiler.addCounter("game.streaming.candidatesConsidered", decisions.candidatesConsidered);
    profiler.addCounter("game.streaming.updateOperations", this.operationCountOfLastUpdate);
    recordDecision("alreadyKnown", decisions.alreadyKnown);
    recordDecision("rejectedBelowWorld", decisions.rejectedBelowWorld);
    recordDecision("rejectedAboveWorld", decisions.rejectedAboveWorld);
    recordDecision("skippedAboveSurface", decisions.skippedAboveSurface);
    recordDecision("skippedBelowSurface", decisions.skippedBelowSurface);
    recordDecision("requested", decisions.requested);
    recordDecision("unloadKept", decisions.unloadKept);
    recordDecision("unloaded", decisions.unloaded);
    profiler.addCounter("game.streaming.unloadExamined", decisions.unloadExamined);
    profiler.addCounter("game.streaming.shellCacheHits", decisions.shellCacheHits);
    profiler.addCounter("game.streaming.shellCacheMisses", decisions.shellCacheMisses);
    profiler.sampleGauge("game.streaming.toLoadPerUpdate", plan.toLoad.length);
    profiler.sampleGauge("game.streaming.toUnloadPerUpdate", plan.toUnload.length);
    profiler.sampleGauge("game.streaming.knownChunks", knownChunkCount(known));
    profiler.sampleGauge("game.streaming.playerStepChunks", playerStepChunks);
    profiler.sampleGauge("game.streaming.shellCacheEntries", this.loadShellByDelta.size + this.unloadShellByDelta.size);
    if (plan.toLoad.length > 0) {
      profiler.sampleGauge("game.streaming.nearestRequestedPriority", plan.toLoadPriorities[0]!);
      profiler.sampleGauge("game.streaming.farthestRequestedPriority", plan.toLoadPriorities[plan.toLoad.length - 1]!);
    }
  }

  private storeForward(forward: PlannerForwardVector): void {
    const length = Math.hypot(forward.x, forward.y, forward.z);
    if (length > 0) {
      this.forwardX = forward.x / length;
      this.forwardY = forward.y / length;
      this.forwardZ = forward.z / length;
    } else {
      this.forwardX = 0;
      this.forwardY = 0;
      this.forwardZ = 0;
    }
  }

  private collectFullPlan(known: KnownChunkKeys): void {
    const enumerateToken = profiler.begin("main.streaming.plan.enumerateCandidates.full");
    const loadOrder = this.loadOrder;
    const playerKey = packChunkKey(this.playerChunkX, this.playerChunkY, this.playerChunkZ);
    for (let index = 0; index < loadOrder.offsetCount; index++) {
      this.considerLoadCandidate(playerKey, loadOrder.offsetX[index]!, loadOrder.offsetY[index]!, loadOrder.offsetZ[index]!, known);
    }
    profiler.end(enumerateToken);
    const diffToken = profiler.begin("main.streaming.plan.diffKnown.full");
    const unloadOrder = this.unloadOrder;
    const decisions = this.decisions;
    for (const knownKey of known.keys()) {
      this.operationCountOfLastUpdate++;
      decisions.unloadExamined++;
      const offsetX = chunkKeyX(knownKey) - this.playerChunkX;
      const offsetY = chunkKeyY(knownKey) - this.playerChunkY;
      const offsetZ = chunkKeyZ(knownKey) - this.playerChunkZ;
      if (unloadOrder.contains(offsetX, offsetY, offsetZ)) {
        decisions.unloadKept++;
      } else {
        decisions.unloaded++;
        this.plan.toUnload.push(knownKey);
      }
    }
    profiler.end(diffToken);
  }

  private collectShellPlan(
    deltaX: number,
    deltaY: number,
    deltaZ: number,
    previousChunkX: number,
    previousChunkY: number,
    previousChunkZ: number,
    known: KnownChunkKeys,
  ): void {
    const enumerateToken = profiler.begin("main.streaming.plan.enumerateCandidates.shell");
    const loadOrder = this.loadOrder;
    const loadShell = this.getLoadShell(deltaX, deltaY, deltaZ);
    const playerKey = packChunkKey(this.playerChunkX, this.playerChunkY, this.playerChunkZ);
    for (let shellIndex = 0; shellIndex < loadShell.length; shellIndex++) {
      const index = loadShell[shellIndex]!;
      this.considerLoadCandidate(playerKey, loadOrder.offsetX[index]!, loadOrder.offsetY[index]!, loadOrder.offsetZ[index]!, known);
    }
    profiler.end(enumerateToken);
    if (this.hasSkippingRules()) {
      const recheckToken = profiler.begin("main.streaming.plan.recheckNeverSkipped");
      this.considerNeighborhoodLeftOutOfShell(playerKey, deltaX, deltaY, deltaZ, known);
      profiler.end(recheckToken);
    }
    const diffToken = profiler.begin("main.streaming.plan.diffKnown.shell");
    const unloadOrder = this.unloadOrder;
    const decisions = this.decisions;
    const unloadShell = this.getUnloadShell(deltaX, deltaY, deltaZ);
    const previousKey = packChunkKey(previousChunkX, previousChunkY, previousChunkZ);
    for (let shellIndex = 0; shellIndex < unloadShell.length; shellIndex++) {
      const index = unloadShell[shellIndex]!;
      this.operationCountOfLastUpdate++;
      decisions.unloadExamined++;
      const candidateKey = offsetChunkKey(previousKey, unloadOrder.offsetX[index]!, unloadOrder.offsetY[index]!, unloadOrder.offsetZ[index]!);
      if (known.has(candidateKey)) {
        decisions.unloaded++;
        this.plan.toUnload.push(candidateKey);
      } else {
        decisions.unloadKept++;
      }
    }
    profiler.end(diffToken);
  }

  private hasSkippingRules(): boolean {
    return (
      this.config.surfaceChunkY !== undefined &&
      (this.config.skipAboveSurfaceMargin !== undefined || this.config.skipBelowSurfaceMargin !== undefined)
    );
  }

  /**
   * The neighborhood around the player is exempt from skipping, so a chunk skipped earlier can become required
   * without entering the shell. Re-examines those few offsets (the ones the shell did not already cover).
   */
  private considerNeighborhoodLeftOutOfShell(
    playerKey: number,
    deltaX: number,
    deltaY: number,
    deltaZ: number,
    known: KnownChunkKeys,
  ): void {
    const loadOrder = this.loadOrder;
    for (let offsetX = -NEVER_SKIPPED_NEIGHBORHOOD; offsetX <= NEVER_SKIPPED_NEIGHBORHOOD; offsetX++) {
      for (let offsetY = -NEVER_SKIPPED_NEIGHBORHOOD; offsetY <= NEVER_SKIPPED_NEIGHBORHOOD; offsetY++) {
        for (let offsetZ = -NEVER_SKIPPED_NEIGHBORHOOD; offsetZ <= NEVER_SKIPPED_NEIGHBORHOOD; offsetZ++) {
          const isInVolume = loadOrder.contains(offsetX, offsetY, offsetZ);
          const wasInVolumeBeforeMove = loadOrder.contains(offsetX + deltaX, offsetY + deltaY, offsetZ + deltaZ);
          if (isInVolume && wasInVolumeBeforeMove) this.considerLoadCandidate(playerKey, offsetX, offsetY, offsetZ, known);
        }
      }
    }
  }

  private considerLoadCandidate(
    playerKey: number,
    offsetX: number,
    offsetY: number,
    offsetZ: number,
    known: KnownChunkKeys,
  ): void {
    this.operationCountOfLastUpdate++;
    const decisions = this.decisions;
    decisions.candidatesConsidered++;
    const chunkKey = offsetChunkKey(playerKey, offsetX, offsetY, offsetZ);
    if (known.has(chunkKey)) {
      decisions.alreadyKnown++;
      return;
    }
    const chunkX = this.playerChunkX + offsetX;
    const chunkY = this.playerChunkY + offsetY;
    const chunkZ = this.playerChunkZ + offsetZ;
    if (this.config.minChunkY !== undefined && chunkY < this.config.minChunkY) {
      decisions.rejectedBelowWorld++;
      return;
    }
    if (this.config.maxChunkY !== undefined && chunkY > this.config.maxChunkY) {
      decisions.rejectedAboveWorld++;
      return;
    }

    const surfaceChunkY = this.config.surfaceChunkY?.(chunkX, chunkZ);
    if (surfaceChunkY !== undefined && !this.isInsideNeverSkippedNeighborhood(offsetX, offsetY, offsetZ)) {
      const skipAbove = this.config.skipAboveSurfaceMargin;
      const skipBelow = this.config.skipBelowSurfaceMargin;
      if (skipAbove !== undefined && chunkY > surfaceChunkY + skipAbove) {
        decisions.skippedAboveSurface++;
        return;
      }
      if (skipBelow !== undefined && chunkY < surfaceChunkY - skipBelow) {
        decisions.skippedBelowSurface++;
        return;
      }
    }
    decisions.requested++;
    this.candidateKeys.push(chunkKey);
    this.candidatePriorities.push(this.priorityFromParts(offsetX, offsetY, offsetZ, chunkY, surfaceChunkY));
  }

  private isInsideNeverSkippedNeighborhood(offsetX: number, offsetY: number, offsetZ: number): boolean {
    return (
      Math.abs(offsetX) <= NEVER_SKIPPED_NEIGHBORHOOD &&
      Math.abs(offsetY) <= NEVER_SKIPPED_NEIGHBORHOOD &&
      Math.abs(offsetZ) <= NEVER_SKIPPED_NEIGHBORHOOD
    );
  }

  private computePriority(
    chunkX: number,
    chunkY: number,
    chunkZ: number,
    offsetX: number,
    offsetY: number,
    offsetZ: number,
  ): number {
    return this.priorityFromParts(offsetX, offsetY, offsetZ, chunkY, this.config.surfaceChunkY?.(chunkX, chunkZ));
  }

  private priorityFromParts(
    offsetX: number,
    offsetY: number,
    offsetZ: number,
    chunkY: number,
    surfaceChunkY: number | undefined,
  ): number {
    const distance = Math.sqrt(offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ);
    let priority = distance;
    if (distance > 0) {
      const cosineToForward =
        (offsetX * this.forwardX + offsetY * this.forwardY + offsetZ * this.forwardZ) / distance;
      priority += (this.config.forwardBiasChunks ?? DEFAULT_FORWARD_BIAS_CHUNKS) * (1 - cosineToForward) * 0.5;
    }
    if (surfaceChunkY !== undefined) {
      priority += (this.config.surfaceBandWeight ?? DEFAULT_SURFACE_BAND_WEIGHT) * Math.abs(chunkY - surfaceChunkY);
    }
    return priority;
  }

  private writeSortedLoadList(): void {
    const sortToken = profiler.begin("main.streaming.plan.sortCandidates");
    try {
      this.sortCandidatesIntoPlan();
    } finally {
      profiler.end(sortToken);
    }
  }

  private sortCandidatesIntoPlan(): void {
    const count = this.candidateKeys.length;
    const sortedIndices = this.sortedCandidateIndices;
    sortedIndices.length = count;
    for (let index = 0; index < count; index++) sortedIndices[index] = index;
    const priorities = this.candidatePriorities;
    const keys = this.candidateKeys;
    sortedIndices.sort((left, right) => priorities[left]! - priorities[right]! || keys[left]! - keys[right]!);
    for (let index = 0; index < count; index++) {
      this.plan.toLoad.push(keys[sortedIndices[index]!]!);
      this.plan.toLoadPriorities.push(priorities[sortedIndices[index]!]!);
    }
  }

  private getLoadShell(deltaX: number, deltaY: number, deltaZ: number): Int32Array {
    const cacheKey = shellCacheKey(deltaX, deltaY, deltaZ);
    let shell = this.loadShellByDelta.get(cacheKey);
    if (shell) {
      this.decisions.shellCacheHits++;
      return shell;
    }
    this.decisions.shellCacheMisses++;
    const buildToken = profiler.begin("main.streaming.plan.buildShell.load");
    shell = buildEnteringShell(this.loadOrder, deltaX, deltaY, deltaZ);
    profiler.end(buildToken);
    profiler.recordBytes("bytes.streaming.shell", shell.byteLength);
    this.loadShellByDelta.set(cacheKey, shell);
    return shell;
  }

  private getUnloadShell(deltaX: number, deltaY: number, deltaZ: number): Int32Array {
    const cacheKey = shellCacheKey(deltaX, deltaY, deltaZ);
    let shell = this.unloadShellByDelta.get(cacheKey);
    if (shell) {
      this.decisions.shellCacheHits++;
      return shell;
    }
    this.decisions.shellCacheMisses++;
    const buildToken = profiler.begin("main.streaming.plan.buildShell.unload");
    shell = buildLeavingShell(this.unloadOrder, deltaX, deltaY, deltaZ);
    profiler.end(buildToken);
    profiler.recordBytes("bytes.streaming.shell", shell.byteLength);
    this.unloadShellByDelta.set(cacheKey, shell);
    return shell;
  }
}

function knownChunkCount(known: KnownChunkKeys): number {
  const sized = known as { size?: number };
  return typeof sized.size === "number" ? sized.size : 0;
}

function shellCacheKey(deltaX: number, deltaY: number, deltaZ: number): number {
  const span = 2 * MAX_INCREMENTAL_DELTA + 1;
  return ((deltaX + MAX_INCREMENTAL_DELTA) * span + (deltaY + MAX_INCREMENTAL_DELTA)) * span + (deltaZ + MAX_INCREMENTAL_DELTA);
}

/** Offsets that are in the volume around the new position but were outside it around the old position. */
function buildEnteringShell(order: LoadOrder, deltaX: number, deltaY: number, deltaZ: number): Int32Array {
  const indices: number[] = [];
  for (let index = 0; index < order.offsetCount; index++) {
    if (!order.contains(order.offsetX[index]! + deltaX, order.offsetY[index]! + deltaY, order.offsetZ[index]! + deltaZ)) {
      indices.push(index);
    }
  }
  return Int32Array.from(indices);
}

/** Offsets (relative to the old position) that are in the volume there but outside it around the new position. */
function buildLeavingShell(order: LoadOrder, deltaX: number, deltaY: number, deltaZ: number): Int32Array {
  const indices: number[] = [];
  for (let index = 0; index < order.offsetCount; index++) {
    if (!order.contains(order.offsetX[index]! - deltaX, order.offsetY[index]! - deltaY, order.offsetZ[index]! - deltaZ)) {
      indices.push(index);
    }
  }
  return Int32Array.from(indices);
}
