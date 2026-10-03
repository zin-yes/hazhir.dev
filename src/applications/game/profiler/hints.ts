import { buildWorkerMethodRows } from "./metric-names";
import {
  budgetSharePercent,
  estimateReceiveCloneMillisecondsPerSecond,
  estimateSelfMillisecondsPerSecond,
} from "./cost-model";
import type {
  OptimizationHint,
  OptimizationTarget,
  ProfileSnapshot,
} from "./types";
import {
  formatBytes,
  formatBytesPerSecond,
  formatMilliseconds,
  formatMillisecondsPerSecond,
} from "./ui/format";

const BYTES_PER_MEGABYTE = 1024 * 1024;

export const CLONE_BYTES_PER_SECOND_LOW = 1 * BYTES_PER_MEGABYTE;
export const CLONE_BYTES_PER_SECOND_MEDIUM = 10 * BYTES_PER_MEGABYTE;
export const CLONE_BYTES_PER_SECOND_HIGH = 50 * BYTES_PER_MEGABYTE;
export const CLONE_MAIN_THREAD_MS_PER_SECOND_MEDIUM = 10;
export const CLONE_MAIN_THREAD_MS_PER_SECOND_HIGH = 50;

export const SPIKE_FRAME_MILLISECONDS = 33;
export const SPIKE_SEVERE_FRAME_MILLISECONDS = 100;
export const SPIKE_SEVERE_FRAME_COUNT = 3;
export const SPIKE_ATTRIBUTION_MIN_SELF_MS = 8;

export const UNATTRIBUTED_MIN_INTERVAL_MS = 18;
export const UNATTRIBUTED_MIN_SHARE = 0.4;
export const UNATTRIBUTED_HIGH_INTERVAL_MS = 33;
export const GPU_BOUND_SHARE_OF_INTERVAL = 0.6;

export const DRAW_CALLS_MEDIUM = 500;
export const DRAW_CALLS_HIGH = 1500;

export const BYTES_PER_VERTEX_MEDIUM = 32;
export const BYTES_PER_VERTEX_HIGH = 48;

export const UINT16_INDEX_VERTEX_LIMIT = 65536;
export const UINT32_INDEX_BYTES_PER_TRIANGLE = 12;
export const INDEX_SAVINGS_MEDIUM_BYTES = 8 * BYTES_PER_MEGABYTE;

export const REACT_RENDERS_PER_SECOND_THRESHOLD = 5;
export const REACT_MS_PER_SECOND_MEDIUM = 5;
export const REACT_MS_PER_SECOND_LOW = 1;

export const LONG_TASK_MEDIUM_MS = 50;
export const LONG_TASK_HIGH_MS = 200;
export const LONG_TASK_LOW_COUNT = 5;

export const HEAP_ALLOCATION_BYTES_PER_SECOND_MEDIUM = 20 * BYTES_PER_MEGABYTE;
export const HEAP_ALLOCATION_BYTES_PER_SECOND_HIGH = 100 * BYTES_PER_MEGABYTE;

export const GPU_FRAME_MS_MEDIUM = 8;
export const GPU_FRAME_MS_HIGH = 14;

export const UPLOAD_SPIKE_MEDIUM_MS = 4;
export const UPLOAD_SPIKE_HIGH_MS = 12;

export const POOL_SATURATED_UTILIZATION = 0.85;
export const POOL_IDLE_UTILIZATION = 0.1;
export const POOL_IDLE_MIN_TASKS = 20;

export const DOMINANT_SCOPE_BUDGET_SHARE_MEDIUM = 10;
export const DOMINANT_SCOPE_BUDGET_SHARE_HIGH = 25;

const SEVERITY_ORDER: Record<OptimizationHint["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function buildOptimizationHints(
  snapshot: ProfileSnapshot,
  targets: OptimizationTarget[],
): OptimizationHint[] {
  const rules: (OptimizationHint | null)[] = [
    dominantMainThreadScopeHint(targets),
    frameSpikeHint(snapshot),
    unattributedFrameTimeHint(snapshot),
    structuredCloneHint(snapshot),
    drawCallsHint(snapshot),
    gpuFrameTimeHint(snapshot),
    uploadSpikeHint(snapshot),
    bytesPerVertexHint(snapshot),
    smallIndexBufferHint(snapshot),
    reactRenderHint(snapshot),
    longTaskHint(snapshot),
    heapAllocationHint(snapshot),
    ...workerPoolHints(snapshot),
  ];
  return rules
    .filter((hint): hint is OptimizationHint => hint !== null)
    .sort((first, second) => SEVERITY_ORDER[first.severity] - SEVERITY_ORDER[second.severity]);
}

function dominantMainThreadScopeHint(targets: OptimizationTarget[]): OptimizationHint | null {
  const top = targets.find((target) => target.group === "main-thread");
  const share = top?.frameBudgetSharePercent ?? 0;
  if (!top || share < DOMINANT_SCOPE_BUDGET_SHARE_MEDIUM) return null;
  return {
    severity: share >= DOMINANT_SCOPE_BUDGET_SHARE_HIGH ? "high" : "medium",
    title: `Main thread is dominated by ${top.name}`,
    evidence: `${top.name} uses ${formatMillisecondsPerSecond(top.millisecondsPerSecond ?? 0)} of self time, ${share.toFixed(1)}% of the 60 fps frame budget (mean ${formatMilliseconds(top.meanMs ?? 0)}, p95 ${formatMilliseconds(top.p95Ms ?? 0)}, max ${formatMilliseconds(top.maxMs ?? 0)}).`,
    suggestion:
      "Optimize this scope first: it is the largest single main-thread cost. Cache or skip work when nothing changed, avoid per-call allocations, or move it to a worker.",
  };
}

function frameSpikeHint(snapshot: ProfileSnapshot): OptimizationHint | null {
  const { worst, framesOver33Ms, framesOver50Ms, count } = snapshot.frames;
  if (worst.length === 0) return null;
  const worstFrame = worst[0];

  const culpritCounts = new Map<string, number>();
  for (const frame of worst) {
    const culprit = frame.topScopes[0];
    if (culprit && culprit.selfMs >= SPIKE_ATTRIBUTION_MIN_SELF_MS) {
      culpritCounts.set(culprit.name, (culpritCounts.get(culprit.name) ?? 0) + 1);
    }
  }
  const frequentCulprit = Array.from(culpritCounts.entries()).sort(
    (first, second) => second[1] - first[1],
  )[0];

  const isSevere =
    worstFrame.intervalMs >= SPIKE_SEVERE_FRAME_MILLISECONDS ||
    framesOver50Ms >= SPIKE_SEVERE_FRAME_COUNT;
  const severity: OptimizationHint["severity"] = isSevere
    ? "high"
    : worstFrame.intervalMs >= SPIKE_FRAME_MILLISECONDS
      ? "medium"
      : "low";

  const topScope = worstFrame.topScopes[0];
  const culpritText = frequentCulprit
    ? `${frequentCulprit[0]} is the top scope in ${frequentCulprit[1]} of ${worst.length} worst frames`
    : "no single scope explains the spikes";
  const worstText = topScope
    ? `worst frame ${formatMilliseconds(worstFrame.intervalMs)} with ${topScope.name} taking ${formatMilliseconds(topScope.selfMs)} and ${formatMilliseconds(worstFrame.unattributedMs)} unattributed`
    : `worst frame ${formatMilliseconds(worstFrame.intervalMs)}, ${formatMilliseconds(worstFrame.unattributedMs)} unattributed`;

  return {
    severity,
    title: "Frame time spikes",
    evidence: `${framesOver33Ms} of ${count} frames over 33ms, ${framesOver50Ms} over 50ms; ${worstText}; ${culpritText}.`,
    suggestion: frequentCulprit
      ? `Time-slice ${frequentCulprit[0]}: give it a per-frame time budget and spread the remaining work over later frames.`
      : "Spikes with no measured owner point at GC, compositing or driver stalls; check heap allocation rate and GPU time.",
  };
}

function unattributedFrameTimeHint(snapshot: ProfileSnapshot): OptimizationHint | null {
  const { intervalMs, busyMs, gpuMs } = snapshot.frames;
  if (intervalMs.count === 0) return null;
  if (intervalMs.mean <= UNATTRIBUTED_MIN_INTERVAL_MS) return null;
  const unattributedShare = (intervalMs.mean - busyMs.mean) / intervalMs.mean;
  if (unattributedShare < UNATTRIBUTED_MIN_SHARE) return null;

  const isGpuBound = gpuMs.count > 0 && gpuMs.mean >= intervalMs.mean * GPU_BOUND_SHARE_OF_INTERVAL;
  const severity = intervalMs.mean >= UNATTRIBUTED_HIGH_INTERVAL_MS ? "high" : "medium";
  const cause = isGpuBound
    ? `GPU time ${formatMilliseconds(gpuMs.mean)} is most of the interval, so the frame is GPU-bound`
    : "the remainder is GC, compositor, driver or code that has no profiler scope";
  return {
    severity,
    title: isGpuBound ? "Frames are GPU-bound" : "Large unmeasured share of frame time",
    evidence: `Mean frame interval ${formatMilliseconds(intervalMs.mean)} but only ${formatMilliseconds(busyMs.mean)} is attributed to measured main-thread scopes (${(unattributedShare * 100).toFixed(0)}% unattributed); ${cause}.`,
    suggestion: isGpuBound
      ? "Reduce fragment and vertex cost: lower pixel ratio, cheaper sky shader, fewer triangles, or skip hidden faces."
      : "Add scopes around remaining main-thread work, check JS heap allocation rate for GC pauses, and inspect long animation frame entries.",
  };
}

function structuredCloneHint(snapshot: ProfileSnapshot): OptimizationHint | null {
  const rows = buildWorkerMethodRows(snapshot);
  let paramRate = 0;
  let resultRate = 0;
  let postMilliseconds = 0;
  let workerSerializeMilliseconds = 0;
  for (const row of rows) {
    paramRate += row.paramBytes?.recentPerSecondTotal ?? 0;
    resultRate += row.resultBytes?.recentPerSecondTotal ?? 0;
    if (row.mainPost) postMilliseconds += estimateSelfMillisecondsPerSecond(row.mainPost);
    workerSerializeMilliseconds += row.workerSerialize?.recentPerSecondTotal ?? 0;
  }
  const totalRate = paramRate + resultRate;
  if (totalRate < CLONE_BYTES_PER_SECOND_LOW) return null;

  const receiveMilliseconds =
    estimateReceiveCloneMillisecondsPerSecond(
      resultRate,
      snapshot.session.structuredCloneMegabytesPerSecond,
    ) ?? 0;
  const mainThreadMilliseconds = postMilliseconds + receiveMilliseconds;

  let severity: OptimizationHint["severity"] = "low";
  if (
    totalRate >= CLONE_BYTES_PER_SECOND_MEDIUM ||
    mainThreadMilliseconds >= CLONE_MAIN_THREAD_MS_PER_SECOND_MEDIUM
  ) {
    severity = "medium";
  }
  if (
    totalRate >= CLONE_BYTES_PER_SECOND_HIGH ||
    mainThreadMilliseconds >= CLONE_MAIN_THREAD_MS_PER_SECOND_HIGH
  ) {
    severity = "high";
  }

  return {
    severity,
    title: "Worker payloads are copied, not transferred",
    evidence: `${formatBytesPerSecond(totalRate)} is structured-cloned across worker boundaries (params ${formatBytesPerSecond(paramRate)}, results ${formatBytesPerSecond(resultRate)}); main thread pays ${formatMillisecondsPerSecond(postMilliseconds)} in postMessage plus about ${formatMillisecondsPerSecond(receiveMilliseconds)} receiving results; workers spend ${formatMillisecondsPerSecond(workerSerializeMilliseconds)} serializing results.`,
    suggestion:
      "Pass ArrayBuffers in the postMessage transfer list (results always, params when the sender no longer needs them), send only the border slices neighbors need instead of whole chunks, or keep chunk data in SharedArrayBuffers.",
  };
}

function drawCallsHint(snapshot: ProfileSnapshot): OptimizationHint | null {
  const drawCalls = snapshot.gauges.find((gauge) => gauge.name === "gpu.drawCalls");
  if (!drawCalls || drawCalls.samples === 0 || drawCalls.mean < DRAW_CALLS_MEDIUM) return null;
  return {
    severity: drawCalls.mean >= DRAW_CALLS_HIGH ? "high" : "medium",
    title: "High draw call count",
    evidence: `${drawCalls.mean.toFixed(0)} draw calls per frame on average (max ${drawCalls.max.toFixed(0)}) across ${snapshot.meshes.liveMeshes} live chunk meshes.`,
    suggestion:
      "Skip creating empty transparent meshes, merge distant chunks into larger meshes, or batch chunk draws with a single multi-draw/indirect call.",
  };
}

function gpuFrameTimeHint(snapshot: ProfileSnapshot): OptimizationHint | null {
  const gpuFrame = snapshot.frames.gpuMs;
  if (gpuFrame.count === 0 || gpuFrame.mean < GPU_FRAME_MS_MEDIUM) return null;
  const passes = snapshot.timers
    .filter((timer) => timer.name.startsWith("gpu.pass."))
    .sort((first, second) => second.mean - first.mean)
    .map((timer) => `${timer.name.replace("gpu.pass.", "")} ${formatMilliseconds(timer.mean)}`);
  const passText = passes.length > 0 ? ` Passes: ${passes.join(", ")}.` : " Enable GPU pass breakdown to see which pass costs most.";
  return {
    severity: gpuFrame.mean >= GPU_FRAME_MS_HIGH ? "high" : "medium",
    title: "GPU frame time is high",
    evidence: `GPU time per frame averages ${formatMilliseconds(gpuFrame.mean)} (p95 ${formatMilliseconds(gpuFrame.p95)}, max ${formatMilliseconds(gpuFrame.max)}).${passText}`,
    suggestion:
      "Reduce overdraw and fragment cost: cheaper sky shader or lower sky update rate, lower devicePixelRatio, cull faces hidden by neighbors, avoid sorting/blending large transparent meshes.",
  };
}

function uploadSpikeHint(snapshot: ProfileSnapshot): OptimizationHint | null {
  const upload = snapshot.timers.find((timer) => timer.name === "gl.cpu.upload");
  if (!upload || upload.count === 0 || upload.max < UPLOAD_SPIKE_MEDIUM_MS) return null;
  const uploadMeters = snapshot.bytes.filter((meter) => meter.name.startsWith("gl.upload."));
  const largestUpload = uploadMeters.reduce((largest, meter) => Math.max(largest, meter.max), 0);
  const uploadRate = uploadMeters.reduce((sum, meter) => sum + meter.recentPerSecondTotal, 0);
  return {
    severity: upload.max >= UPLOAD_SPIKE_HIGH_MS ? "high" : "medium",
    title: "GPU upload spikes",
    evidence: `GL upload calls take up to ${formatMilliseconds(upload.max)} (mean ${formatMilliseconds(upload.mean)}, p95 ${formatMilliseconds(upload.p95)}); largest single upload ${formatBytes(largestUpload)}, ${formatBytesPerSecond(uploadRate)} uploaded overall.`,
    suggestion:
      "Limit new chunk meshes added per frame, upload with bufferSubData into preallocated buffers, and drop attributes that can be derived in the shader.",
  };
}

function bytesPerVertexHint(snapshot: ProfileSnapshot): OptimizationHint | null {
  const meshes = snapshot.meshes;
  if (meshes.liveVertices === 0 || meshes.bytesPerVertex <= BYTES_PER_VERTEX_MEDIUM) return null;
  const breakdown = Object.entries(meshes.bytesPerVertexByAttribute)
    .sort((first, second) => second[1] - first[1])
    .map(([attribute, bytes]) => `${attribute} ${bytes.toFixed(1)}`)
    .join(", ");
  return {
    severity: meshes.bytesPerVertex >= BYTES_PER_VERTEX_HIGH ? "high" : "medium",
    title: "Vertex data is wide",
    evidence: `${meshes.bytesPerVertex.toFixed(1)} bytes per vertex across ${meshes.liveVertices} live vertices (${formatBytes(meshes.liveBytes)} total). Per attribute: ${breakdown}.`,
    suggestion:
      "Quantize and pack: derive normals from a face id, store uv as uint8, and pack texture index, light and ambient occlusion into one uint32 attribute.",
  };
}

function smallIndexBufferHint(snapshot: ProfileSnapshot): OptimizationHint | null {
  const meshes = snapshot.meshes;
  const indexAttribute = Object.keys(meshes.bytesByAttribute).find((name) =>
    /^(indices|index|indexBuffer)$/i.test(name),
  );
  if (!indexAttribute || meshes.verticesPerMesh.count === 0) return null;
  if (meshes.verticesPerMesh.max >= UINT16_INDEX_VERTEX_LIMIT) return null;
  const indexBytes = meshes.bytesByAttribute[indexAttribute];
  const isFourByteIndex =
    indexBytes >= meshes.liveTriangles * UINT32_INDEX_BYTES_PER_TRIANGLE * 0.99;
  if (!isFourByteIndex) return null;
  const savings = indexBytes / 2;
  return {
    severity: savings >= INDEX_SAVINGS_MEDIUM_BYTES ? "medium" : "low",
    title: "Uint32 indices where Uint16 would fit",
    evidence: `Largest mesh has ${meshes.verticesPerMesh.max.toFixed(0)} vertices (under 65536) but indices use 4 bytes each: ${formatBytes(indexBytes)} live.`,
    suggestion: `Use Uint16 index buffers for meshes under 65536 vertices to save about ${formatBytes(savings)} of GPU memory and upload bandwidth.`,
  };
}

function reactRenderHint(snapshot: ProfileSnapshot): OptimizationHint | null {
  const reactTimers = snapshot.timers.filter((timer) => timer.name.startsWith("main.react."));
  if (reactTimers.length === 0) return null;
  const rendersPerSecond = Math.max(...reactTimers.map((timer) => timer.recentPerSecondCount));
  const millisecondsPerSecond = reactTimers.reduce(
    (sum, timer) => sum + estimateSelfMillisecondsPerSecond(timer),
    0,
  );
  if (rendersPerSecond < REACT_RENDERS_PER_SECOND_THRESHOLD) return null;
  if (millisecondsPerSecond < REACT_MS_PER_SECOND_LOW) return null;
  const busiest = [...reactTimers].sort((first, second) => second.total - first.total)[0];
  return {
    severity: millisecondsPerSecond >= REACT_MS_PER_SECOND_MEDIUM ? "medium" : "low",
    title: "Game component re-renders many times per second",
    evidence: `${busiest.name} runs ${rendersPerSecond.toFixed(1)} times per second, ${formatMillisecondsPerSecond(millisecondsPerSecond)} in total across main.react.* scopes (${(budgetSharePercent(millisecondsPerSecond)).toFixed(1)}% of frame budget).`,
    suggestion:
      "Move per-frame state (debug info, fps) out of the Game component into a small subscribed component or refs, and hoist per-render allocations such as the Raycaster.",
  };
}

function longTaskHint(snapshot: ProfileSnapshot): OptimizationHint | null {
  const longEvents = snapshot.events.filter(
    (event) => event.kind === "long-task" || event.kind === "long-animation-frame",
  );
  if (longEvents.length === 0) return null;
  const longest = Math.max(...longEvents.map((event) => event.durationMs));
  if (longest < LONG_TASK_MEDIUM_MS && longEvents.length < LONG_TASK_LOW_COUNT) return null;

  const detailCounts = new Map<string, number>();
  for (const event of longEvents) {
    detailCounts.set(event.detail, (detailCounts.get(event.detail) ?? 0) + 1);
  }
  const commonDetail = Array.from(detailCounts.entries()).sort((first, second) => second[1] - first[1])[0];
  const totalMilliseconds = longEvents.reduce((sum, event) => sum + event.durationMs, 0);
  return {
    severity:
      longest >= LONG_TASK_HIGH_MS ? "high" : longest >= LONG_TASK_MEDIUM_MS ? "medium" : "low",
    title: "Long main-thread tasks",
    evidence: `${longEvents.length} long task / long animation frame entries totalling ${formatMilliseconds(totalMilliseconds)}, longest ${formatMilliseconds(longest)}; most common source: ${commonDetail[0]} (${commonDetail[1]}x).`,
    suggestion:
      "Break the work behind the most common source into smaller slices; long animation frame entries name the script and function responsible.",
  };
}

function heapAllocationHint(snapshot: ProfileSnapshot): OptimizationHint | null {
  const allocation = snapshot.counters.find(
    (counter) =>
      /alloc/i.test(counter.name) && (counter.unit === "bytes" || /bytes/i.test(counter.name)),
  );
  if (!allocation || allocation.recentPerSecond < HEAP_ALLOCATION_BYTES_PER_SECOND_MEDIUM) {
    return null;
  }
  const gcEvents = snapshot.events.filter((event) => event.kind === "gc-estimate").length;
  return {
    severity:
      allocation.recentPerSecond >= HEAP_ALLOCATION_BYTES_PER_SECOND_HIGH ? "high" : "medium",
    title: "High JS heap allocation rate",
    evidence: `${allocation.name} is ${formatBytesPerSecond(allocation.recentPerSecond)}; ${gcEvents} garbage collections estimated during the session.`,
    suggestion:
      "Reuse vectors and arrays in per-frame code (raycasts, physics, player update) and avoid creating Maps and strings in the render path; each GC pause shows up as unattributed frame time.",
  };
}

function workerPoolHints(snapshot: ProfileSnapshot): (OptimizationHint | null)[] {
  return snapshot.workerPools.map((pool) => {
    const history = pool.queueDepth?.history ?? [];
    const halfway = Math.floor(history.length / 2);
    const average = (values: number[]) =>
      values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
    const isQueueGrowing =
      history.length >= 8 && average(history.slice(halfway)) > average(history.slice(0, halfway)) + 0.5;

    if (pool.utilization > POOL_SATURATED_UTILIZATION) {
      return {
        severity: isQueueGrowing ? "high" : "medium",
        title: `Worker pool "${pool.name}" is saturated`,
        evidence: `${(pool.utilization * 100).toFixed(0)}% utilization of ${pool.workerCount} workers (${formatMillisecondsPerSecond(pool.busyMillisecondsPerSecond)} busy)${isQueueGrowing ? ", queue depth is growing" : ""}; queue depth max ${pool.queueDepth?.max.toFixed(0) ?? "n/a"}.`,
        suggestion:
          "Make the task cheaper (see its worker sections), cancel stale tasks, prioritize by distance to the player, or add workers if cores are free.",
      } satisfies OptimizationHint;
    }
    if (pool.utilization < POOL_IDLE_UTILIZATION && pool.tasksCompleted >= POOL_IDLE_MIN_TASKS) {
      return {
        severity: "low",
        title: `Worker pool "${pool.name}" is mostly idle`,
        evidence: `${(pool.utilization * 100).toFixed(1)}% utilization of ${pool.workerCount} workers after ${pool.tasksCompleted} tasks.`,
        suggestion:
          "Fewer workers would free memory and startup time, or share workers between pools that are never busy at the same time.",
      } satisfies OptimizationHint;
    }
    return null;
  });
}
