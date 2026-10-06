import type { Profiler } from "./profiler";

const EVENT_LOOP_PROBE_INTERVAL_MS = 50;
const EVENT_LOOP_LAG_THRESHOLD_MS = 10;
const GC_HEAP_DROP_THRESHOLD_BYTES = 1024 * 1024;
const CLONE_SIZES_BYTES = [32 * 1024, 1024 * 1024];
const CLONE_REPETITIONS = 6;
const CLONES_PER_REPETITION = 12;
const MAX_SCRIPT_ATTRIBUTIONS = 3;
const SLOW_INPUT_DURATION_THRESHOLD_MS = 16;
const TRACKED_INPUT_EVENT_NAMES = new Set([
  "pointerdown",
  "pointerup",
  "pointermove",
  "mousedown",
  "mouseup",
  "mousemove",
  "click",
  "keydown",
  "keyup",
  "touchstart",
  "touchmove",
  "touchend",
  "wheel",
]);
const TRACKED_RESOURCE_KINDS = new Set(["script", "img", "css", "fetch", "xmlhttprequest", "link", "other"]);

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

export interface InputEventTiming {
  /** Time the event waited for the main thread before its handlers started. */
  inputDelayMs: number;
  /** Time spent inside the event's handlers. */
  processingMs: number;
  /** Time from the end of the handlers to the next paint (rounded by the browser to 8 ms). */
  presentationDelayMs: number;
  /** Event name when it is one the profiler tracks, else "other" (keeps metric names bounded). */
  eventName: string;
}

interface EventTimingEntry {
  name: string;
  startTime: number;
  duration: number;
  processingStart?: number;
  processingEnd?: number;
}

/** Splits an Event Timing entry into where the input latency went. Null when the browser gave no processing times. */
export function describeInputEvent(entry: EventTimingEntry): InputEventTiming | null {
  if (entry.processingStart === undefined || entry.processingEnd === undefined) return null;
  return {
    inputDelayMs: Math.max(0, entry.processingStart - entry.startTime),
    processingMs: Math.max(0, entry.processingEnd - entry.processingStart),
    presentationDelayMs: Math.max(0, entry.startTime + entry.duration - entry.processingEnd),
    eventName: TRACKED_INPUT_EVENT_NAMES.has(entry.name) ? entry.name : "other",
  };
}

interface ResourceTimingEntry {
  initiatorType: string;
  duration: number;
  transferSize?: number;
  decodedBodySize?: number;
}

/** Bounded resource kind for metric names (script, img, fetch, ...). */
export function resourceKindOf(entry: ResourceTimingEntry): string {
  return TRACKED_RESOURCE_KINDS.has(entry.initiatorType) ? entry.initiatorType : "other";
}

function observeEntryType(
  entryType: string,
  onEntries: (entries: PerformanceEntryList) => void,
  extraOptions: { durationThreshold?: number; buffered?: boolean } = {},
): PerformanceObserver | null {
  if (typeof PerformanceObserver === "undefined") return null;
  if (!PerformanceObserver.supportedEntryTypes?.includes(entryType)) return null;
  const observer = new PerformanceObserver((list) => onEntries(list.getEntries()));
  observer.observe({ type: entryType, ...extraOptions } as PerformanceObserverInit);
  return observer;
}

function installVisibilityTracker(profiler: Profiler): () => void {
  if (typeof document === "undefined") return () => {};
  let hiddenSinceMs: number | null = document.visibilityState === "hidden" ? performance.now() : null;
  const onVisibilityChange = () => {
    if (!profiler.enabled) return;
    const now = performance.now();
    if (document.visibilityState === "hidden") {
      hiddenSinceMs = now;
      profiler.addCounter("browser.visibility.hidden");
      return;
    }
    profiler.addCounter("browser.visibility.visible");
    if (hiddenSinceMs !== null) {
      profiler.recordTimer("browser.visibility.hiddenDuration", now - hiddenSinceMs, "browser");
      profiler.logEvent("marker", now - hiddenSinceMs, "tab was hidden, frames and timers were throttled");
    }
    hiddenSinceMs = null;
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  return () => document.removeEventListener("visibilitychange", onVisibilityChange);
}

function installDevicePixelRatioTracker(profiler: Profiler): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  let query: MediaQueryList | null = null;
  const watch = () => {
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener("change", onChange, { once: true });
  };
  const onChange = () => {
    if (profiler.enabled) {
      profiler.addCounter("browser.devicePixelRatioChanges");
      profiler.sampleGauge("browser.devicePixelRatio", window.devicePixelRatio, "ratio");
    }
    watch();
  };
  watch();
  return () => query?.removeEventListener("change", onChange);
}

function installEventLoopLagMonitor(profiler: Profiler): () => void {
  let expectedAtMs = performance.now() + EVENT_LOOP_PROBE_INTERVAL_MS;
  const timer = setInterval(() => {
    const now = performance.now();
    const latenessMs = now - expectedAtMs;
    expectedAtMs = now + EVENT_LOOP_PROBE_INTERVAL_MS;
    const isTabHidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    if (profiler.enabled && !isTabHidden) profiler.recordTimer("browser.eventLoopDrift", Math.max(0, latenessMs), "browser");
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
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit?: number };
    }).memory;
    if (!memory) return;
    profiler.sampleGauge("memory.jsHeapUsedBytes", memory.usedJSHeapSize, "bytes");
    profiler.sampleGauge("memory.jsHeapTotalBytes", memory.totalJSHeapSize, "bytes");
    if (memory.jsHeapSizeLimit) {
      profiler.sampleGauge("memory.jsHeapLimitBytes", memory.jsHeapSizeLimit, "bytes");
      profiler.sampleGauge("memory.jsHeapLimitUsedPercent", (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100, "percent");
    }

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
    observeEntryType(
      "event",
      (entries) => {
        if (!profiler.enabled) return;
        for (const entry of entries) {
          const timing = describeInputEvent(entry as unknown as EventTimingEntry);
          if (!timing) continue;
          profiler.recordTimer("browser.input.delay", timing.inputDelayMs, "browser");
          profiler.recordTimer("browser.input.processing", timing.processingMs, "browser");
          profiler.recordTimer("browser.input.presentationDelay", timing.presentationDelayMs, "browser");
          profiler.recordTimer(`browser.input.total.${timing.eventName}`, entry.duration, "browser");
        }
      },
      { durationThreshold: SLOW_INPUT_DURATION_THRESHOLD_MS, buffered: false },
    ),
    observeEntryType("paint", (entries) => {
      if (!profiler.enabled) return;
      for (const entry of entries) profiler.logEvent("marker", entry.startTime, `${entry.name} at ${entry.startTime.toFixed(0)}ms since navigation`);
    }),
    observeEntryType(
      "resource",
      (entries) => {
        if (!profiler.enabled) return;
        for (const entry of entries) {
          const resource = entry as unknown as ResourceTimingEntry;
          const kind = resourceKindOf(resource);
          profiler.recordTimer(`browser.resource.${kind}`, resource.duration, "browser");
          if (resource.transferSize) profiler.recordBytes(`bytes.resource.${kind}.transfer`, resource.transferSize);
          if (resource.decodedBodySize) profiler.recordBytes(`bytes.resource.${kind}.decoded`, resource.decodedBodySize);
        }
      },
      { buffered: false },
    ),
  ];
  const stopVisibilityTracker = installVisibilityTracker(profiler);
  const stopPixelRatioTracker = installDevicePixelRatioTracker(profiler);
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
    stopVisibilityTracker();
    stopPixelRatioTracker();
    stopEventLoopMonitor();
    stopHeapSampler();
    stopListening();
  };
}
