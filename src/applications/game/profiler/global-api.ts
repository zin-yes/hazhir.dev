import { downloadJson, saveBenchmarkResult, saveProfileReport, type SavedProfilePaths } from "./export-report";
import { renderMarkdownReport } from "./markdown-report";
import { profiler } from "./index";
import { buildProfileReport } from "./report";
import type {
  BenchmarkOptions,
  BenchmarkResult,
  ProfileReport,
  ProfileSnapshot,
  ProfilerSettings,
} from "./types";

export type RunBenchmark = (options?: BenchmarkOptions) => Promise<BenchmarkResult>;

/** Scriptable surface of the profiler for agents (Playwright evaluate) and the console. */
export interface GameProfilerApi {
  enable(): void;
  disable(): void;
  isEnabled(): boolean;
  reset(label?: string): void;
  snapshot(): ProfileSnapshot;
  report(): ProfileReport;
  markdown(): string;
  /** Posts the current report to the dev server, which writes it into .profiles/. */
  save(label?: string): Promise<SavedProfilePaths | null>;
  download(filename?: string): void;
  /** Runs the scripted benchmark, saves the result into .profiles/ and returns it. */
  runBenchmark(options?: BenchmarkOptions): Promise<BenchmarkResult>;
  readonly settings: ProfilerSettings;
}

declare global {
  interface Window {
    __gameProfiler?: GameProfilerApi;
  }
}

export function installGlobalProfilerApi(options: { runBenchmark?: RunBenchmark }): () => void {
  const api: GameProfilerApi = {
    enable: () => profiler.setEnabled(true),
    disable: () => profiler.setEnabled(false),
    isEnabled: () => profiler.enabled,
    reset: (label) => profiler.reset(label),
    snapshot: () => profiler.snapshot(),
    report: () => buildProfileReport(profiler.snapshot()),
    markdown: () => renderMarkdownReport(buildProfileReport(profiler.snapshot())),
    save: (label) => saveProfileReport(buildProfileReport(profiler.snapshot(label)), label),
    download: (filename = "game-profile.json") =>
      downloadJson(filename, buildProfileReport(profiler.snapshot())),
    runBenchmark: async (benchmarkOptions) => {
      if (!options.runBenchmark) throw new Error("No benchmark runner is registered");
      const result = await options.runBenchmark(benchmarkOptions);
      await saveBenchmarkResult(result);
      return result;
    },
    settings: profiler.settings,
  };
  window.__gameProfiler = api;
  return () => {
    if (window.__gameProfiler === api) delete window.__gameProfiler;
  };
}
