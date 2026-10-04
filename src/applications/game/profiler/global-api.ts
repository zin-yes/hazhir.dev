import { diffProfiles, renderDiffMarkdown } from "./diff";
import {
  downloadJson,
  loadBaseline,
  saveBaselineReport,
  saveBenchmarkResult,
  saveDiffMarkdown,
  saveProfileReport,
  saveTraceJson,
  type SavedProfilePaths,
} from "./export-report";
import { renderMarkdownReport } from "./markdown-report";
import { profiler } from "./index";
import { buildProfileReport } from "./report";
import { SamplingProfiler } from "./sampling-profiler";
import { exportTrace } from "./trace-export";
import type {
  BenchmarkOptions,
  BenchmarkResult,
  CallTree,
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
  /** Starts or stops timeline capture and resets so the trace covers only what follows. */
  trace(enabled: boolean): void;
  /** Writes `.profiles/latest-trace.json` (open it in ui.perfetto.dev). Null when tracing is off. */
  saveTrace(): Promise<{ tracePath: string } | null>;
  /** Saves the current snapshot report as `.profiles/baselines/<name>.json` (name: a-z, 0-9, hyphen). */
  saveBaseline(name: string): Promise<{ baselinePath: string } | null>;
  /** Diffs the current profile against a saved baseline, saves `.profiles/latest-diff.md` and returns the markdown. */
  diffAgainst(name: string): Promise<string | null>;
  /** Starts the JS Self-Profiling sampler (Chromium, needs the dev Document-Policy header). Resolves false when unsupported. */
  startSampling(sampleIntervalMs?: number): Promise<boolean>;
  /** Stops the sampler and folds its samples into the next snapshot's `sampling` summary. */
  stopSampling(): Promise<void>;
  /** Aggregated call trees of the main thread and every worker pool method. */
  callTree(): CallTree[];
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
  const sampler = new SamplingProfiler();
  profiler.setSamplingSummaryProvider(() => sampler.summary());
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
    trace: (enabled) => {
      profiler.setTracing(enabled);
      profiler.reset();
    },
    saveTrace: async () => {
      const snapshot = profiler.snapshot();
      if (!snapshot.trace) {
        console.warn("Tracing is off. Call __gameProfiler.trace(true), exercise the game, then saveTrace().");
        return null;
      }
      return saveTraceJson(exportTrace(snapshot));
    },
    saveBaseline: (name) => saveBaselineReport(name, { report: buildProfileReport(profiler.snapshot(name)) }),
    diffAgainst: async (name) => {
      const baseline = await loadBaseline(name);
      if (!baseline) return null;
      const markdown = renderDiffMarkdown(diffProfiles(baseline, buildProfileReport(profiler.snapshot())));
      await saveDiffMarkdown(markdown);
      return markdown;
    },
    startSampling: (sampleIntervalMs) => sampler.start(sampleIntervalMs),
    stopSampling: () => sampler.stop(),
    callTree: () => profiler.snapshot().callTrees,
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
    void sampler.stop();
    profiler.setSamplingSummaryProvider(null);
    if (window.__gameProfiler === api) delete window.__gameProfiler;
  };
}
