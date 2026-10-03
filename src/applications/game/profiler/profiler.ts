import { MeshRegistry } from "./mesh-aggregate";
import { RollingStat } from "./rolling-stat";
import {
  PROFILE_SCHEMA_VERSION,
  type BrowserEvent,
  type ByteSummary,
  type CounterSummary,
  type FrameNotes,
  type FrameSummary,
  type GaugeSummary,
  type MeshGeometryStats,
  type MetricDomain,
  type ProfileSnapshot,
  type SessionInfo,
  type TimerSummary,
  type WorkerPoolSummary,
  type WorstFrame,
} from "./types";

const RECENT_FRAME_CAPACITY = 240;
const WORST_FRAME_CAPACITY = 20;
const WORST_FRAME_MIN_INTERVAL_MS = 20;
const WORST_FRAME_SCOPE_COUNT = 10;
const EVENT_CAPACITY = 200;
const GAUGE_HISTORY_CAPACITY = 120;
const SAMPLER_INTERVAL_MS = 1000;
const MAX_STACK_DEPTH = 64;

interface TimerEntry {
  name: string;
  domain: MetricDomain;
  stat: RollingStat;
  selfTotal: number;
  parent: string | null;
}

interface CounterEntry {
  unit: string;
  total: number;
  stat: RollingStat;
}

interface GaugeEntry {
  unit: string;
  last: number;
  min: number;
  max: number;
  total: number;
  samples: number;
  history: number[];
}

interface PoolEntry {
  workerCount: number;
  tasksCompleted: number;
  tasksFailed: number;
  busyStat: RollingStat;
}

export type ProfilerClock = () => number;

/**
 * Main-thread profiler. Every recording method is a cheap early return while
 * the profiler is disabled, so instrumentation can stay in production code.
 *
 * Scopes (begin/end/measure) are synchronous and nest on a stack so every
 * scope gets inclusive and self time. For asynchronous pipelines record a
 * "latency" timer with recordTimer instead.
 */
export class Profiler {
  enabled = false;

  private readonly clock: ProfilerClock;
  private startedAtMs = 0;
  private label = "session";

  private timers = new Map<string, TimerEntry>();
  private byteMeters = new Map<string, RollingStat>();
  private counters = new Map<string, CounterEntry>();
  private gauges = new Map<string, GaugeEntry>();
  private pools = new Map<string, PoolEntry>();
  private events: BrowserEvent[] = [];
  private session: Partial<SessionInfo> & { game: { [key: string]: number | string } } = {
    game: {},
  };
  private readonly meshes = new MeshRegistry();

  private stackNames: string[] = new Array(MAX_STACK_DEPTH);
  private stackStartedAtMs = new Float64Array(MAX_STACK_DEPTH);
  private stackChildMs = new Float64Array(MAX_STACK_DEPTH);
  private depth = 0;

  private frameId = 0;
  private lastFrameBeginMs: number | null = null;
  private frameCallbackStartedAtMs = 0;
  private frameSelfMs = new Map<string, number>();
  private frameNotes: FrameNotes = {};
  private frameIntervalStat = new RollingStat();
  private frameBusyStat = new RollingStat();
  private frameGpuStat = new RollingStat();
  private framesOver16Point7Ms = 0;
  private framesOver33Ms = 0;
  private framesOver50Ms = 0;
  private recentFrameIds = new Int32Array(RECENT_FRAME_CAPACITY).fill(-1);
  private recentIntervals = new Float32Array(RECENT_FRAME_CAPACITY);
  private recentBusy = new Float32Array(RECENT_FRAME_CAPACITY);
  private recentGpu = new Float32Array(RECENT_FRAME_CAPACITY).fill(Number.NaN);
  private worstFrames: WorstFrame[] = [];

  private enabledListeners = new Set<(enabled: boolean) => void>();
  private samplers = new Set<() => void>();
  private samplerTimer: ReturnType<typeof setInterval> | null = null;

  constructor(clock: ProfilerClock = () => performance.now()) {
    this.clock = clock;
  }

  now(): number {
    return this.clock();
  }

  // ---------------------------------------------------------------- lifecycle

  setEnabled(enabled: boolean) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.startedAtMs = this.clock();
      this.startSamplers();
    } else {
      this.stopSamplers();
      this.depth = 0;
    }
    this.enabledListeners.forEach((listener) => listener(enabled));
  }

  onEnabledChange(listener: (enabled: boolean) => void): () => void {
    this.enabledListeners.add(listener);
    return () => this.enabledListeners.delete(listener);
  }

  /** Registers a callback that runs about once per second while enabled. */
  addSampler(sampler: () => void): () => void {
    this.samplers.add(sampler);
    return () => this.samplers.delete(sampler);
  }

  /** Clears all measurements but keeps session info and registered pools. */
  reset(label = "session") {
    this.label = label;
    this.startedAtMs = this.clock();
    this.timers.clear();
    this.byteMeters.clear();
    this.counters.clear();
    this.gauges.clear();
    this.events = [];
    this.meshes.reset();
    this.pools.forEach((pool) => {
      pool.tasksCompleted = 0;
      pool.tasksFailed = 0;
      pool.busyStat = new RollingStat();
    });
    this.depth = 0;
    this.frameId = 0;
    this.lastFrameBeginMs = null;
    this.frameSelfMs.clear();
    this.frameNotes = {};
    this.frameIntervalStat = new RollingStat();
    this.frameBusyStat = new RollingStat();
    this.frameGpuStat = new RollingStat();
    this.framesOver16Point7Ms = 0;
    this.framesOver33Ms = 0;
    this.framesOver50Ms = 0;
    this.recentFrameIds.fill(-1);
    this.recentGpu.fill(Number.NaN);
    this.worstFrames = [];
  }

  // ------------------------------------------------------------------- scopes

  /** Starts a synchronous main-thread scope. Returns a token for end(). */
  begin(name: string): number {
    if (!this.enabled || this.depth >= MAX_STACK_DEPTH) return 0;
    const slot = this.depth++;
    this.stackNames[slot] = name;
    this.stackStartedAtMs[slot] = this.clock();
    this.stackChildMs[slot] = 0;
    return this.depth;
  }

  end(token: number) {
    if (token === 0 || token > this.depth) return;
    const now = this.clock();
    while (this.depth > token) this.closeTopScope(now);
    this.closeTopScope(now);
  }

  measure<Result>(name: string, run: () => Result): Result {
    if (!this.enabled) return run();
    const token = this.begin(name);
    try {
      return run();
    } finally {
      this.end(token);
    }
  }

  /** Times a promise's wall-clock duration as a latency timer (not CPU time). */
  async measureAsync<Result>(
    name: string,
    run: () => Promise<Result>,
    domain: MetricDomain = "latency",
  ): Promise<Result> {
    if (!this.enabled) return run();
    const startedAtMs = this.clock();
    try {
      return await run();
    } finally {
      this.recordTimer(name, this.clock() - startedAtMs, domain);
    }
  }

  /**
   * Records a duration measured elsewhere (a worker, a GPU query, a browser
   * observer). Does not interact with the main-thread scope stack.
   */
  recordTimer(name: string, durationMs: number, domain: MetricDomain) {
    if (!this.enabled) return;
    const entry = this.getTimer(name, domain);
    entry.stat.add(durationMs, this.clock());
    entry.selfTotal += durationMs;
  }

  /**
   * Records main-thread CPU time measured elsewhere (for example React's
   * commit duration) and credits it to the enclosing scope and the current
   * frame interval so nothing is counted twice.
   */
  recordMainThreadTimer(name: string, durationMs: number, domain: MetricDomain = "main-cpu") {
    if (!this.enabled) return;
    const entry = this.getTimer(name, domain);
    entry.stat.add(durationMs, this.clock());
    entry.selfTotal += durationMs;
    if (this.depth > 0) {
      entry.parent = this.stackNames[this.depth - 1];
      this.stackChildMs[this.depth - 1] += durationMs;
    }
    this.addFrameSelf(name, durationMs);
  }

  // ------------------------------------------------- counters, gauges, bytes

  addCounter(name: string, amount = 1, unit = "count") {
    if (!this.enabled) return;
    let entry = this.counters.get(name);
    if (!entry) {
      entry = { unit, total: 0, stat: new RollingStat(1) };
      this.counters.set(name, entry);
    }
    entry.total += amount;
    entry.stat.add(amount, this.clock());
  }

  sampleGauge(name: string, value: number, unit = "count") {
    if (!this.enabled) return;
    let entry = this.gauges.get(name);
    if (!entry) {
      entry = {
        unit,
        last: value,
        min: value,
        max: value,
        total: 0,
        samples: 0,
        history: [],
      };
      this.gauges.set(name, entry);
    }
    entry.last = value;
    entry.min = Math.min(entry.min, value);
    entry.max = Math.max(entry.max, value);
    entry.total += value;
    entry.samples++;
    entry.history.push(value);
    if (entry.history.length > GAUGE_HISTORY_CAPACITY) entry.history.shift();
  }

  /** Records the size of one message / upload / buffer in bytes. */
  recordBytes(name: string, bytes: number) {
    if (!this.enabled) return;
    let meter = this.byteMeters.get(name);
    if (!meter) {
      meter = new RollingStat();
      this.byteMeters.set(name, meter);
    }
    meter.add(bytes, this.clock());
  }

  getGaugeLast(name: string): number | null {
    return this.gauges.get(name)?.last ?? null;
  }

  // ------------------------------------------------------------------- frames

  get currentFrameId(): number {
    return this.frameId;
  }

  /** Call first thing in the render callback. */
  beginFrame() {
    if (!this.enabled) return;
    const now = this.clock();
    if (this.depth > 0) {
      this.addCounter("profiler.leakedScopes", this.depth);
      while (this.depth > 0) this.closeTopScope(now);
    }
    if (this.lastFrameBeginMs !== null) this.closeFrameInterval(now);
    this.frameId++;
    this.lastFrameBeginMs = now;
    this.frameCallbackStartedAtMs = now;
  }

  /** Call last thing in the render callback. */
  endFrame() {
    if (!this.enabled || this.lastFrameBeginMs === null) return;
    const now = this.clock();
    this.getTimer("main.frame.callback", "main-cpu").stat.add(
      now - this.frameCallbackStartedAtMs,
      now,
    );
  }

  /** Attaches a per-frame fact (draw calls, upload bytes) to the current frame. */
  noteFrame(key: string, value: number) {
    if (!this.enabled) return;
    this.frameNotes[key] = (this.frameNotes[key] ?? 0) + value;
  }

  /** GPU time arrives asynchronously, a few frames after the frame was drawn. */
  attachGpuFrameTime(frameId: number, gpuMs: number) {
    if (!this.enabled) return;
    this.frameGpuStat.add(gpuMs, this.clock());
    const slot = frameId % RECENT_FRAME_CAPACITY;
    if (this.recentFrameIds[slot] === frameId) this.recentGpu[slot] = gpuMs;
    const worst = this.worstFrames.find((frame) => frame.frameId === frameId);
    if (worst) worst.gpuMs = gpuMs;
  }

  // ------------------------------------------------------------------- meshes

  recordMesh(chunkName: string, stats: MeshGeometryStats) {
    if (!this.enabled) return;
    this.meshes.record(chunkName, stats, this.clock());
  }

  removeMesh(chunkName: string) {
    this.meshes.remove(chunkName);
  }

  clearMeshes() {
    this.meshes.clearLive();
  }

  // ------------------------------------------------------------ events, pools

  logEvent(kind: BrowserEvent["kind"], durationMs: number, detail: string) {
    if (!this.enabled) return;
    this.events.push({
      kind,
      atMs: this.clock() - this.startedAtMs,
      durationMs,
      detail,
    });
    if (this.events.length > EVENT_CAPACITY) this.events.shift();
  }

  registerWorkerPool(name: string, workerCount: number) {
    const existing = this.pools.get(name);
    if (existing) {
      existing.workerCount = workerCount;
      return;
    }
    this.pools.set(name, {
      workerCount,
      tasksCompleted: 0,
      tasksFailed: 0,
      busyStat: new RollingStat(),
    });
  }

  recordPoolTask(poolName: string, executionMs: number, failed: boolean) {
    if (!this.enabled) return;
    const pool = this.pools.get(poolName);
    if (!pool) return;
    if (failed) pool.tasksFailed++;
    else pool.tasksCompleted++;
    pool.busyStat.add(executionMs, this.clock());
  }

  setSessionInfo(info: Partial<Omit<SessionInfo, "game">> & { game?: SessionInfo["game"] }) {
    const { game, ...rest } = info;
    Object.assign(this.session, rest);
    if (game) Object.assign(this.session.game, game);
  }

  // ----------------------------------------------------------------- snapshot

  snapshot(label?: string): ProfileSnapshot {
    const now = this.clock();
    return {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      capturedAtIso: new Date().toISOString(),
      label: label ?? this.label,
      profiledForMs: Math.max(0, now - this.startedAtMs),
      session: this.buildSessionInfo(),
      frames: this.buildFrameSummary(now),
      timers: this.buildTimerSummaries(now),
      bytes: this.buildByteSummaries(now),
      counters: this.buildCounterSummaries(now),
      gauges: this.buildGaugeSummaries(),
      workerPools: this.buildPoolSummaries(now),
      meshes: this.meshes.summary(now),
      events: [...this.events],
    };
  }

  // ---------------------------------------------------------------- internals

  private closeTopScope(now: number) {
    const slot = this.depth - 1;
    const name = this.stackNames[slot];
    const durationMs = now - this.stackStartedAtMs[slot];
    const selfMs = Math.max(0, durationMs - this.stackChildMs[slot]);
    this.depth--;

    const entry = this.getTimer(name, "main-cpu");
    entry.stat.add(durationMs, now);
    entry.selfTotal += selfMs;
    if (slot > 0) {
      entry.parent = this.stackNames[slot - 1];
      this.stackChildMs[slot - 1] += durationMs;
    }
    this.addFrameSelf(name, selfMs);
  }

  private getTimer(name: string, domain: MetricDomain): TimerEntry {
    let entry = this.timers.get(name);
    if (!entry) {
      entry = { name, domain, stat: new RollingStat(), selfTotal: 0, parent: null };
      this.timers.set(name, entry);
    }
    return entry;
  }

  private addFrameSelf(name: string, selfMs: number) {
    this.frameSelfMs.set(name, (this.frameSelfMs.get(name) ?? 0) + selfMs);
  }

  private closeFrameInterval(now: number) {
    const intervalMs = now - (this.lastFrameBeginMs as number);
    let busyMs = 0;
    this.frameSelfMs.forEach((selfMs) => (busyMs += selfMs));

    this.frameIntervalStat.add(intervalMs, now);
    this.frameBusyStat.add(busyMs, now);
    if (intervalMs > 16.7) this.framesOver16Point7Ms++;
    if (intervalMs > 33) this.framesOver33Ms++;
    if (intervalMs > 50) this.framesOver50Ms++;

    const slot = this.frameId % RECENT_FRAME_CAPACITY;
    this.recentFrameIds[slot] = this.frameId;
    this.recentIntervals[slot] = intervalMs;
    this.recentBusy[slot] = busyMs;
    this.recentGpu[slot] = Number.NaN;

    if (intervalMs >= WORST_FRAME_MIN_INTERVAL_MS) {
      this.considerWorstFrame(intervalMs, busyMs, now);
    }
    this.frameSelfMs.clear();
    this.frameNotes = {};
  }

  private considerWorstFrame(intervalMs: number, busyMs: number, now: number) {
    const isFull = this.worstFrames.length >= WORST_FRAME_CAPACITY;
    const smallestKept = this.worstFrames[this.worstFrames.length - 1];
    if (isFull && intervalMs <= smallestKept.intervalMs) return;

    const topScopes = Array.from(this.frameSelfMs.entries())
      .map(([name, selfMs]) => ({ name, selfMs }))
      .sort((first, second) => second.selfMs - first.selfMs)
      .slice(0, WORST_FRAME_SCOPE_COUNT);

    this.worstFrames.push({
      frameId: this.frameId,
      atMs: now - this.startedAtMs,
      intervalMs,
      busyMs,
      unattributedMs: Math.max(0, intervalMs - busyMs),
      gpuMs: null,
      topScopes,
      notes: { ...this.frameNotes },
    });
    this.worstFrames.sort((first, second) => second.intervalMs - first.intervalMs);
    if (this.worstFrames.length > WORST_FRAME_CAPACITY) this.worstFrames.pop();
  }

  private startSamplers() {
    if (this.samplerTimer !== null || typeof setInterval === "undefined") return;
    this.samplerTimer = setInterval(() => {
      this.samplers.forEach((sampler) => sampler());
    }, SAMPLER_INTERVAL_MS);
  }

  private stopSamplers() {
    if (this.samplerTimer === null) return;
    clearInterval(this.samplerTimer);
    this.samplerTimer = null;
  }

  private buildSessionInfo(): SessionInfo {
    const hasWindow = typeof window !== "undefined";
    return {
      userAgent: typeof navigator === "undefined" ? "unknown" : navigator.userAgent,
      devicePixelRatio: hasWindow ? window.devicePixelRatio : 1,
      viewport: hasWindow
        ? { width: window.innerWidth, height: window.innerHeight }
        : { width: 0, height: 0 },
      hardwareConcurrency:
        typeof navigator === "undefined" ? 0 : navigator.hardwareConcurrency,
      crossOriginIsolated: hasWindow ? window.crossOriginIsolated === true : false,
      gpuRenderer: null,
      gpuVendor: null,
      gpuTimerSupported: false,
      gpuTimerMode: "none",
      gpuPassBreakdownEnabled: false,
      structuredCloneMegabytesPerSecond: null,
      timerResolutionNote:
        "performance.now() is clamped by the browser (about 100 microseconds, 5 when cross-origin isolated); sub-0.1ms scopes are only meaningful as aggregates.",
      ...this.session,
      game: { ...this.session.game },
    };
  }

  private buildFrameSummary(now: number): FrameSummary {
    const recent: { id: number; interval: number; busy: number; gpu: number }[] = [];
    for (let slot = 0; slot < RECENT_FRAME_CAPACITY; slot++) {
      if (this.recentFrameIds[slot] >= 0) {
        recent.push({
          id: this.recentFrameIds[slot],
          interval: this.recentIntervals[slot],
          busy: this.recentBusy[slot],
          gpu: this.recentGpu[slot],
        });
      }
    }
    recent.sort((first, second) => first.id - second.id);

    return {
      count: this.frameIntervalStat.count,
      intervalMs: this.frameIntervalStat.summary(now),
      busyMs: this.frameBusyStat.summary(now),
      gpuMs: this.frameGpuStat.summary(now),
      framesOver16Point7Ms: this.framesOver16Point7Ms,
      framesOver33Ms: this.framesOver33Ms,
      framesOver50Ms: this.framesOver50Ms,
      recentIntervalsMs: recent.map((frame) => frame.interval),
      recentBusyMs: recent.map((frame) => frame.busy),
      recentGpuMs: recent.map((frame) => (Number.isNaN(frame.gpu) ? null : frame.gpu)),
      worst: this.worstFrames.map((frame) => ({ ...frame })),
    };
  }

  private buildTimerSummaries(now: number): TimerSummary[] {
    return Array.from(this.timers.values()).map((entry) => ({
      ...entry.stat.summary(now),
      name: entry.name,
      domain: entry.domain,
      unit: "ms" as const,
      selfTotal: entry.selfTotal,
      parent: entry.parent,
    }));
  }

  private buildByteSummaries(now: number): ByteSummary[] {
    return Array.from(this.byteMeters.entries()).map(([name, meter]) => ({
      ...meter.summary(now),
      name,
      unit: "bytes" as const,
    }));
  }

  private buildCounterSummaries(now: number): CounterSummary[] {
    return Array.from(this.counters.entries()).map(([name, entry]) => ({
      name,
      unit: entry.unit,
      total: entry.total,
      recentPerSecond: entry.stat.summary(now).recentPerSecondTotal,
    }));
  }

  private buildGaugeSummaries(): GaugeSummary[] {
    return Array.from(this.gauges.entries()).map(([name, entry]) => ({
      name,
      unit: entry.unit,
      last: entry.last,
      min: entry.min,
      max: entry.max,
      mean: entry.samples === 0 ? 0 : entry.total / entry.samples,
      samples: entry.samples,
      history: [...entry.history],
    }));
  }

  private buildPoolSummaries(now: number): WorkerPoolSummary[] {
    const gauges = this.buildGaugeSummaries();
    return Array.from(this.pools.entries()).map(([name, pool]) => {
      const busyMillisecondsPerSecond = pool.busyStat.summary(now).recentPerSecondTotal;
      return {
        name,
        workerCount: pool.workerCount,
        tasksCompleted: pool.tasksCompleted,
        tasksFailed: pool.tasksFailed,
        busyMillisecondsPerSecond,
        utilization: Math.min(1, busyMillisecondsPerSecond / (pool.workerCount * 1000)),
        queueDepth: gauges.find((gauge) => gauge.name === `pool.${name}.queueDepth`) ?? null,
      };
    });
  }
}
