/**
 * Shared, JSON-serializable shapes of the game profiler.
 * Everything in a ProfileSnapshot is plain data so it can be rendered by the
 * overlay, posted to the dev API route, and read by an agent from disk.
 */

export const PROFILE_SCHEMA_VERSION = 1;

/**
 * Where a measured cost lands:
 * - main-cpu:   JavaScript running on the main thread (blocks frames)
 * - worker-cpu: JavaScript running inside a Web Worker (off the main thread)
 * - gpu:        GPU execution time (disjoint timer query)
 * - gl:         main-thread CPU spent inside WebGL API calls (driver/command encoding)
 * - transfer:   serialization / structured clone / postMessage transit
 * - latency:    wall-clock duration of an asynchronous pipeline (not CPU time)
 * - browser:    browser-reported pauses (long tasks, long animation frames, event loop lag)
 */
export type MetricDomain =
  | "main-cpu"
  | "worker-cpu"
  | "gpu"
  | "gl"
  | "transfer"
  | "latency"
  | "browser";

export interface DistributionSummary {
  count: number;
  total: number;
  mean: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  /** Average of the totals of the most recent completed seconds. */
  recentPerSecondTotal: number;
  /** Average sample count over the most recent completed seconds. */
  recentPerSecondCount: number;
  /** Totals per completed second, oldest first, at most 60 entries. */
  perSecondHistory: number[];
}

export interface TimerSummary extends DistributionSummary {
  name: string;
  domain: MetricDomain;
  unit: "ms";
  /** Time excluding nested scopes. Equals total for non-stack timers. */
  selfTotal: number;
  /** Most recent enclosing scope on the main thread, if any. */
  parent: string | null;
}

export interface ByteSummary extends DistributionSummary {
  name: string;
  unit: "bytes";
}

export interface CounterSummary {
  name: string;
  unit: string;
  total: number;
  recentPerSecond: number;
}

export interface GaugeSummary {
  name: string;
  unit: string;
  last: number;
  min: number;
  max: number;
  mean: number;
  samples: number;
  /** Most recent samples, oldest first, at most 120 entries. */
  history: number[];
}

export interface WorkerPoolSummary {
  name: string;
  workerCount: number;
  tasksCompleted: number;
  tasksFailed: number;
  /** Fraction (0..1) of worker-seconds spent executing tasks, recent seconds. */
  utilization: number;
  /** Task execution milliseconds per wall second, recent seconds. */
  busyMillisecondsPerSecond: number;
  queueDepth: GaugeSummary | null;
}

export interface FrameNotes {
  [key: string]: number;
}

export interface WorstFrame {
  frameId: number;
  /** Milliseconds since profiling started. */
  atMs: number;
  intervalMs: number;
  /** Sum of self time of all measured main-thread scopes in this interval. */
  busyMs: number;
  /** intervalMs - busyMs: GC, compositor, vsync idle, GPU backpressure, unmeasured code. */
  unattributedMs: number;
  gpuMs: number | null;
  topScopes: { name: string; selfMs: number }[];
  notes: FrameNotes;
}

export interface FrameSummary {
  count: number;
  intervalMs: DistributionSummary;
  busyMs: DistributionSummary;
  gpuMs: DistributionSummary;
  framesOver16Point7Ms: number;
  framesOver33Ms: number;
  framesOver50Ms: number;
  /** Last 240 frame intervals, oldest first. */
  recentIntervalsMs: number[];
  recentBusyMs: number[];
  recentGpuMs: (number | null)[];
  worst: WorstFrame[];
}

export interface MeshGeometryStats {
  kind: "opaque" | "transparent";
  vertexCount: number;
  triangleCount: number;
  bytesByAttribute: { [attribute: string]: number };
}

export interface HeaviestMesh {
  chunkName: string;
  kind: "opaque" | "transparent";
  vertexCount: number;
  triangleCount: number;
  totalBytes: number;
}

export interface MeshAggregate {
  liveMeshes: number;
  liveVertices: number;
  liveTriangles: number;
  liveBytes: number;
  builtTotal: number;
  bytesByAttribute: { [attribute: string]: number };
  bytesPerVertex: number;
  bytesPerVertexByAttribute: { [attribute: string]: number };
  verticesPerMesh: DistributionSummary;
  heaviest: HeaviestMesh[];
}

export interface BrowserEvent {
  kind: "long-task" | "long-animation-frame" | "event-loop-lag" | "gc-estimate" | "marker";
  atMs: number;
  durationMs: number;
  detail: string;
}

export interface SessionInfo {
  userAgent: string;
  devicePixelRatio: number;
  viewport: { width: number; height: number };
  hardwareConcurrency: number;
  crossOriginIsolated: boolean;
  gpuRenderer: string | null;
  gpuVendor: string | null;
  gpuTimerSupported: boolean;
  gpuTimerMode: "disjoint-timer-query" | "finish-sync-estimate" | "none";
  gpuPassBreakdownEnabled: boolean;
  /** Measured at startup; null until calibrated. */
  structuredCloneMegabytesPerSecond: number | null;
  timerResolutionNote: string;
  game: { [key: string]: number | string };
}

export interface ProfileSnapshot {
  schemaVersion: number;
  capturedAtIso: string;
  label: string;
  profiledForMs: number;
  session: SessionInfo;
  frames: FrameSummary;
  timers: TimerSummary[];
  bytes: ByteSummary[];
  counters: CounterSummary[];
  gauges: GaugeSummary[];
  workerPools: WorkerPoolSummary[];
  meshes: MeshAggregate;
  events: BrowserEvent[];
}

/** One ranked line of the optimization-target list produced by report.ts. */
export interface OptimizationTarget {
  rank: number;
  group:
    | "main-thread"
    | "gpu"
    | "gl-driver"
    | "worker"
    | "transfer"
    | "memory"
    | "latency";
  name: string;
  /** Cost in milliseconds per wall-clock second (null for pure size entries). */
  millisecondsPerSecond: number | null;
  /** Share of the 16.7 ms frame budget for main-thread/GPU entries, else null. */
  frameBudgetSharePercent: number | null;
  bytesPerSecond: number | null;
  count: number;
  meanMs: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  note: string;
}

export interface OptimizationHint {
  severity: "high" | "medium" | "low";
  title: string;
  evidence: string;
  suggestion: string;
}

export interface ProfileReport {
  snapshot: ProfileSnapshot;
  targets: OptimizationTarget[];
  hints: OptimizationHint[];
}

/** Result of a scripted benchmark: one report per phase plus the whole run. */
export interface BenchmarkResult {
  schemaVersion: number;
  startedAtIso: string;
  seed: number;
  phases: { name: string; durationSeconds: number; report: ProfileReport }[];
  overall: ProfileReport;
}

export interface BenchmarkOptions {
  /** World seed so runs are comparable. Defaults to a fixed constant. */
  seed?: number;
  /** Straight-line flight over unloaded terrain (chunk streaming). */
  flySeconds?: number;
  /** Camera turning in place over loaded terrain (steady-state rendering). */
  hoverSeconds?: number;
  /** Place and break blocks in a burst (relight and remesh path). */
  editSeconds?: number;
}

export interface ProfilerSettings {
  /**
   * Splits renderer.render into sky / opaque / transparent / overlay passes so
   * each gets its own GPU timer query. Slightly distorts CPU render time.
   */
  gpuPassBreakdown: boolean;
}
