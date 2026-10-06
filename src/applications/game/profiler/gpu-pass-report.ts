import type { ProfileSnapshot, TimerSummary } from "./types";

const GPU_PASS_PREFIX = "gpu.pass.";
const CPU_PASS_PREFIX = "main.render.";
const PASS_DRAWS_PREFIX = "gpu.passDraws.";
const SYNC_ESTIMATE_SUFFIX = ".syncEstimate";

export interface GpuPassRow {
  pass: string;
  gpu: TimerSummary | null;
  /** Main-thread CPU spent submitting this pass (extra passes only; the scene render is main.frame.render). */
  cpu: TimerSummary | null;
  drawCallsPerPass: number | null;
  trianglesPerPass: number | null;
  /** Share (0..1) of the summed mean GPU time of all passes. */
  gpuShare: number;
}

/** One row per GPU pass (scene, lod, shadow cascades, bloom stages, clouds, ...) ranked by mean GPU time. */
export function buildGpuPassRows(snapshot: ProfileSnapshot): GpuPassRow[] {
  const gpuByPass = new Map<string, TimerSummary>();
  const cpuByPass = new Map<string, TimerSummary>();
  for (const timer of snapshot.timers) {
    if (timer.name.startsWith(GPU_PASS_PREFIX) && !timer.name.endsWith(SYNC_ESTIMATE_SUFFIX)) {
      gpuByPass.set(timer.name.slice(GPU_PASS_PREFIX.length), timer);
    } else if (timer.name.startsWith(CPU_PASS_PREFIX) && timer.domain === "main-cpu") {
      cpuByPass.set(timer.name.slice(CPU_PASS_PREFIX.length), timer);
    }
  }
  const drawCallTotals = new Map<string, number>();
  const triangleTotals = new Map<string, number>();
  for (const counter of snapshot.counters) {
    if (!counter.name.startsWith(PASS_DRAWS_PREFIX)) continue;
    const [pass, kind] = splitLast(counter.name.slice(PASS_DRAWS_PREFIX.length));
    if (kind === "calls") drawCallTotals.set(pass, counter.total);
    else if (kind === "triangles") triangleTotals.set(pass, counter.total);
  }

  const passNames = new Set([...gpuByPass.keys(), ...cpuByPass.keys(), ...drawCallTotals.keys()]);
  const totalMeanGpuMs = [...gpuByPass.values()].reduce((sum, timer) => sum + timer.mean, 0);
  const rows = [...passNames].map((pass): GpuPassRow => {
    const cpu = cpuByPass.get(pass) ?? null;
    const passRuns = cpu?.count ?? 0;
    const calls = drawCallTotals.get(pass);
    const triangles = triangleTotals.get(pass);
    return {
      pass,
      gpu: gpuByPass.get(pass) ?? null,
      cpu,
      drawCallsPerPass: calls !== undefined && passRuns > 0 ? calls / passRuns : null,
      trianglesPerPass: triangles !== undefined && passRuns > 0 ? triangles / passRuns : null,
      gpuShare: totalMeanGpuMs > 0 ? (gpuByPass.get(pass)?.mean ?? 0) / totalMeanGpuMs : 0,
    };
  });
  return rows.sort((first, second) => (second.gpu?.mean ?? 0) - (first.gpu?.mean ?? 0));
}

function splitLast(name: string): [string, string] {
  const lastDot = name.lastIndexOf(".");
  return [name.slice(0, lastDot), name.slice(lastDot + 1)];
}
