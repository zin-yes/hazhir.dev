import type { BenchmarkResult, ProfileReport } from "./types";

const GAME_PROFILE_ROUTE = "/api/dev/game-profile";

export interface SavedProfilePaths {
  jsonPath: string;
  markdownPath: string;
}

export const BASELINE_NAME_PATTERN = /^[a-z0-9-]{1,40}$/;

export function assertValidBaselineName(name: string) {
  if (!BASELINE_NAME_PATTERN.test(name)) {
    throw new Error(`Baseline name "${name}" must match ${BASELINE_NAME_PATTERN} (lowercase letters, digits, hyphens, at most 40)`);
  }
}

async function postToProfileRoute<Saved = SavedProfilePaths>(body: object): Promise<Saved | null> {
  try {
    const response = await fetch(GAME_PROFILE_ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      console.warn(
        `Saving the profile failed (${response.status}). The save route only exists in the dev server.`,
      );
      return null;
    }
    return (await response.json()) as Saved;
  } catch (error) {
    console.warn("Saving the profile failed:", error);
    return null;
  }
}

/** Writes a report into the repo's .profiles folder via the dev server. */
export function saveProfileReport(
  report: ProfileReport,
  label?: string,
): Promise<SavedProfilePaths | null> {
  return postToProfileRoute({ kind: "snapshot", label, report });
}

export function saveBenchmarkResult(result: BenchmarkResult): Promise<SavedProfilePaths | null> {
  return postToProfileRoute({ kind: "benchmark", benchmark: result });
}

/** Writes `.profiles/latest-trace.json` (Chrome Trace Event JSON for Perfetto). */
export function saveTraceJson(traceJson: string): Promise<{ tracePath: string } | null> {
  return postToProfileRoute<{ tracePath: string }>({ kind: "trace", traceJson });
}

/** Writes `.profiles/latest-diff.md`. */
export function saveDiffMarkdown(markdown: string): Promise<{ diffPath: string } | null> {
  return postToProfileRoute<{ diffPath: string }>({ kind: "diff", markdown });
}

/** Writes `.profiles/baselines/<name>.json` from a snapshot report or a benchmark result. */
export function saveBaselineReport(
  name: string,
  content: { report: ProfileReport } | { benchmark: BenchmarkResult },
): Promise<{ baselinePath: string } | null> {
  assertValidBaselineName(name);
  return postToProfileRoute<{ baselinePath: string }>({ kind: "baseline", name, ...content });
}

/** Reads a saved baseline (snapshot report or benchmark result) back from the dev server. */
export async function loadBaseline(name: string): Promise<ProfileReport | BenchmarkResult | null> {
  assertValidBaselineName(name);
  try {
    const response = await fetch(`${GAME_PROFILE_ROUTE}?baseline=${encodeURIComponent(name)}`);
    if (!response.ok) {
      console.warn(`Loading baseline "${name}" failed (${response.status}).`);
      return null;
    }
    return (await response.json()) as ProfileReport | BenchmarkResult;
  } catch (error) {
    console.warn("Loading the baseline failed:", error);
    return null;
  }
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
