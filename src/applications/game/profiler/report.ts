import {
  BUDGET_MILLISECONDS_PER_SECOND,
  budgetSharePercent,
  estimateReceiveCloneMillisecondsPerSecond,
  estimateSelfMillisecondsPerSecond,
} from "./cost-model";
import { PATH_SEPARATOR, isOverflowKey, isOverflowNode, percentOf, rankedBreakdownEntries, rootTotalMsForNode, treeTotalMs } from "./detail-analysis";
import { buildOptimizationHints } from "./hints";
import {
  buildEfficiencyLines,
  buildWorkerMethodRows,
  type WorkerMethodRow,
} from "./metric-names";
import type {
  GaugeSummary,
  OptimizationTarget,
  ProfileReport,
  ProfileSnapshot,
  TimerSummary,
} from "./types";

export {
  BUDGET_MILLISECONDS_PER_SECOND,
  budgetSharePercent,
  estimateReceiveCloneMillisecondsPerSecond,
  estimateSelfMillisecondsPerSecond,
};

const TARGETS_PER_GROUP = 15;
const WORKER_DETAIL_TREE_PATHS = 10;
const WORKER_DETAIL_BREAKDOWN_KEYS = 10;
const MEMORY_GAUGE_UNIT = "bytes";
/** Wrapper aggregate that would double count every scope nested inside it. */
const EXCLUDED_MAIN_THREAD_SCOPES = new Set(["main.frame.callback"]);

type TargetDraft = Omit<OptimizationTarget, "rank">;

const GROUP_ORDER: OptimizationTarget["group"][] = [
  "main-thread",
  "gpu",
  "gl-driver",
  "transfer",
  "worker",
  "worker-detail",
  "memory",
  "light",
  "latency",
];

export function buildProfileReport(snapshot: ProfileSnapshot): ProfileReport {
  const drafts: TargetDraft[] = [
    ...buildMainThreadTargets(snapshot),
    ...buildDomainTimerTargets(snapshot, "gpu", "gpu", true),
    ...buildDomainTimerTargets(snapshot, "gl", "gl-driver", true),
    ...buildTransferTargets(snapshot),
    ...buildWorkerTargets(snapshot),
    ...buildWorkerDetailTargets(snapshot),
    ...buildMemoryTargets(snapshot),
    ...buildLightTargets(snapshot),
    ...buildLatencyTargets(snapshot),
  ];

  const targets: OptimizationTarget[] = [];
  for (const group of GROUP_ORDER) {
    drafts
      .filter((draft) => draft.group === group)
      .slice(0, TARGETS_PER_GROUP)
      .forEach((draft) => targets.push({ ...draft, rank: targets.length + 1 }));
  }
  return { snapshot, targets, hints: buildOptimizationHints(snapshot, targets) };
}

function timerTarget(
  group: OptimizationTarget["group"],
  timer: TimerSummary,
  millisecondsPerSecond: number | null,
  includeBudget: boolean,
  note: string,
): TargetDraft {
  return {
    group,
    name: timer.name,
    millisecondsPerSecond,
    frameBudgetSharePercent:
      includeBudget && millisecondsPerSecond !== null
        ? budgetSharePercent(millisecondsPerSecond)
        : null,
    bytesPerSecond: null,
    count: timer.count,
    meanMs: timer.mean,
    p95Ms: timer.p95,
    maxMs: timer.max,
    note,
  };
}

function descendingByCost(first: TargetDraft, second: TargetDraft) {
  return (second.millisecondsPerSecond ?? 0) - (first.millisecondsPerSecond ?? 0);
}

function buildMainThreadTargets(snapshot: ProfileSnapshot): TargetDraft[] {
  return snapshot.timers
    .filter((timer) => timer.domain === "main-cpu")
    .filter((timer) => !EXCLUDED_MAIN_THREAD_SCOPES.has(timer.name))
    .map((timer) => {
      const selfRate = estimateSelfMillisecondsPerSecond(timer);
      const callsPerSecond = timer.recentPerSecondCount;
      const parentNote = timer.parent ? `inside ${timer.parent}; ` : "";
      return timerTarget(
        "main-thread",
        timer,
        selfRate,
        true,
        `${parentNote}${callsPerSecond.toFixed(1)} calls/s, self ${timer.selfTotal.toFixed(1)}ms of ${timer.total.toFixed(1)}ms total`,
      );
    })
    .filter((draft) => (draft.millisecondsPerSecond ?? 0) > 0)
    .sort(descendingByCost);
}

function buildDomainTimerTargets(
  snapshot: ProfileSnapshot,
  domain: TimerSummary["domain"],
  group: OptimizationTarget["group"],
  includeBudget: boolean,
): TargetDraft[] {
  return snapshot.timers
    .filter((timer) => timer.domain === domain)
    .map((timer) =>
      timerTarget(
        group,
        timer,
        timer.recentPerSecondTotal,
        includeBudget,
        `${timer.recentPerSecondCount.toFixed(1)} samples/s`,
      ),
    )
    .filter((draft) => (draft.millisecondsPerSecond ?? 0) > 0)
    .sort(descendingByCost);
}

function buildTransferTargets(snapshot: ProfileSnapshot): TargetDraft[] {
  const drafts: TargetDraft[] = [];
  const cloneThroughput = snapshot.session.structuredCloneMegabytesPerSecond;

  for (const row of buildWorkerMethodRows(snapshot)) {
    if (!row.paramBytes && !row.resultBytes) continue;
    const paramRate = row.paramBytes?.recentPerSecondTotal ?? 0;
    const resultRate = row.resultBytes?.recentPerSecondTotal ?? 0;
    const postRate = row.mainPost ? estimateSelfMillisecondsPerSecond(row.mainPost) : 0;
    const receiveRate = estimateReceiveCloneMillisecondsPerSecond(resultRate, cloneThroughput);
    const mainThreadRate = postRate + (receiveRate ?? 0);
    const workerSerializeRate = row.workerSerialize?.recentPerSecondTotal ?? 0;
    drafts.push({
      group: "transfer",
      name: `${row.pool}.${row.method}`,
      millisecondsPerSecond: mainThreadRate,
      frameBudgetSharePercent: budgetSharePercent(mainThreadRate),
      bytesPerSecond: paramRate + resultRate,
      count: (row.paramBytes?.count ?? 0) + (row.resultBytes?.count ?? 0),
      meanMs: row.mainPost?.mean ?? null,
      p95Ms: row.mainPost?.p95 ?? null,
      maxMs: row.mainPost?.max ?? null,
      note: transferNote(row, postRate, receiveRate, workerSerializeRate),
    });
  }

  for (const meter of snapshot.bytes) {
    if (!meter.name.startsWith("gl.upload.")) continue;
    drafts.push({
      group: "transfer",
      name: meter.name,
      millisecondsPerSecond: null,
      frameBudgetSharePercent: null,
      bytesPerSecond: meter.recentPerSecondTotal,
      count: meter.count,
      meanMs: null,
      p95Ms: null,
      maxMs: null,
      note: `CPU to GPU upload, ${meter.recentPerSecondCount.toFixed(1)} calls/s, largest ${meter.max} bytes`,
    });
  }

  return drafts.sort((first, second) => {
    const costDifference = (second.millisecondsPerSecond ?? 0) - (first.millisecondsPerSecond ?? 0);
    if (costDifference !== 0) return costDifference;
    return (second.bytesPerSecond ?? 0) - (first.bytesPerSecond ?? 0);
  });
}

function transferNote(
  row: WorkerMethodRow,
  postRate: number,
  receiveRate: number | null,
  workerSerializeRate: number,
): string {
  const receiveText =
    receiveRate === null ? "receive clone not calibrated" : `receive clone ~${receiveRate.toFixed(1)}ms/s`;
  return `main postMessage ${postRate.toFixed(1)}ms/s, ${receiveText}; worker result serialize ${workerSerializeRate.toFixed(1)}ms/s (off main thread)`;
}

function buildWorkerTargets(snapshot: ProfileSnapshot): TargetDraft[] {
  const rows = buildWorkerMethodRows(snapshot);
  const efficiencyLines = buildEfficiencyLines(rows);
  const poolByName = new Map(snapshot.workerPools.map((pool) => [pool.name, pool]));

  return snapshot.timers
    .filter((timer) => timer.domain === "worker-cpu")
    .map((timer) => {
      const [, pool, method, ...sectionParts] = timer.name.split(".");
      const section = sectionParts.join(".");
      const notes: string[] = [`${timer.recentPerSecondCount.toFixed(1)} tasks/s`];
      if (section === "exec") {
        const poolSummary = poolByName.get(pool);
        if (poolSummary) {
          notes.push(
            `pool utilization ${(poolSummary.utilization * 100).toFixed(0)}% of ${poolSummary.workerCount} workers`,
          );
        }
        for (const line of efficiencyLines.filter(
          (candidate) => candidate.pool === pool && candidate.method === method,
        )) {
          notes.push(`${(line.nanosecondsPerUnit / 1000).toFixed(2)}us per ${line.counter}`);
        }
      }
      return timerTarget("worker", timer, timer.recentPerSecondTotal, false, notes.join("; "));
    })
    .filter((draft) => (draft.millisecondsPerSecond ?? 0) > 0)
    .sort(descendingByCost);
}

function buildWorkerDetailTargets(snapshot: ProfileSnapshot): TargetDraft[] {
  const profiledSeconds = Math.max(snapshot.profiledForMs / 1000, 1);

  const treePathDrafts: TargetDraft[] = snapshot.callTrees
    .filter((tree) => tree.thread === "worker")
    .flatMap((tree) => {
      const treeTotal = treeTotalMs(tree);
      return tree.nodes
        .filter((node) => node.selfMs > 0 && !isOverflowNode(node))
        .map((node): TargetDraft => ({
          group: "worker-detail",
          name: `${tree.root}: ${node.path.split(PATH_SEPARATOR).join(" > ")}`,
          millisecondsPerSecond: node.selfMs / profiledSeconds,
          frameBudgetSharePercent: null,
          bytesPerSecond: null,
          count: node.calls,
          meanMs: node.calls > 0 ? node.selfMs / node.calls : null,
          p95Ms: null,
          maxMs: node.maxMs,
          note: `self time, ${percentOf(node.selfMs, treeTotal).toFixed(0)}% of ${tree.root} tree, ${percentOf(node.selfMs, rootTotalMsForNode(tree, node)).toFixed(0)}% of its root${node.estimated ? ", estimated from sampled calls" : ""}`,
        }));
    })
    .sort(descendingByCost)
    .slice(0, WORKER_DETAIL_TREE_PATHS);

  const breakdownDrafts: TargetDraft[] = snapshot.breakdowns
    .flatMap((summary) =>
      rankedBreakdownEntries(summary)
        .filter((entry) => entry.selfMs > 0 && !isOverflowKey(entry))
        .map((entry): TargetDraft => ({
          group: "worker-detail",
          name: `${summary.dimension} = ${entry.key}`,
          millisecondsPerSecond: entry.selfMs / profiledSeconds,
          frameBudgetSharePercent: null,
          bytesPerSecond: null,
          count: entry.calls,
          meanMs: entry.calls > 0 ? entry.selfMs / entry.calls : null,
          p95Ms: null,
          maxMs: null,
          note: `${percentOf(entry.selfMs, summary.totalSelfMs).toFixed(0)}% of ${summary.dimension} (${summary.thread})${entry.units > 0 ? `, ${((entry.selfMs / entry.units) * 1_000_000).toFixed(0)}ns per unit over ${entry.units} units` : ""}`,
        })),
    )
    .sort(descendingByCost)
    .slice(0, WORKER_DETAIL_BREAKDOWN_KEYS);

  return [...treePathDrafts, ...breakdownDrafts].sort(descendingByCost);
}

function buildMemoryTargets(snapshot: ProfileSnapshot): TargetDraft[] {
  const sized: { sizeBytes: number; draft: TargetDraft }[] = [];

  for (const gauge of snapshot.gauges) {
    if (gauge.unit !== MEMORY_GAUGE_UNIT) continue;
    sized.push({ sizeBytes: gauge.last, draft: memoryDraftFromGauge(gauge) });
  }

  const meshes = snapshot.meshes;
  if (meshes.liveVertices > 0) {
    for (const [attribute, bytes] of Object.entries(meshes.bytesByAttribute)) {
      sized.push({
        sizeBytes: bytes,
        draft: {
          group: "memory",
          name: `meshes.${attribute}`,
          millisecondsPerSecond: null,
          frameBudgetSharePercent: null,
          bytesPerSecond: null,
          count: meshes.liveMeshes,
          meanMs: null,
          p95Ms: null,
          maxMs: null,
          note: `${formatMegabytes(bytes)} live, ${(bytes / meshes.liveVertices).toFixed(1)} bytes per vertex over ${meshes.liveVertices} vertices`,
        },
      });
    }
  }

  return sized.sort((first, second) => second.sizeBytes - first.sizeBytes).map((entry) => entry.draft);
}

function memoryDraftFromGauge(gauge: GaugeSummary): TargetDraft {
  return {
    group: "memory",
    name: gauge.name,
    millisecondsPerSecond: null,
    frameBudgetSharePercent: null,
    bytesPerSecond: null,
    count: gauge.samples,
    meanMs: null,
    p95Ms: null,
    maxMs: null,
    note: `${formatMegabytes(gauge.last)} now, peak ${formatMegabytes(gauge.max)}, mean ${formatMegabytes(gauge.mean)}`,
  };
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function buildLightTargets(snapshot: ProfileSnapshot): TargetDraft[] {
  return snapshot.timers
    .filter((timer) => timer.domain === "light")
    .map((timer) =>
      timerTarget(
        "light",
        timer,
        null,
        false,
        `wall-clock time per edit, ${timer.count} edits`,
      ),
    )
    .sort((first, second) => (second.p95Ms ?? 0) - (first.p95Ms ?? 0));
}

function buildLatencyTargets(snapshot: ProfileSnapshot): TargetDraft[] {
  return snapshot.timers
    .filter((timer) => timer.domain === "latency" || timer.domain === "browser")
    .map((timer) =>
      timerTarget(
        "latency",
        timer,
        null,
        false,
        `wall-clock latency, not CPU time, ${timer.recentPerSecondCount.toFixed(1)} samples/s`,
      ),
    )
    .sort((first, second) => (second.p95Ms ?? 0) - (first.p95Ms ?? 0));
}
