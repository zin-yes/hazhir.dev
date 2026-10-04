/**
 * Sampling profiler built on the browser JS Self-Profiling API (`window.Profiler`).
 *
 * - Chromium only (Chrome, Edge); Firefox and Safari do not implement it.
 * - Main thread and window only: the API is not available inside workers, so
 *   worker CPU is covered by the instrumented sections, not by sampling.
 * - Needs the response header `Document-Policy: js-profiling` (next.config.mjs
 *   sends it in development). Without it the constructor throws NotAllowedError.
 */

import type { SamplingSummary } from "./types";

export interface JsSelfProfilingFrame {
  name?: string;
  resourceId?: number;
  line?: number;
  column?: number;
}

export interface JsSelfProfilingStack {
  frameId: number;
  parentId?: number;
}

export interface JsSelfProfilingSample {
  timestamp: number;
  /** Absent when the thread was idle at the sample. */
  stackId?: number;
}

export interface JsSelfProfilingTrace {
  resources: string[];
  frames: JsSelfProfilingFrame[];
  stacks: JsSelfProfilingStack[];
  samples: JsSelfProfilingSample[];
}

export interface InclusiveFunctionEntry {
  functionName: string;
  resource: string;
  line: number;
  /** Samples whose stack contains the function at least once. */
  samples: number;
  inclusiveMs: number;
}

export interface SamplingAggregate extends SamplingSummary {
  /** Samples taken while the thread was idle; excluded from totalSamples. */
  idleSamples: number;
  topInclusive: InclusiveFunctionEntry[];
}

interface BrowserProfilerInstance {
  readonly sampleInterval: number;
  stop(): Promise<JsSelfProfilingTrace>;
  addEventListener(type: "samplebufferfull", listener: () => void): void;
}

type BrowserProfilerConstructor = new (options: {
  sampleInterval: number;
  maxBufferSize: number;
}) => BrowserProfilerInstance;

export const ANONYMOUS_FUNCTION_NAME = "(anonymous)";
export const TOP_SELF_LIMIT = 25;
export const TOP_STACKS_LIMIT = 10;
export const TOP_INCLUSIVE_LIMIT = 25;
export const MAX_STACK_FRAMES_KEPT = 40;
export const TRUNCATED_STACK_MARKER = "(truncated)";
export const DEFAULT_MAX_BUFFER_SAMPLES = 20000;
const LARGEST_RETRY_INTERVAL_MS = 64;

interface FunctionTally {
  functionName: string;
  resource: string;
  line: number;
  selfSamples: number;
  inclusiveSamples: number;
}

function describeResourceBasename(resource: string): string {
  const withoutQuery = resource.split(/[?#]/)[0] ?? "";
  const lastSegment = withoutQuery.split("/").pop() ?? "";
  return lastSegment;
}

function describeFrameForStack(functionName: string, resource: string, line: number): string {
  const location = describeResourceBasename(resource);
  return location ? `${functionName} (${location}:${line})` : functionName;
}

/** Accumulates one or more API traces so aggregates survive profiler restarts. */
export class SampleAggregator {
  private readonly tallyByFunctionKey = new Map<string, FunctionTally>();
  private readonly samplesByStackKey = new Map<string, { frames: string[]; samples: number }>();
  private busySamples = 0;
  private idleSamples = 0;
  private durationMs = 0;
  private sampleIntervalMs = 0;

  addTrace(trace: JsSelfProfilingTrace, sampleIntervalMs: number) {
    if (trace.samples.length === 0) return;
    this.sampleIntervalMs = sampleIntervalMs;

    const samplesByStackId = new Map<number, number>();
    for (const sample of trace.samples) {
      if (sample.stackId === undefined) {
        this.idleSamples += 1;
        continue;
      }
      this.busySamples += 1;
      samplesByStackId.set(sample.stackId, (samplesByStackId.get(sample.stackId) ?? 0) + 1);
    }

    const functionKeyByFrameId = new Map<number, string>();
    const resolveFunctionKey = (frameId: number): string | null => {
      const cached = functionKeyByFrameId.get(frameId);
      if (cached !== undefined) return cached;
      const frame = trace.frames[frameId];
      if (!frame) return null;
      const functionName = frame.name ? frame.name : ANONYMOUS_FUNCTION_NAME;
      const resource = frame.resourceId === undefined ? "" : (trace.resources[frame.resourceId] ?? "");
      const line = frame.line ?? 0;
      const functionKey = `${functionName}\u0000${resource}\u0000${line}`;
      if (!this.tallyByFunctionKey.has(functionKey)) {
        this.tallyByFunctionKey.set(functionKey, {
          functionName,
          resource,
          line,
          selfSamples: 0,
          inclusiveSamples: 0,
        });
      }
      functionKeyByFrameId.set(frameId, functionKey);
      return functionKey;
    };

    for (const [leafStackId, sampleCount] of samplesByStackId) {
      const functionKeysLeafFirst = this.collectFunctionKeysLeafFirst(
        trace,
        leafStackId,
        resolveFunctionKey,
      );
      if (functionKeysLeafFirst.length === 0) continue;

      const leafTally = this.tallyByFunctionKey.get(functionKeysLeafFirst[0]!)!;
      leafTally.selfSamples += sampleCount;

      for (const functionKey of new Set(functionKeysLeafFirst)) {
        this.tallyByFunctionKey.get(functionKey)!.inclusiveSamples += sampleCount;
      }

      this.addStackSamples(functionKeysLeafFirst, sampleCount);
    }

    const firstTimestamp = trace.samples[0]!.timestamp;
    const lastTimestamp = trace.samples[trace.samples.length - 1]!.timestamp;
    this.durationMs += Math.max(0, lastTimestamp - firstTimestamp) + sampleIntervalMs;
  }

  hasSamples(): boolean {
    return this.busySamples > 0;
  }

  toAggregate(): SamplingAggregate {
    const intervalMs = this.sampleIntervalMs;
    const tallies = [...this.tallyByFunctionKey.values()];
    const byNameThenLocation = (
      left: { functionName: string; resource: string; line: number },
      right: { functionName: string; resource: string; line: number },
    ) =>
      left.functionName.localeCompare(right.functionName) ||
      left.resource.localeCompare(right.resource) ||
      left.line - right.line;

    const topSelf = tallies
      .filter((tally) => tally.selfSamples > 0)
      .sort((left, right) => right.selfSamples - left.selfSamples || byNameThenLocation(left, right))
      .slice(0, TOP_SELF_LIMIT)
      .map((tally) => ({
        functionName: tally.functionName,
        resource: tally.resource,
        line: tally.line,
        samples: tally.selfSamples,
        selfMs: tally.selfSamples * intervalMs,
      }));

    const topInclusive = tallies
      .filter((tally) => tally.inclusiveSamples > 0)
      .sort(
        (left, right) =>
          right.inclusiveSamples - left.inclusiveSamples || byNameThenLocation(left, right),
      )
      .slice(0, TOP_INCLUSIVE_LIMIT)
      .map((tally) => ({
        functionName: tally.functionName,
        resource: tally.resource,
        line: tally.line,
        samples: tally.inclusiveSamples,
        inclusiveMs: tally.inclusiveSamples * intervalMs,
      }));

    const topStacks = [...this.samplesByStackKey.values()]
      .sort((left, right) => right.samples - left.samples)
      .slice(0, TOP_STACKS_LIMIT)
      .map((entry) => ({ frames: [...entry.frames], samples: entry.samples }));

    return {
      sampleIntervalMs: intervalMs,
      totalSamples: this.busySamples,
      idleSamples: this.idleSamples,
      durationMs: this.durationMs,
      topSelf,
      topStacks,
      topInclusive,
    };
  }

  private collectFunctionKeysLeafFirst(
    trace: JsSelfProfilingTrace,
    leafStackId: number,
    resolveFunctionKey: (frameId: number) => string | null,
  ): string[] {
    const functionKeys: string[] = [];
    let currentStackId: number | undefined = leafStackId;
    let remainingSteps = trace.stacks.length;
    while (currentStackId !== undefined && remainingSteps > 0) {
      const stack: JsSelfProfilingStack | undefined = trace.stacks[currentStackId];
      if (!stack) break;
      const functionKey = resolveFunctionKey(stack.frameId);
      if (functionKey !== null) functionKeys.push(functionKey);
      currentStackId = stack.parentId;
      remainingSteps -= 1;
    }
    return functionKeys;
  }

  private addStackSamples(functionKeysLeafFirst: string[], sampleCount: number) {
    const wasTruncated = functionKeysLeafFirst.length > MAX_STACK_FRAMES_KEPT;
    const keptKeysRootFirst = functionKeysLeafFirst.slice(0, MAX_STACK_FRAMES_KEPT).reverse();
    const frames = keptKeysRootFirst.map((functionKey) => {
      const tally = this.tallyByFunctionKey.get(functionKey)!;
      return describeFrameForStack(tally.functionName, tally.resource, tally.line);
    });
    if (wasTruncated) frames.unshift(TRUNCATED_STACK_MARKER);

    const stackKey = frames.join("\n");
    const existing = this.samplesByStackKey.get(stackKey);
    if (existing) existing.samples += sampleCount;
    else this.samplesByStackKey.set(stackKey, { frames, samples: sampleCount });
  }
}

/** Pure: aggregates one API trace into hot functions, hot stacks and inclusive time. */
export function aggregateSamples(
  trace: JsSelfProfilingTrace,
  sampleIntervalMs: number,
): SamplingAggregate {
  const aggregator = new SampleAggregator();
  aggregator.addTrace(trace, sampleIntervalMs);
  const aggregate = aggregator.toAggregate();
  return trace.samples.length === 0 ? { ...aggregate, sampleIntervalMs } : aggregate;
}

function resolveBrowserProfilerConstructor(): BrowserProfilerConstructor | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { Profiler?: BrowserProfilerConstructor }).Profiler;
  return typeof candidate === "function" ? candidate : null;
}

function describeFailure(error: unknown): string {
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "NotAllowedError") {
    return `${name}: ${message} (send the response header "Document-Policy: js-profiling")`;
  }
  return `${name}: ${message}`;
}

export class SamplingProfiler {
  private aggregator = new SampleAggregator();
  private activeProfiler: BrowserProfilerInstance | null = null;
  private wantsSampling = false;
  private requestedIntervalMs = 1;
  private failureReason: string | null = null;
  private operationQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly resolveProfilerConstructor: () => BrowserProfilerConstructor | null = resolveBrowserProfilerConstructor,
    private readonly maxBufferSamples: number = DEFAULT_MAX_BUFFER_SAMPLES,
  ) {}

  isSupported(): boolean {
    return this.resolveProfilerConstructor() !== null;
  }

  isRunning(): boolean {
    return this.wantsSampling;
  }

  /** Why the last start or collection failed, or null. */
  lastFailureReason(): string | null {
    return this.failureReason;
  }

  /** Resolves true when sampling is running. Never rejects. */
  start(sampleIntervalMs = 1): Promise<boolean> {
    return this.enqueue(async () => {
      if (this.wantsSampling) return true;
      if (!this.isSupported()) {
        this.failureReason = "JS Self-Profiling API is not available (Chromium main thread only)";
        return false;
      }
      this.failureReason = null;
      this.requestedIntervalMs = Math.max(1, sampleIntervalMs);
      this.wantsSampling = this.beginProfiler();
      return this.wantsSampling;
    });
  }

  /** Stops sampling and folds the collected samples into the aggregate. */
  stop(): Promise<void> {
    return this.enqueue(async () => {
      this.wantsSampling = false;
      await this.collectActiveProfiler();
    });
  }

  /** Folds samples collected so far into the aggregate; keeps sampling if it was running. */
  flush(): Promise<void> {
    return this.enqueue(async () => {
      await this.collectActiveProfiler();
      this.restartIfWanted();
    });
  }

  /** Drops all collected samples; keeps sampling if it was running. */
  reset(): Promise<void> {
    this.aggregator = new SampleAggregator();
    return this.enqueue(async () => {
      await this.collectActiveProfiler();
      this.aggregator = new SampleAggregator();
      this.restartIfWanted();
    });
  }

  summary(): SamplingAggregate | null {
    return this.aggregator.hasSamples() ? this.aggregator.toAggregate() : null;
  }

  private enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.operationQueue.then(operation);
    this.operationQueue = result.catch(() => undefined);
    return result;
  }

  private beginProfiler(): boolean {
    const ProfilerConstructor = this.resolveProfilerConstructor();
    if (!ProfilerConstructor) return false;

    for (
      let intervalMs = this.requestedIntervalMs;
      intervalMs <= LARGEST_RETRY_INTERVAL_MS;
      intervalMs *= 2
    ) {
      try {
        const profiler = new ProfilerConstructor({
          sampleInterval: intervalMs,
          maxBufferSize: this.maxBufferSamples,
        });
        profiler.addEventListener("samplebufferfull", () => {
          void this.handleBufferFull(profiler);
        });
        this.activeProfiler = profiler;
        return true;
      } catch (error) {
        this.failureReason = describeFailure(error);
        const cannotBeFixedByLargerInterval =
          error instanceof Error && error.name === "NotAllowedError";
        if (cannotBeFixedByLargerInterval) return false;
      }
    }
    return false;
  }

  private restartIfWanted() {
    if (this.wantsSampling && !this.activeProfiler) {
      this.wantsSampling = this.beginProfiler();
    }
  }

  private handleBufferFull(fullProfiler: BrowserProfilerInstance): Promise<void> {
    return this.enqueue(async () => {
      if (this.activeProfiler !== fullProfiler) return;
      await this.collectActiveProfiler();
      this.restartIfWanted();
    });
  }

  private async collectActiveProfiler() {
    const profiler = this.activeProfiler;
    if (!profiler) return;
    this.activeProfiler = null;
    try {
      const trace = await profiler.stop();
      this.aggregator.addTrace(trace, profiler.sampleInterval);
    } catch (error) {
      this.failureReason = describeFailure(error);
    }
  }
}
