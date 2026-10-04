import type { OptimizationHint, SamplingSummary } from "./types";

export const SAMPLING_MIN_SAMPLES = 50;
export const DOMINANT_FUNCTION_MIN_SHARE = 0.15;
export const DOMINANT_FUNCTION_HIGH_SHARE = 0.3;
export const THIRD_PARTY_RESOURCE_MIN_SHARE = 0.2;
export const THIRD_PARTY_RESOURCE_HIGH_SHARE = 0.4;
/** Sampled self time more than this multiple of the instrumented self time counts as unattributed. */
export const UNATTRIBUTED_SAMPLED_TO_INSTRUMENTED_RATIO = 4;

const THIRD_PARTY_PATH_PATTERN = /node_modules|\/vendor\b|\/framework[-.]/;

/**
 * Cross-origin scripts and bundled dependency chunks count as third party.
 * Empty resources (native frames, eval) are not attributable and are excluded.
 */
export function isThirdPartyResource(resource: string, pageOrigin: string | null): boolean {
  if (!resource) return false;
  if (THIRD_PARTY_PATH_PATTERN.test(resource)) return true;
  if (pageOrigin && /^https?:\/\//.test(resource)) {
    return !resource.startsWith(`${pageOrigin}/`);
  }
  return false;
}

function resolvePageOrigin(): string | null {
  const location = (globalThis as { location?: { origin?: string } }).location;
  return location?.origin ?? null;
}

function describeResource(resource: string): string {
  return resource ? resource.split(/[?#]/)[0]!.split("/").pop() || resource : "native code";
}

function formatPercent(share: number): string {
  return `${(share * 100).toFixed(0)}%`;
}

/**
 * @param instrumentedSelfMsByFunctionHint instrumented self milliseconds keyed by
 * function name (or the name an instrumented scope shares with it). A hot sampled
 * function missing from it, or far above it, is reported as unattributed.
 */
export function samplingHints(
  summary: SamplingSummary | null,
  instrumentedSelfMsByFunctionHint?: Record<string, number>,
  pageOrigin: string | null = resolvePageOrigin(),
): OptimizationHint[] {
  if (!summary || summary.totalSamples < SAMPLING_MIN_SAMPLES) return [];

  const hints: OptimizationHint[] = [];
  const functionNamesReportedAsUnattributed = new Set<string>();

  if (instrumentedSelfMsByFunctionHint) {
    for (const entry of summary.topSelf) {
      const share = entry.samples / summary.totalSamples;
      if (share < DOMINANT_FUNCTION_MIN_SHARE) continue;
      const instrumentedMs = instrumentedSelfMsByFunctionHint[entry.functionName] ?? 0;
      if (instrumentedMs * UNATTRIBUTED_SAMPLED_TO_INSTRUMENTED_RATIO >= entry.selfMs) continue;
      functionNamesReportedAsUnattributed.add(`${entry.functionName}@${entry.resource}:${entry.line}`);
      hints.push({
        severity: share >= DOMINANT_FUNCTION_HIGH_SHARE ? "high" : "medium",
        title: `${entry.functionName} dominates sampled CPU but is not instrumented`,
        evidence: `${formatPercent(share)} of ${summary.totalSamples} busy samples (${entry.selfMs.toFixed(0)} ms self) in ${entry.functionName} at ${describeResource(entry.resource)}:${entry.line}; instrumented self time for it is ${instrumentedMs.toFixed(1)} ms.`,
        suggestion: `Wrap ${entry.functionName} in a profiler scope to see its per-call cost and callers, then optimize it. Time here is also part of the unattributed frame time.`,
      });
    }
  }

  for (const entry of summary.topSelf) {
    const share = entry.samples / summary.totalSamples;
    if (share < DOMINANT_FUNCTION_MIN_SHARE) continue;
    if (functionNamesReportedAsUnattributed.has(`${entry.functionName}@${entry.resource}:${entry.line}`)) continue;
    hints.push({
      severity: share >= DOMINANT_FUNCTION_HIGH_SHARE ? "high" : "medium",
      title: `${entry.functionName} is a CPU hot spot`,
      evidence: `${formatPercent(share)} of ${summary.totalSamples} busy samples (${entry.selfMs.toFixed(0)} ms self) in ${entry.functionName} at ${describeResource(entry.resource)}:${entry.line}.`,
      suggestion: `Optimize ${entry.functionName} itself: reduce its work per call, call it less often, or cache its result. Check the top stacks for who calls it.`,
    });
  }

  const samplesByThirdPartyResource = new Map<string, { samples: number; hottestFunction: string; hottestSamples: number }>();
  for (const entry of summary.topSelf) {
    if (!isThirdPartyResource(entry.resource, pageOrigin)) continue;
    const tally = samplesByThirdPartyResource.get(entry.resource) ?? {
      samples: 0,
      hottestFunction: entry.functionName,
      hottestSamples: 0,
    };
    tally.samples += entry.samples;
    if (entry.samples > tally.hottestSamples) {
      tally.hottestSamples = entry.samples;
      tally.hottestFunction = entry.functionName;
    }
    samplesByThirdPartyResource.set(entry.resource, tally);
  }

  for (const [resource, tally] of samplesByThirdPartyResource) {
    const share = tally.samples / summary.totalSamples;
    if (share < THIRD_PARTY_RESOURCE_MIN_SHARE) continue;
    hints.push({
      severity: share >= THIRD_PARTY_RESOURCE_HIGH_SHARE ? "high" : "medium",
      title: `Third-party code ${describeResource(resource)} uses much of the CPU`,
      evidence: `${formatPercent(share)} of ${summary.totalSamples} busy samples (${(tally.samples * summary.sampleIntervalMs).toFixed(0)} ms self) are inside ${describeResource(resource)}; hottest function is ${tally.hottestFunction}.`,
      suggestion: `Reduce how often game code calls into ${describeResource(resource)} (fewer draw calls, objects or updates per frame) since its internals cannot be edited.`,
    });
  }

  return hints;
}
