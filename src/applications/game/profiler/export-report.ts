import type { BenchmarkResult, ProfileReport } from "./types";

const GAME_PROFILE_ROUTE = "/api/dev/game-profile";

export interface SavedProfilePaths {
  jsonPath: string;
  markdownPath: string;
}

async function postToProfileRoute(body: object): Promise<SavedProfilePaths | null> {
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
    return (await response.json()) as SavedProfilePaths;
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

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
