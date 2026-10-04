// Counts density function evaluations per node type for the worker profiler. Nodes call `noteDensityEvaluation`
// from `compute`; while profiling is off `probe.counts` is null, so the only cost is one property load and a null
// check. While profiling, counts accumulate in a preallocated array and are flushed once per pipeline stage, never
// per evaluation.

import { DIMENSIONS } from "@/applications/game/profiler/dimensions";
import { addWorkerCounter, addWorkerKeyedUnits, isWorkerProfiling } from "@/applications/game/profiler/worker-recorder";

const evaluationTypeNames: string[] = [];
const isCacheHitSlot: boolean[] = [];
const indexByTypeName = new Map<string, number>();

/** Registers a node type once and returns its slot in the counts array. */
export function densityNodeTypeIndex(typeName: string): number {
  let index = indexByTypeName.get(typeName);
  if (index === undefined) {
    index = evaluationTypeNames.length;
    evaluationTypeNames.push(typeName);
    isCacheHitSlot.push(false);
    indexByTypeName.set(typeName, index);
  }
  return index;
}

/** Registers the evaluation slot of a cache node type and, right after it, the slot counting its cache hits. */
export function densityCacheTypeIndex(typeName: string): number {
  const evaluationIndex = densityNodeTypeIndex(typeName);
  const hitName = `${typeName}.hit`;
  if (!indexByTypeName.has(hitName)) {
    indexByTypeName.set(hitName, evaluationTypeNames.length);
    evaluationTypeNames.push(hitName);
    isCacheHitSlot.push(true);
  }
  return evaluationIndex;
}

export const densityEvaluationProbe: { counts: Float64Array | null } = { counts: null };

export function noteDensityEvaluation(typeIndex: number): void {
  const counts = densityEvaluationProbe.counts;
  if (counts !== null) counts[typeIndex]++;
}

/** Cache hit slots always sit directly after the cache type's evaluation slot. */
export function noteDensityCacheHit(evaluationTypeIndex: number): void {
  const counts = densityEvaluationProbe.counts;
  if (counts !== null) counts[evaluationTypeIndex + 1]++;
}

let sharedCounts: Float64Array | null = null;

/** Starts counting when a worker profile is being recorded; a no-op otherwise. */
export function startDensityEvaluationCounting(): void {
  if (!isWorkerProfiling()) return;
  if (sharedCounts === null || sharedCounts.length !== evaluationTypeNames.length) {
    sharedCounts = new Float64Array(evaluationTypeNames.length);
  } else {
    sharedCounts.fill(0);
  }
  densityEvaluationProbe.counts = sharedCounts;
}

/** Writes the batched counts into the profile (units per node type, cache hits and misses as counters) and stops counting. */
export function stopDensityEvaluationCounting(): void {
  const counts = densityEvaluationProbe.counts;
  if (counts === null) return;
  densityEvaluationProbe.counts = null;
  let totalEvaluations = 0;
  for (let slot = 0; slot < counts.length; slot++) {
    const count = counts[slot]!;
    if (count === 0 || isCacheHitSlot[slot]) continue;
    counts[slot] = 0;
    totalEvaluations += count;
    const typeName = evaluationTypeNames[slot]!;
    addWorkerKeyedUnits(DIMENSIONS.worldgenDensityNode, typeName, count);
    if (isCacheHitSlot[slot + 1]) {
      const hits = counts[slot + 1]!;
      counts[slot + 1] = 0;
      addWorkerCounter(`densityCacheHits.${typeName}`, hits);
      addWorkerCounter(`densityCacheMisses.${typeName}`, count - hits);
    }
  }
  addWorkerCounter("densityEvaluations", totalEvaluations);
}
