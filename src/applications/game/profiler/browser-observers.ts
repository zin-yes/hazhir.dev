import type { Profiler } from "./profiler";

const EVENT_LOOP_PROBE_INTERVAL_MS = 50;
const EVENT_LOOP_LAG_THRESHOLD_MS = 10;
const GC_HEAP_DROP_THRESHOLD_BYTES = 1024 * 1024;
const CLONE_SIZES_BYTES = [32 * 1024, 1024 * 1024];
const CLONE_REPETITIONS = 6;
const CLONES_PER_REPETITION = 12;
const MAX_SCRIPT_ATTRIBUTIONS = 3;

export interface HeapChange {
  isGcLikely: boolean;
  allocatedBytes: number;
  freedBytes: number;
}

/**
 * Compares two heap readings. A large drop is read as a garbage collection;
 * growth counts as allocation. Chrome quantizes performance.memory values
 * (and jitters them unless started with precise memory info), and the
 * allocation done between a growth and the next collection is invisible, so
 * both figures are estimates that undercount.
 */
export function describeHeapChange(
  previousHeapBytes: number,
  currentHeapBytes: number,
  dropThresholdBytes = GC_HEAP_DROP_THRESHOLD_BYTES,
): HeapChange {
  const delta = currentHeapBytes - previousHeapBytes;
  if (delta < -dropThresholdBytes) {
    return { isGcLikely: true, allocatedBytes: 0, freedBytes: -delta };
  }
  return { isGcLikely: false, allocatedBytes: Math.max(0, delta), freedBytes: 0 };
}

interface ScriptAttribution {
  sourceURL?: string;
  invoker?: string;
  sourceFunctionName?: string;
  duration?: number;
  forcedStyleAndLayoutDuration?: number;
}

interface LongAnimationFrameEntry {
  duration: number;
  blockingDuration?: number;
  scripts?: ScriptAttribution[];
}

export function describeLongAnimationFrame(entry: LongAnimationFrameEntry): string {
  const scripts = [...(entry.scripts ?? [])]
    .sort((first, second) => (second.duration ?? 0) - (first.duration ?? 0))
    .slice(0, MAX_SCRIPT_ATTRIBUTIONS)
    .map((script) => {
      const caller = script.invoker || script.sourceFunctionName || "anonymous";
      const source = (script.sourceURL ?? "").split("/").slice(-2).join("/");
      const forced = script.forcedStyleAndLayoutDuration
        ? ` forcedStyleLayout=${script.forcedStyleAndLayoutDuration.toFixed(1)}ms`
        : "";
      return `${caller} ${source} ${(script.duration ?? 0).toFixed(1)}ms${forced}`;
    });
  const blocking =
    entry.blockingDuration === undefined ? "" : `blocking=${entry.blockingDuration.toFixed(1)}ms `;
  return `${blocking}${scripts.join(" | ")}`.trim() || "no script attribution";
}

function observeEntryType(
  entryType: string,
  onEntries: (entries: PerformanceEntryList) => void,
): PerformanceObserver | null {
  if (typeof PerformanceObserver === "undefined") return null;
  if (!PerformanceObserver.supportedEntryTypes?.includes(entryType)) return null;
  const observer = new PerformanceObserver((list) => onEntries(list.getEntries()));
  observer.observe({ type: entryType });
  return observer;
}

function installEventLoopLagMonitor(profiler: Profiler): () => void {
  let expectedAtMs = performance.now() + EVENT_LOOP_PROBE_INTERVAL_MS;
  const timer = setInterval(() => {
    const now = performance.now();
    const latenessMs = now - expectedAtMs;
    expectedAtMs = now + EVENT_LOOP_PROBE_INTERVAL_MS;
    const isTabHidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    if (!profiler.enabled || isTabHidden || latenessMs <= EVENT_LOOP_LAG_THRESHOLD_MS) return;
    profiler.recordTimer("browser.eventLoopLag", latenessMs, "browser");
    profiler.logEvent("event-loop-lag", latenessMs, "main thread was busy when a 50ms timer was due");
  }, EVENT_LOOP_PROBE_INTERVAL_MS);
  return () => clearInterval(timer);
}

function installHeapSampler(profiler: Profiler): () => void {
  let previousHeapBytes: number | null = null;
  return profiler.addSampler(() => {
    const memory = (performance as unknown as {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
    }).memory;
    if (!memory) return;
    profiler.sampleGauge("memory.jsHeapUsedBytes", memory.usedJSHeapSize, "bytes");
    profiler.sampleGauge("memory.jsHeapTotalBytes", memory.totalJSHeapSize, "bytes");

    if (previousHeapBytes !== null) {
      const change = describeHeapChange(previousHeapBytes, memory.usedJSHeapSize);
      if (change.isGcLikely) {
        profiler.addCounter("memory.gcEstimates");
        profiler.logEvent(
          "gc-estimate",
          0,
          `heap dropped ${(change.freedBytes / 1048576).toFixed(1)} MB between samples`,
        );
      }
      if (change.allocatedBytes > 0) {
        profiler.addCounter("memory.allocatedBytesEstimate", change.allocatedBytes, "bytes");
      }
    }
    previousHeapBytes = memory.usedJSHeapSize;
  });
}

/** Measures structuredClone throughput, the cost model for postMessage payloads. */
export function calibrateStructuredClone(profiler: Profiler) {
  if (typeof structuredClone === "undefined") return;
  let clonedBytes = 0;
  let elapsedMs = 0;
  for (let repetition = 0; repetition <= CLONE_REPETITIONS; repetition++) {
    for (const size of CLONE_SIZES_BYTES) {
      const buffer = new ArrayBuffer(size);
      const startedAtMs = performance.now();
      for (let clone = 0; clone < CLONES_PER_REPETITION; clone++) structuredClone(buffer);
      const repetitionMs = performance.now() - startedAtMs;
      const isWarmUpRepetition = repetition === 0;
      if (isWarmUpRepetition) continue;
      elapsedMs += repetitionMs;
      clonedBytes += size * CLONES_PER_REPETITION;
    }
  }
  if (elapsedMs <= 0) return;
  profiler.setSessionInfo({
    structuredCloneMegabytesPerSecond: clonedBytes / 1048576 / (elapsedMs / 1000),
  });
}

/**
 * Installs the browser-side observers (long tasks, long animation frames,
 * event-loop lag, heap sampling) and calibrates structuredClone speed the
 * first time the profiler is enabled. Everything records only while enabled.
 */
export function installBrowserObservers(profiler: Profiler): () => void {
  const observers: (PerformanceObserver | null)[] = [
    observeEntryType("longtask", (entries) => {
      if (!profiler.enabled) return;
      for (const entry of entries) {
        profiler.recordTimer("browser.longTask", entry.duration, "browser");
        profiler.logEvent("long-task", entry.duration, `long task starting at ${entry.startTime.toFixed(0)}ms`);
      }
    }),
    observeEntryType("long-animation-frame", (entries) => {
      if (!profiler.enabled) return;
      for (const entry of entries) {
        profiler.recordTimer("browser.longAnimationFrame", entry.duration, "browser");
        profiler.logEvent(
          "long-animation-frame",
          entry.duration,
          describeLongAnimationFrame(entry as unknown as LongAnimationFrameEntry),
        );
      }
    }),
  ];
  const stopEventLoopMonitor = installEventLoopLagMonitor(profiler);
  const stopHeapSampler = installHeapSampler(profiler);

  let hasCalibrated = false;
  const calibrateOnce = () => {
    if (hasCalibrated) return;
    hasCalibrated = true;
    calibrateStructuredClone(profiler);
  };
  if (profiler.enabled) setTimeout(calibrateOnce, 0);
  const stopListening = profiler.onEnabledChange((enabled) => {
    if (enabled) setTimeout(calibrateOnce, 0);
  });

  return () => {
    observers.forEach((observer) => observer?.disconnect());
    stopEventLoopMonitor();
    stopHeapSampler();
    stopListening();
  };
}
