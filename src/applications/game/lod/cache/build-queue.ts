// Ordering of tile builds. Areas with nothing to show come first (their coarse root, so the horizon appears at once),
// then tiles in the view frustum, then everything else; within a group the nearest tile wins. Stale tiles (real data
// changed under a tile that is already drawn) only refresh after all of that.

import { tileKeyOf, type TileAddress } from "../core/tile-address";

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

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  get waitingCount(): number {
    return this.candidates.length;
  }

  /** Replaces the waiting candidates (recomputed every update); duplicates keep their most urgent entry. */
  replaceCandidates(candidates: BuildCandidate[]): void {
    const bestByKey = new Map<number, BuildCandidate>();
    for (const candidate of candidates) {
      const key = tileKeyOf(candidate.address.level, candidate.address.tileX, candidate.address.tileZ);
      if (this.inFlight.has(key)) continue;
      const existing = bestByKey.get(key);
      if (existing === undefined || compareBuildCandidates(candidate, existing) < 0) bestByKey.set(key, candidate);
    }
    this.candidates = [...bestByKey.values()].sort(compareBuildCandidates);
  }

  /** Takes the most urgent candidate and marks it in flight. */
  takeNext(): BuildCandidate | undefined {
    const next = this.candidates.shift();
    if (next !== undefined) this.inFlight.add(tileKeyOf(next.address.level, next.address.tileX, next.address.tileZ));
    return next;
  }

  isInFlight(address: TileAddress): boolean {
    return this.inFlight.has(tileKeyOf(address.level, address.tileX, address.tileZ));
  }

  markFinished(address: TileAddress): void {
    this.inFlight.delete(tileKeyOf(address.level, address.tileX, address.tileZ));
  }
}
