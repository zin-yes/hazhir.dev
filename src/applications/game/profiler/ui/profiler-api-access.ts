/**
 * Optional methods of window.__gameProfiler that the overlay tabs call when
 * present. They are feature detected so the overlay keeps working while the
 * global API grows.
 */
export interface OptionalProfilerApi {
  trace?: (enabled: boolean) => unknown;
  saveTrace?: () => unknown;
  saveBaseline?: (name: string) => unknown;
  diffAgainst?: (name: string) => unknown;
}

export function getOptionalProfilerApi(): OptionalProfilerApi {
  if (typeof window === "undefined") return {};
  return (window.__gameProfiler ?? {}) as unknown as OptionalProfilerApi;
}
