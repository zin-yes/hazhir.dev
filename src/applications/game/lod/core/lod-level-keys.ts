// Precomputed profiler keys for per-level cost (`L0`..`L12`), so no string is built per call on hot paths. Safe in
// workers: it imports nothing from the profiler.

import { MAX_LOD_LEVEL } from "./lod-constants";

export const LOD_LEVEL_KEYS: readonly string[] = Array.from({ length: MAX_LOD_LEVEL + 1 }, (_, level) => `L${level}`);

export function lodLevelKey(level: number): string {
  return LOD_LEVEL_KEYS[level] ?? LOD_LEVEL_KEYS[MAX_LOD_LEVEL]!;
}

/** `<prefix>L<level>` metric names for every level, built once at module load. */
export function perLevelMetricNames(prefix: string): readonly string[] {
  return LOD_LEVEL_KEYS.map((levelKey) => `${prefix}${levelKey}`);
}

export function metricNameOfLevel(names: readonly string[], level: number): string {
  return names[level] ?? names[names.length - 1]!;
}
