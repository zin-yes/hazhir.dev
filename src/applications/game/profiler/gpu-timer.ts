import type { Profiler } from "./profiler";

const DISJOINT_TIMER_EXTENSION = "EXT_disjoint_timer_query_webgl2";
const DEFAULT_MAX_IN_FLIGHT_QUERIES = 8;
const NANOSECONDS_PER_MILLISECOND = 1_000_000;
const FRAME_LABEL = "frame";
const MAX_TRACKED_INCOMPLETE_FRAMES = 64;

export type GpuTimerMode = "disjoint-timer-query" | "finish-sync-estimate" | "none";

export interface TimerQueryExtension {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

/** The subset of WebGL2RenderingContext that GpuTimer uses. */
export interface GpuTimerContext {
  QUERY_RESULT: number;
  QUERY_RESULT_AVAILABLE: number;
  getExtension(name: string): unknown;
  createQuery(): object | null;
  deleteQuery(query: object): void;
  beginQuery(target: number, query: object): void;
  endQuery(target: number): void;
  getQueryParameter(query: object, parameter: number): unknown;
  getParameter(parameter: number): unknown;
  finish(): void;
}

interface PendingQuery {
  query: object;
  label: string;
  frameId: number;
  isTainted: boolean;
}

interface ActiveMeasurement {
  query: object | null;
  label: string;
  frameId: number;
  startedAtMs: number;
}

export interface GpuTimerOptions {
  maxInFlightQueries?: number;
  /** Use gl.finish() timing when the timer query extension is unavailable. */
  requestSyncEstimate?: boolean;
}

/**
 * Measures GPU execution time with timer queries. Only one query can be
 * active at a time, results arrive a few frames later, and results measured
 * across a GPU disjoint event are discarded. When the pool is exhausted new
 * measurements are dropped rather than queued.
 *
 * Labels other than "frame" are parts of a frame (render passes): each is
 * recorded as gpu.pass.<label> and the parts of one frame are summed into the
 * frame's GPU time once every part has resolved.
 */
export class GpuTimer {
  readonly supported: boolean;

  private readonly extension: TimerQueryExtension | null;
  private readonly maxInFlightQueries: number;
  private syncEstimateRequested: boolean;
  private freeQueries: object[] = [];
  private pendingQueries: PendingQuery[] = [];
  private active: ActiveMeasurement | null = null;
  private partialFrameTotals = new Map<number, number>();
  private incompleteFrames = new Set<number>();

  constructor(
    private readonly gl: GpuTimerContext,
    private readonly profiler: Profiler,
    options: GpuTimerOptions = {},
  ) {
    this.extension = gl.getExtension(DISJOINT_TIMER_EXTENSION) as TimerQueryExtension | null;
    this.supported = this.extension !== null;
    this.maxInFlightQueries = options.maxInFlightQueries ?? DEFAULT_MAX_IN_FLIGHT_QUERIES;
    this.syncEstimateRequested = options.requestSyncEstimate ?? false;
  }

  get mode(): GpuTimerMode {
    if (this.supported) return "disjoint-timer-query";
    return this.syncEstimateRequested ? "finish-sync-estimate" : "none";
  }

  setSyncEstimateRequested(requested: boolean) {
    this.syncEstimateRequested = requested;
  }

  get inFlightCount(): number {
    return this.pendingQueries.length + (this.active?.query ? 1 : 0);
  }

  begin(label: string, frameId: number) {
    if (this.active) {
      this.profiler.addCounter("gpu.timer.nestedBeginIgnored");
      return;
    }
    const startedAtMs = performance.now();

    if (!this.extension) {
      if (this.syncEstimateRequested) {
        this.active = { query: null, label, frameId, startedAtMs };
      }
      return;
    }
    if (this.inFlightCount >= this.maxInFlightQueries) {
      this.profiler.addCounter("gpu.timer.dropped");
      this.incompleteFrames.add(frameId);
      return;
    }
    const query = this.freeQueries.pop() ?? this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, query);
    this.active = { query, label, frameId, startedAtMs };
  }

  end() {
    const active = this.active;
    if (!active) return;
    this.active = null;

    if (active.query && this.extension) {
      this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
      this.pendingQueries.push({
        query: active.query,
        label: active.label,
        frameId: active.frameId,
        isTainted: false,
      });
      return;
    }
    this.gl.finish();
    const elapsedMs = performance.now() - active.startedAtMs;
    this.profiler.recordTimer(
      active.label === FRAME_LABEL ? "gpu.frame.syncEstimate" : `gpu.pass.${active.label}.syncEstimate`,
      elapsedMs,
      "gpu",
    );
  }

  /** Collects every finished query, oldest first. Call once per frame. */
  poll() {
    if (!this.extension || this.pendingQueries.length === 0) return;

    if (this.gl.getParameter(this.extension.GPU_DISJOINT_EXT)) {
      this.pendingQueries.forEach((pending) => (pending.isTainted = true));
      this.profiler.addCounter("gpu.timer.disjointEvents");
    }

    while (this.pendingQueries.length > 0) {
      const pending = this.pendingQueries[0];
      if (!this.gl.getQueryParameter(pending.query, this.gl.QUERY_RESULT_AVAILABLE)) break;
      this.pendingQueries.shift();

      if (pending.isTainted) {
        this.incompleteFrames.add(pending.frameId);
        this.profiler.addCounter("gpu.timer.discardedDisjoint");
      } else {
        const nanoseconds = this.gl.getQueryParameter(pending.query, this.gl.QUERY_RESULT) as number;
        this.routeResult(pending.label, pending.frameId, nanoseconds / NANOSECONDS_PER_MILLISECOND);
      }
      this.freeQueries.push(pending.query);
    }
    this.attachCompletedFrames();
  }

  dispose() {
    this.pendingQueries.forEach((pending) => this.gl.deleteQuery(pending.query));
    this.freeQueries.forEach((query) => this.gl.deleteQuery(query));
    if (this.active?.query) this.gl.deleteQuery(this.active.query);
    this.pendingQueries = [];
    this.freeQueries = [];
    this.active = null;
    this.partialFrameTotals.clear();
    this.incompleteFrames.clear();
  }

  private routeResult(label: string, frameId: number, milliseconds: number) {
    if (label === FRAME_LABEL) {
      this.profiler.attachGpuFrameTime(frameId, milliseconds);
      this.profiler.recordTimer("gpu.frame", milliseconds, "gpu");
      return;
    }
    this.profiler.recordTimer(`gpu.pass.${label}`, milliseconds, "gpu");
    this.partialFrameTotals.set(
      frameId,
      (this.partialFrameTotals.get(frameId) ?? 0) + milliseconds,
    );
  }

  /** A frame's pass total is final once none of its queries are still pending. */
  private attachCompletedFrames() {
    if (this.incompleteFrames.size > MAX_TRACKED_INCOMPLETE_FRAMES) this.incompleteFrames.clear();
    for (const [frameId, totalMilliseconds] of this.partialFrameTotals) {
      const hasPendingParts = this.pendingQueries.some((pending) => pending.frameId === frameId);
      if (hasPendingParts || this.active?.frameId === frameId) continue;
      this.partialFrameTotals.delete(frameId);
      if (this.incompleteFrames.delete(frameId)) continue;
      this.profiler.attachGpuFrameTime(frameId, totalMilliseconds);
      this.profiler.recordTimer("gpu.frame", totalMilliseconds, "gpu");
    }
  }
}
