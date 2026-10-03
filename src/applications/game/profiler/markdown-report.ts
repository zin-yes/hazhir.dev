import { buildEfficiencyLines, buildWorkerMethodRows } from "./metric-names";
import { estimateSelfMillisecondsPerSecond } from "./cost-model";
import type {
  BenchmarkResult,
  DistributionSummary,
  OptimizationTarget,
  ProfileReport,
  TimerSummary,
} from "./types";
import {
  formatBytes,
  formatBytesPerSecond,
  formatMilliseconds,
  formatNanosecondsPerUnit,
  formatOptional,
} from "./ui/format";

const TARGET_ROWS_PER_GROUP = 10;
const PHASE_TARGET_ROWS_PER_GROUP = 5;
const APPENDIX_TIMER_ROWS = 40;
const WORST_FRAME_ROWS = 10;
const EVENT_ROWS = 30;

const GROUP_TITLES: Record<OptimizationTarget["group"], string> = {
  "main-thread": "Main thread (self time, blocks frames)",
  gpu: "GPU",
  "gl-driver": "GL driver (main-thread CPU inside WebGL calls)",
  transfer: "Transfers (worker messages and GPU uploads)",
  worker: "Workers (background CPU)",
  memory: "Memory",
  latency: "Latency (wall clock, not CPU)",
};

export function renderMarkdownReport(report: ProfileReport): string {
  const lines: string[] = [`# Game profile report: ${report.snapshot.label}`, ""];
  lines.push(...renderReportSections(report, 2, TARGET_ROWS_PER_GROUP, true));
  return lines.join("\n");
}

export function renderBenchmarkMarkdown(result: BenchmarkResult): string {
  const lines: string[] = [
    `# Game benchmark report`,
    "",
    `- Started: ${result.startedAtIso}`,
    `- Seed: ${result.seed}`,
    `- Phases: ${result.phases.map((phase) => `${phase.name} (${phase.durationSeconds.toFixed(1)}s)`).join(", ")}`,
    "",
  ];
  for (const phase of result.phases) {
    lines.push(`## Phase: ${phase.name} (${phase.durationSeconds.toFixed(1)}s)`, "");
    lines.push(...renderFrameSection(phase.report, 3));
    lines.push(...renderTargetSections(phase.report.targets, 3, PHASE_TARGET_ROWS_PER_GROUP));
    lines.push(...renderHintSection(phase.report, 3));
  }
  lines.push("## Overall", "");
  lines.push(...renderReportSections(result.overall, 3, TARGET_ROWS_PER_GROUP, true));
  return lines.join("\n");
}

function renderReportSections(
  report: ProfileReport,
  headingLevel: number,
  targetRows: number,
  includeAppendix: boolean,
): string[] {
  const lines: string[] = [
    ...renderSessionSection(report, headingLevel),
    ...renderFrameSection(report, headingLevel),
    ...renderHintSection(report, headingLevel),
    ...renderTargetSections(report.targets, headingLevel, targetRows),
  ];
  if (includeAppendix) lines.push(...renderAppendix(report, headingLevel));
  return lines;
}

function heading(level: number, text: string): string {
  return `${"#".repeat(level)} ${text}`;
}

function renderSessionSection(report: ProfileReport, level: number): string[] {
  const { session, profiledForMs, capturedAtIso } = report.snapshot;
  return [
    heading(level, "Session"),
    "",
    `- Captured: ${capturedAtIso}, profiled for ${(profiledForMs / 1000).toFixed(1)}s`,
    `- GPU: ${session.gpuRenderer ?? "unknown"} (${session.gpuVendor ?? "unknown vendor"}), timer mode: ${session.gpuTimerMode}, pass breakdown: ${session.gpuPassBreakdownEnabled ? "on" : "off"}`,
    `- Viewport: ${session.viewport.width}x${session.viewport.height} at devicePixelRatio ${session.devicePixelRatio}, ${session.hardwareConcurrency} logical cores, cross-origin isolated: ${session.crossOriginIsolated}`,
    `- structuredClone throughput: ${formatOptional(session.structuredCloneMegabytesPerSecond, (value) => `${value.toFixed(0)} MB/s`)}`,
    `- Game config: ${formatKeyValues(session.game)}`,
    `- Timer note: ${session.timerResolutionNote}`,
    `- User agent: ${session.userAgent}`,
    "",
  ];
}

function formatKeyValues(values: { [key: string]: number | string }): string {
  const entries = Object.entries(values);
  return entries.length === 0 ? "none" : entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

function distributionRow(label: string, distribution: DistributionSummary): string[] {
  return [
    label,
    `${distribution.count}`,
    formatMilliseconds(distribution.mean),
    formatMilliseconds(distribution.p50),
    formatMilliseconds(distribution.p95),
    formatMilliseconds(distribution.p99),
    formatMilliseconds(distribution.max),
  ];
}

function renderFrameSection(report: ProfileReport, level: number): string[] {
  const frames = report.snapshot.frames;
  const meanFps = frames.intervalMs.mean > 0 ? 1000 / frames.intervalMs.mean : 0;
  return [
    heading(level, "Frame time"),
    "",
    markdownTable(
      ["metric", "samples", "mean", "p50", "p95", "p99", "max"],
      [
        distributionRow("frame interval", frames.intervalMs),
        distributionRow("main-thread busy", frames.busyMs),
        distributionRow("gpu", frames.gpuMs),
      ],
    ),
    "",
    `Mean ${meanFps.toFixed(1)} fps over ${frames.count} frames; over 16.7ms: ${frames.framesOver16Point7Ms}, over 33ms: ${frames.framesOver33Ms}, over 50ms: ${frames.framesOver50Ms}.`,
    "",
  ];
}

function renderHintSection(report: ProfileReport, level: number): string[] {
  const lines = [heading(level, "Hints"), ""];
  if (report.hints.length === 0) {
    lines.push("No rule fired for this session.", "");
    return lines;
  }
  for (const hint of report.hints) {
    lines.push(`- **[${hint.severity}] ${hint.title}**`);
    lines.push(`  - Evidence: ${hint.evidence}`);
    lines.push(`  - Suggestion: ${hint.suggestion}`);
  }
  lines.push("");
  return lines;
}

function renderTargetSections(
  targets: OptimizationTarget[],
  level: number,
  rowsPerGroup: number,
): string[] {
  const lines = [heading(level, "Top targets"), ""];
  for (const [group, title] of Object.entries(GROUP_TITLES)) {
    const groupTargets = targets
      .filter((target) => target.group === group)
      .slice(0, rowsPerGroup);
    if (groupTargets.length === 0) continue;
    lines.push(heading(level + 1, title), "");
    lines.push(
      markdownTable(
        ["rank", "name", "ms/s", "% frame budget", "bytes/s", "count", "mean", "p95", "max", "note"],
        groupTargets.map((target) => [
          `${target.rank}`,
          target.name,
          formatOptional(target.millisecondsPerSecond, (value) => value.toFixed(1)),
          formatOptional(target.frameBudgetSharePercent, (value) => value.toFixed(1)),
          formatOptional(target.bytesPerSecond, formatBytesPerSecond),
          `${target.count}`,
          formatOptional(target.meanMs, formatMilliseconds),
          formatOptional(target.p95Ms, formatMilliseconds),
          formatOptional(target.maxMs, formatMilliseconds),
          target.note,
        ]),
      ),
      "",
    );
  }
  return lines;
}

function renderAppendix(report: ProfileReport, level: number): string[] {
  const snapshot = report.snapshot;
  const lines = [heading(level, "Appendix"), ""];

  const mainTimers = snapshot.timers
    .filter((timer) => timer.domain === "main-cpu")
    .sort(
      (first, second) =>
        estimateSelfMillisecondsPerSecond(second) - estimateSelfMillisecondsPerSecond(first),
    )
    .slice(0, APPENDIX_TIMER_ROWS);
  lines.push(heading(level + 1, "Main-thread scopes by self ms/s"), "");
  lines.push(
    markdownTable(
      ["scope", "parent", "self ms/s", "calls/s", "total", "self total", "mean", "p95", "max"],
      mainTimers.map((timer) => timerRow(timer)),
    ),
    "",
  );

  lines.push(heading(level + 1, "Worker methods"), "");
  const methodRows = buildWorkerMethodRows(snapshot);
  lines.push(
    markdownTable(
      ["pool.method", "tasks/s", "exec mean", "exec p95", "queue wait mean", "round trip mean", "serialize mean", "toWorker mean", "toMain mean"],
      methodRows.map((row) => [
        `${row.pool}.${row.method}`,
        formatOptional(row.exec, (timer) => timer.recentPerSecondCount.toFixed(1)),
        formatOptional(row.exec, (timer) => formatMilliseconds(timer.mean)),
        formatOptional(row.exec, (timer) => formatMilliseconds(timer.p95)),
        formatOptional(row.queueWait, (timer) => formatMilliseconds(timer.mean)),
        formatOptional(row.roundTrip, (timer) => formatMilliseconds(timer.mean)),
        formatOptional(row.workerSerialize, (timer) => formatMilliseconds(timer.mean)),
        formatOptional(row.toWorker, (timer) => formatMilliseconds(timer.mean)),
        formatOptional(row.toMain, (timer) => formatMilliseconds(timer.mean)),
      ]),
    ),
    "",
  );
  const efficiency = buildEfficiencyLines(methodRows);
  if (efficiency.length > 0) {
    lines.push(
      markdownTable(
        ["pool.method", "counter", "units/s", "cost per unit"],
        efficiency.map((line) => [
          `${line.pool}.${line.method}`,
          line.counter,
          line.unitsPerSecond.toFixed(0),
          formatNanosecondsPerUnit(line.nanosecondsPerUnit),
        ]),
      ),
      "",
    );
  }

  lines.push(heading(level + 1, "Transfers"), "");
  lines.push(
    markdownTable(
      ["name", "messages", "mean size", "p95 size", "max size", "bytes/s"],
      snapshot.bytes.map((meter) => [
        meter.name,
        `${meter.count}`,
        formatBytes(meter.mean),
        formatBytes(meter.p95),
        formatBytes(meter.max),
        formatBytesPerSecond(meter.recentPerSecondTotal),
      ]),
    ),
    "",
  );

  lines.push(heading(level + 1, "Memory"), "");
  lines.push(
    markdownTable(
      ["gauge", "now", "min", "max", "mean"],
      snapshot.gauges.map((gauge) => [
        gauge.name,
        formatGaugeValue(gauge.last, gauge.unit),
        formatGaugeValue(gauge.min, gauge.unit),
        formatGaugeValue(gauge.max, gauge.unit),
        formatGaugeValue(gauge.mean, gauge.unit),
      ]),
    ),
    "",
  );
  const meshes = snapshot.meshes;
  lines.push(
    `Meshes: ${meshes.liveMeshes} live, ${meshes.liveVertices} vertices, ${meshes.liveTriangles} triangles, ${formatBytes(meshes.liveBytes)}, ${meshes.bytesPerVertex.toFixed(1)} bytes per vertex (${Object.entries(meshes.bytesPerVertexByAttribute).map(([name, bytes]) => `${name} ${bytes.toFixed(1)}`).join(", ")}).`,
    "",
  );

  lines.push(heading(level + 1, "Worst frames"), "");
  lines.push(
    markdownTable(
      ["frame", "at", "interval", "busy", "unattributed", "gpu", "top scopes (self)", "notes"],
      snapshot.frames.worst.slice(0, WORST_FRAME_ROWS).map((frame) => [
        `${frame.frameId}`,
        `${(frame.atMs / 1000).toFixed(1)}s`,
        formatMilliseconds(frame.intervalMs),
        formatMilliseconds(frame.busyMs),
        formatMilliseconds(frame.unattributedMs),
        formatOptional(frame.gpuMs, formatMilliseconds),
        frame.topScopes
          .slice(0, 4)
          .map((scope) => `${scope.name} ${formatMilliseconds(scope.selfMs)}`)
          .join("; "),
        formatKeyValues(frame.notes),
      ]),
    ),
    "",
  );

  lines.push(heading(level + 1, "Browser events"), "");
  lines.push(
    markdownTable(
      ["kind", "at", "duration", "detail"],
      snapshot.events.slice(-EVENT_ROWS).map((event) => [
        event.kind,
        `${(event.atMs / 1000).toFixed(1)}s`,
        formatMilliseconds(event.durationMs),
        event.detail,
      ]),
    ),
    "",
  );
  return lines;
}

function timerRow(timer: TimerSummary): string[] {
  return [
    timer.name,
    timer.parent ?? "-",
    estimateSelfMillisecondsPerSecond(timer).toFixed(1),
    timer.recentPerSecondCount.toFixed(1),
    formatMilliseconds(timer.total),
    formatMilliseconds(timer.selfTotal),
    formatMilliseconds(timer.mean),
    formatMilliseconds(timer.p95),
    formatMilliseconds(timer.max),
  ];
}

function formatGaugeValue(value: number, unit: string): string {
  return unit === "bytes" ? formatBytes(value) : `${Number.isInteger(value) ? value : value.toFixed(2)} ${unit}`;
}

/** GitHub-style table; returns a placeholder line when there are no rows. */
function markdownTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return "_no data_";
  const escape = (cell: string) => cell.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const lines = [
    `| ${headers.map(escape).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escape).join(" | ")} |`),
  ];
  return lines.join("\n");
}
