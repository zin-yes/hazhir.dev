// Batched counters for loops too hot for addWorkerCounter (which looks a name up in an object on every call). A site
// registers its counter once at module load and bumps a slot of a preallocated array; while no profile is recording
// the array is absent, so the cost of a bump is one property load and a null check. Entry points open a counting
// window with beginHotCounting (a no-op unless a worker profile is recording) and close it with endHotCounting, which
// moves the totals into the profile in one pass. Windows nest (a stage runs inside a decoration region).
// Same idea as density-evaluation-counter.ts, for everything that is not a density node.

import { addWorkerCounter, isWorkerProfiling } from "@/applications/game/profiler/worker-recorder";
import { flushColdStartLedger } from "./cold-start-ledger";

/** Fixed capacity: a counter registered while a window is open (a cache built lazily) must still have its slot. */
const MAX_HOT_COUNTERS = 2048;
const counterNames: string[] = [];
const slotByName = new Map<string, number>();

/** Registers a counter once (at module load) and returns its slot. The same name always gives the same slot. */
export function defineHotCounter(name: string): number {
  let slot = slotByName.get(name);
  if (slot === undefined) {
    if (counterNames.length >= MAX_HOT_COUNTERS) throw new Error(`More than ${MAX_HOT_COUNTERS} hot counters; raise MAX_HOT_COUNTERS`);
    slot = counterNames.length;
    counterNames.push(name);
    slotByName.set(name, slot);
  }
  return slot;
}

export const hotCounterProbe: { counts: Float64Array | null } = { counts: null };

export function noteHot(slot: number): void {
  const counts = hotCounterProbe.counts;
  if (counts !== null) counts[slot]++;
}

export function noteHotAmount(slot: number, amount: number): void {
  const counts = hotCounterProbe.counts;
  if (counts !== null) counts[slot] += amount;
}

let nestingDepth = 0;
const sharedCounts = new Float64Array(MAX_HOT_COUNTERS);

function flushCountsIntoProfile(): void {
  const counts = sharedCounts;
  for (let slot = 0; slot < counterNames.length; slot++) {
    const count = counts[slot]!;
    if (count === 0) continue;
    counts[slot] = 0;
    addWorkerCounter(counterNames[slot]!, count);
  }
}

/** Starts counting when a worker profile is recording. Pass the result to endHotCounting. */
export function beginHotCounting(): boolean {
  if (!isWorkerProfiling()) return false;
  if (nestingDepth === 0) {
    hotCounterProbe.counts = sharedCounts;
    flushColdStartLedger();
  }
  nestingDepth++;
  return true;
}

export function endHotCounting(didBegin: boolean): void {
  if (!didBegin) return;
  flushCountsIntoProfile();
  nestingDepth--;
  if (nestingDepth === 0) hotCounterProbe.counts = null;
}
