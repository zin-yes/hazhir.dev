import { profiler as defaultProfiler } from "./index";
import type { GpuTimer } from "./gpu-timer";
import type { Profiler } from "./profiler";

/** The slice of THREE.WebGLRenderer that pass measuring reads. */
export interface PassStatsRenderer {
  info: { autoReset: boolean; reset(): void; render: { calls: number; triangles: number } };
}

interface GpuPassHost {
  gpuTimer: GpuTimer;
  renderer: PassStatsRenderer;
}

let activeHost: GpuPassHost | null = null;

/** Called by the profiled renderer while it has a GPU timer installed. */
export function setGpuPassHost(host: GpuPassHost | null) {
  activeHost = host;
}

/**
 * Measures one render pass that happens outside the main scene render (shadow cascade, bloom, clouds, water
 * snapshot, ...): CPU time as `main.render.<label>`, GPU time as `gpu.pass.<label>` (and so inside gpu.frame), and
 * draw calls and triangles as the `gpu.passDraws.<label>.calls` / `.triangles` counters. Passes must not nest.
 * While the profiler is off, or before a profiled renderer exists, it is exactly `run()`.
 */
export function measureGpuPass<Result>(
  label: string,
  run: () => Result,
  activeProfiler: Profiler = defaultProfiler,
): Result {
  const host = activeHost;
  if (!activeProfiler.enabled || !host) return run();

  const { gpuTimer, renderer } = host;
  const previousAutoReset = renderer.info.autoReset;
  renderer.info.autoReset = false;
  renderer.info.reset();
  const scopeToken = activeProfiler.begin(`main.render.${label}`);
  const startedGpuTimer = gpuTimer.begin(label, activeProfiler.currentFrameId);
  try {
    return run();
  } finally {
    if (startedGpuTimer) gpuTimer.end();
    activeProfiler.end(scopeToken);
    activeProfiler.addCounter(`gpu.passDraws.${label}.calls`, renderer.info.render.calls);
    activeProfiler.addCounter(`gpu.passDraws.${label}.triangles`, renderer.info.render.triangles);
    renderer.info.autoReset = previousAutoReset;
  }
}
