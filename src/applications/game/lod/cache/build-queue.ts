// Ordering of tile builds. Areas with nothing to show come first (their coarse root, so the horizon appears at once),
// then tiles in the view frustum, then everything else; within a group the nearest tile wins. Stale tiles (real data
// changed under a tile that is already drawn) only refresh after all of that.

import { profiler } from "../../profiler";
import { metricNameOfLevel, perLevelMetricNames } from "../core/lod-level-keys";
import { tileKeyOf, type TileAddress } from "../core/tile-address";

const QUEUE_WAIT_PER_LEVEL = perLevelMetricNames("latency.lod.buildQueueWait.");
const ROUND_TRIP_PER_LEVEL = perLevelMetricNames("latency.lod.buildRoundTrip.");
const QUEUE_TO_DONE_PER_LEVEL = perLevelMetricNames("latency.lod.buildQueueToDone.");
const DISPATCHED_PER_LEVEL = perLevelMetricNames("game.lod.queue.dispatched.");
const URGENCY_COUNTER_NAMES = ["game.lod.queue.urgency.uncovered", "game.lod.queue.urgency.refine", "game.lod.queue.urgency.refresh"];
const DISPATCH_URGENCY_COUNTER_NAMES = [
  "game.lod.queue.dispatchedUncovered",
  "game.lod.queue.dispatchedRefine",
  "game.lod.queue.dispatchedRefresh",
];

interface InFlightTiming {
  waitingSinceMilliseconds: number;
  dispatchedAtMilliseconds: number;
}

export enum BuildUrgency {
  /** No ready tile covers the area at all. */
  Uncovered = 0,
  /** A stand-in (coarser ancestor or finer children) is drawn meanwhile. */
  Refine = 1,
  /** Drawn, but built from outdated real chunk data. */
  Refresh = 2,
}

export interface BuildCandidate {
  address: TileAddress;
  urgency: BuildUrgency;
  inFrustum: boolean;
  distance: number;
}

export function compareBuildCandidates(first: BuildCandidate, second: BuildCandidate): number {
  if (first.urgency !== second.urgency) return first.urgency - second.urgency;
  if (first.inFrustum !== second.inFrustum) return first.inFrustum ? -1 : 1;
  return first.distance - second.distance;
}

export class BuildQueue {
  private candidates: BuildCandidate[] = [];
  private readonly inFlight = new Set<number>();
  /** Profiler bookkeeping: when each waiting candidate first appeared, and the timing of each in-flight build. */
  private readonly waitingSinceMilliseconds = new Map<number, number>();
  private readonly inFlightTimings = new Map<number, InFlightTiming>();

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  get waitingCount(): number {
    return this.candidates.length;
  }

  /** Replaces the waiting candidates (recomputed every update); duplicates keep their most urgent entry. */
  replaceCandidates(candidates: BuildCandidate[]): void {
    const bestByKey = new Map<number, BuildCandidate>();
    let skippedInFlight = 0;
    for (const candidate of candidates) {
      const key = tileKeyOf(candidate.address.level, candidate.address.tileX, candidate.address.tileZ);
      if (this.inFlight.has(key)) {
        skippedInFlight++;
        continue;
      }
      const existing = bestByKey.get(key);
      if (existing === undefined || compareBuildCandidates(candidate, existing) < 0) bestByKey.set(key, candidate);
    }
    const previousWaiting = this.candidates;
    this.candidates = [...bestByKey.values()].sort(compareBuildCandidates);
    if (profiler.enabled) this.reportReplacement(candidates.length, skippedInFlight, previousWaiting);
  }

  private reportReplacement(offeredCount: number, skippedInFlight: number, previousWaiting: readonly BuildCandidate[]): void {
    const nowMilliseconds = profiler.now();
    let carriedOver = 0;
    const urgencyCounts = [0, 0, 0];
    const currentKeys = new Set<number>();
    for (const candidate of this.candidates) {
      const key = tileKeyOf(candidate.address.level, candidate.address.tileX, candidate.address.tileZ);
      currentKeys.add(key);
      urgencyCounts[candidate.urgency]!++;
      if (this.waitingSinceMilliseconds.has(key)) carriedOver++;
      else this.waitingSinceMilliseconds.set(key, nowMilliseconds);
    }
    let droppedBeforeDispatch = 0;
    for (const previous of previousWaiting) {
      const key = tileKeyOf(previous.address.level, previous.address.tileX, previous.address.tileZ);
      if (!currentKeys.has(key)) droppedBeforeDispatch++;
    }
    for (const key of this.waitingSinceMilliseconds.keys()) {
      if (!currentKeys.has(key)) this.waitingSinceMilliseconds.delete(key);
    }
    profiler.addCounter("game.lod.queue.replacements");
    profiler.addCounter("game.lod.queue.candidatesOffered", offeredCount);
    profiler.addCounter("game.lod.queue.skippedInFlight", skippedInFlight);
    profiler.addCounter("game.lod.queue.duplicatesMerged", offeredCount - skippedInFlight - this.candidates.length);
    profiler.addCounter("game.lod.queue.carriedOver", carriedOver);
    profiler.addCounter("game.lod.queue.droppedBeforeDispatch", droppedBeforeDispatch);
    for (let urgency = 0; urgency < urgencyCounts.length; urgency++) {
      if (urgencyCounts[urgency]! > 0) profiler.addCounter(URGENCY_COUNTER_NAMES[urgency]!, urgencyCounts[urgency]!);
    }
    profiler.sampleGauge("queue.lod.candidates", this.candidates.length);
  }

  /** Takes the most urgent candidate and marks it in flight. */
  takeNext(): BuildCandidate | undefined {
    const next = this.candidates.shift();
    if (next === undefined) return undefined;
    const key = tileKeyOf(next.address.level, next.address.tileX, next.address.tileZ);
    this.inFlight.add(key);
    if (profiler.enabled) this.reportDispatch(key, next);
    return next;
  }

  private reportDispatch(key: number, dispatched: BuildCandidate): void {
    const nowMilliseconds = profiler.now();
    const waitingSince = this.waitingSinceMilliseconds.get(key);
    this.waitingSinceMilliseconds.delete(key);
    profiler.addCounter("game.lod.queue.dispatched");
    profiler.addCounter(DISPATCH_URGENCY_COUNTER_NAMES[dispatched.urgency]!);
    profiler.addCounter(metricNameOfLevel(DISPATCHED_PER_LEVEL, dispatched.address.level));
    if (waitingSince === undefined) return;
    const waitMilliseconds = nowMilliseconds - waitingSince;
    profiler.recordTimer("latency.lod.buildQueueWait", waitMilliseconds, "latency");
    profiler.recordTimer(metricNameOfLevel(QUEUE_WAIT_PER_LEVEL, dispatched.address.level), waitMilliseconds, "latency");
    this.inFlightTimings.set(key, { waitingSinceMilliseconds: waitingSince, dispatchedAtMilliseconds: nowMilliseconds });
  }

  isInFlight(address: TileAddress): boolean {
    return this.inFlight.has(tileKeyOf(address.level, address.tileX, address.tileZ));
  }

  markFinished(address: TileAddress): void {
    const key = tileKeyOf(address.level, address.tileX, address.tileZ);
    this.inFlight.delete(key);
    const timing = this.inFlightTimings.get(key);
    if (timing === undefined) return;
    this.inFlightTimings.delete(key);
    if (!profiler.enabled) return;
    const nowMilliseconds = profiler.now();
    profiler.recordTimer("latency.lod.buildRoundTrip", nowMilliseconds - timing.dispatchedAtMilliseconds, "latency");
    profiler.recordTimer(metricNameOfLevel(ROUND_TRIP_PER_LEVEL, address.level), nowMilliseconds - timing.dispatchedAtMilliseconds, "latency");
    profiler.recordTimer("latency.lod.buildQueueToDone", nowMilliseconds - timing.waitingSinceMilliseconds, "latency");
    profiler.recordTimer(metricNameOfLevel(QUEUE_TO_DONE_PER_LEVEL, address.level), nowMilliseconds - timing.waitingSinceMilliseconds, "latency");
  }
}
