import { PATH_SEPARATOR } from "./detail-analysis";
import { markdownHeading, markdownTable } from "./markdown-table";
import type { BenchmarkResult, DistributionSummary, ProfileReport, ProfileSnapshot } from "./types";
import {
  formatBytes,
  formatBytesPerSecond,
  formatCount,
  formatMilliseconds,
  formatMillisecondsPerSecond,
  formatNanosecondsPerUnit,
} from "./ui/format";

/**
 * Compares two profiles metric by metric. For every row a higher number is
 * worse (time, bytes, work per second), so a positive change is a regression.
 */

export const NOISE_PERCENT = 5;
export const DIFF_ROWS_PER_VERDICT = 25;

/** Changes smaller than this are noise whatever the percentage, so tiny metrics are not flagged. */
const MINIMUM_ABSOLUTE_CHANGE_BY_UNIT: { [unit: string]: number } = {
  ms: 0.05,
  "ms/s": 0.5,
  "ms/call": 0.01,
  ns: 50,
  bytes: 1024,
  "bytes/s": 1024,
  "count/s": 1,
};
const DEFAULT_MINIMUM_ABSOLUTE_CHANGE = 1;

export type DiffCategory = "timer" | "callTree" | "breakdown" | "counter" | "bytes" | "gauge" | "frame";
export type DiffVerdict = "regression" | "improvement" | "same";

export interface DiffRow {
  category: DiffCategory;
  name: string;
  metric: string;
  unit: string;
  base: number | null;
  current: number | null;
  absoluteDelta: number;
  /** Null when the base is missing or zero. */
  percentDelta: number | null;
  verdict: DiffVerdict;
  /** |absoluteDelta| in units of the metric's noise floor, so rows of different units can be ranked together. */
  impact: number;
}

export interface DiffSection {
  name: string;
  rows: DiffRow[];
}

export interface ProfileDiff {
  baseLabel: string;
  currentLabel: string;
  sections: DiffSection[];
  /** Benchmark phases that exist on only one side. */
  unmatchedSections: string[];
}

export type DiffInput = ProfileSnapshot | ProfileReport | BenchmarkResult;

export function isBenchmarkResult(input: unknown): input is BenchmarkResult {
  const candidate = input as Partial<BenchmarkResult> | null;
  return !!candidate && Array.isArray(candidate.phases) && !!candidate.overall;
}

function isReport(input: unknown): input is ProfileReport {
  const candidate = input as Partial<ProfileReport> | null;
  return !!candidate && !!candidate.snapshot && Array.isArray(candidate.snapshot.timers);
}

function isSnapshot(input: unknown): input is ProfileSnapshot {
  const candidate = input as Partial<ProfileSnapshot> | null;
  return !!candidate && Array.isArray(candidate.timers) && !!candidate.frames;
}

function snapshotOf(input: DiffInput): ProfileSnapshot {
  if (isBenchmarkResult(input)) return input.overall.snapshot;
  if (isReport(input)) return input.snapshot;
  if (isSnapshot(input)) return input;
  throw new Error("Input is neither a profile snapshot, a profile report nor a benchmark result");
}

function labelOf(input: DiffInput): string {
  if (isBenchmarkResult(input)) return `benchmark ${input.startedAtIso} (seed ${input.seed})`;
  const snapshot = snapshotOf(input);
  return `${snapshot.label} (${snapshot.capturedAtIso})`;
}

export function diffProfiles(base: DiffInput, current: DiffInput): ProfileDiff {
  const baseLabel = labelOf(base);
  const currentLabel = labelOf(current);
  if (isBenchmarkResult(base) && isBenchmarkResult(current)) {
    const sections: DiffSection[] = [
      { name: "overall", rows: diffSnapshots(base.overall.snapshot, current.overall.snapshot) },
    ];
    const currentPhaseByName = new Map(current.phases.map((phase) => [phase.name, phase]));
    const unmatchedSections: string[] = [];
    for (const basePhase of base.phases) {
      const currentPhase = currentPhaseByName.get(basePhase.name);
      if (!currentPhase) {
        unmatchedSections.push(`${basePhase.name} (only in base)`);
        continue;
      }
      currentPhaseByName.delete(basePhase.name);
      sections.push({
        name: `phase ${basePhase.name}`,
        rows: diffSnapshots(basePhase.report.snapshot, currentPhase.report.snapshot),
      });
    }
    currentPhaseByName.forEach((phase) => unmatchedSections.push(`${phase.name} (only in current)`));
    return { baseLabel, currentLabel, sections, unmatchedSections };
  }
  return {
    baseLabel,
    currentLabel,
    sections: [{ name: "snapshot", rows: diffSnapshots(snapshotOf(base), snapshotOf(current)) }],
    unmatchedSections: [],
  };
}

interface MetricPoint {
  category: DiffCategory;
  name: string;
  metric: string;
  unit: string;
  value: number;
}

export function diffSnapshots(base: ProfileSnapshot, current: ProfileSnapshot): DiffRow[] {
  const baseByKey = indexPoints(collectMetricPoints(base));
  const currentByKey = indexPoints(collectMetricPoints(current));
  const rows: DiffRow[] = [];
  const keys = new Set([...baseByKey.keys(), ...currentByKey.keys()]);
  for (const key of keys) {
    const basePoint = baseByKey.get(key);
    const currentPoint = currentByKey.get(key);
    const reference = (currentPoint ?? basePoint) as MetricPoint;
    rows.push(buildDiffRow(reference, basePoint?.value ?? null, currentPoint?.value ?? null));
  }
  return rows.sort((first, second) => second.impact - first.impact);
}

function indexPoints(points: MetricPoint[]): Map<string, MetricPoint> {
  return new Map(points.map((point) => [`${point.category}\u0000${point.name}\u0000${point.metric}`, point]));
}

function buildDiffRow(reference: MetricPoint, base: number | null, current: number | null): DiffRow {
  const absoluteDelta = (current ?? 0) - (base ?? 0);
  const percentDelta = base !== null && current !== null && base !== 0 ? (absoluteDelta / base) * 100 : null;
  const minimumChange = MINIMUM_ABSOLUTE_CHANGE_BY_UNIT[reference.unit] ?? DEFAULT_MINIMUM_ABSOLUTE_CHANGE;
  const isNoise =
    Math.abs(absoluteDelta) < minimumChange ||
    (percentDelta !== null && Math.abs(percentDelta) < NOISE_PERCENT);
  return {
    category: reference.category,
    name: reference.name,
    metric: reference.metric,
    unit: reference.unit,
    base,
    current,
    absoluteDelta,
    percentDelta,
    verdict: isNoise ? "same" : absoluteDelta > 0 ? "regression" : "improvement",
    impact: Math.abs(absoluteDelta) / minimumChange,
  };
}

function collectMetricPoints(snapshot: ProfileSnapshot): MetricPoint[] {
  const points: MetricPoint[] = [];
  const add = (category: DiffCategory, name: string, metric: string, unit: string, value: number) => {
    if (Number.isFinite(value)) points.push({ category, name, metric, unit, value });
  };

  for (const timer of snapshot.timers) {
    if (timer.count === 0) continue;
    add("timer", timer.name, "mean", "ms", timer.mean);
    add("timer", timer.name, "p95", "ms", timer.p95);
    add("timer", timer.name, "total per second", "ms/s", timer.recentPerSecondTotal);
  }
  for (const meter of snapshot.bytes) {
    if (meter.count === 0) continue;
    add("bytes", meter.name, "mean", "bytes", meter.mean);
    add("bytes", meter.name, "per second", "bytes/s", meter.recentPerSecondTotal);
  }
  for (const counter of snapshot.counters) {
    add("counter", counter.name, "per second", counter.unit === "bytes" ? "bytes/s" : "count/s", counter.recentPerSecond);
  }
  for (const gauge of snapshot.gauges) {
    add("gauge", gauge.name, "mean", gauge.unit, gauge.mean);
  }
  for (const tree of snapshot.callTrees) {
    for (const node of tree.nodes) {
      if (node.calls === 0) continue;
      add("callTree", `${tree.root}: ${node.path.split(PATH_SEPARATOR).join(" > ")}`, "self per call", "ms/call", node.selfMs / node.calls);
    }
  }
  for (const summary of snapshot.breakdowns) {
    for (const entry of summary.entries) {
      const name = `${summary.dimension} = ${entry.key}`;
      if (entry.calls > 0 && entry.selfMs > 0) add("breakdown", name, "self per call", "ms/call", entry.selfMs / entry.calls);
      if (entry.units > 0 && entry.selfMs > 0) add("breakdown", name, "cost per unit", "ns", (entry.selfMs / entry.units) * 1_000_000);
    }
  }
  collectFramePoints(snapshot, add);
  return points;
}

function collectFramePoints(
  snapshot: ProfileSnapshot,
  add: (category: DiffCategory, name: string, metric: string, unit: string, value: number) => void,
) {
  const distributions: [string, DistributionSummary][] = [
    ["frame interval", snapshot.frames.intervalMs],
    ["main-thread busy", snapshot.frames.busyMs],
    ["gpu", snapshot.frames.gpuMs],
  ];
  for (const [name, distribution] of distributions) {
    if (distribution.count === 0) continue;
    add("frame", name, "mean", "ms", distribution.mean);
    add("frame", name, "p50", "ms", distribution.p50);
    add("frame", name, "p95", "ms", distribution.p95);
    add("frame", name, "p99", "ms", distribution.p99);
  }
}

function formatValue(unit: string, value: number | null): string {
  if (value === null) return "-";
  switch (unit) {
    case "ms":
    case "ms/call":
      return formatMilliseconds(value);
    case "ms/s":
      return formatMillisecondsPerSecond(value);
    case "bytes":
      return formatBytes(value);
    case "bytes/s":
      return formatBytesPerSecond(value);
    case "ns":
      return formatNanosecondsPerUnit(value);
    default:
      return `${formatCount(value)}${unit === "count/s" ? "/s" : ` ${unit}`}`;
  }
}

function formatDelta(row: DiffRow): string {
  const sign = row.absoluteDelta >= 0 ? "+" : "-";
  return `${sign}${formatValue(row.unit, Math.abs(row.absoluteDelta))}`;
}

function formatPercentDelta(row: DiffRow): string {
  if (row.percentDelta === null) return row.base === null ? "new" : "-";
  return `${row.percentDelta >= 0 ? "+" : ""}${row.percentDelta.toFixed(1)}%`;
}

function describeChangeTable(rows: DiffRow[]): string {
  return markdownTable(
    ["category", "name", "metric", "base", "current", "change", "%"],
    rows.slice(0, DIFF_ROWS_PER_VERDICT).map((row) => [
      row.category,
      row.name,
      row.metric,
      formatValue(row.unit, row.base),
      formatValue(row.unit, row.current),
      formatDelta(row),
      formatPercentDelta(row),
    ]),
  );
}

export function renderDiffMarkdown(diff: ProfileDiff): string {
  const lines = [
    "# Game profile diff",
    "",
    `- Base: ${diff.baseLabel}`,
    `- Current: ${diff.currentLabel}`,
    `- Higher is worse for every row. A change counts only when it is at least ${NOISE_PERCENT}% and above the noise floor of its unit. Rows are ranked by size of change relative to that floor.`,
    "",
  ];
  if (diff.unmatchedSections.length > 0) {
    lines.push(`- Phases not compared: ${diff.unmatchedSections.join(", ")}`, "");
  }
  for (const section of diff.sections) {
    const regressions = section.rows.filter((row) => row.verdict === "regression");
    const improvements = section.rows.filter((row) => row.verdict === "improvement");
    const sameCount = section.rows.length - regressions.length - improvements.length;
    lines.push(markdownHeading(2, `Diff: ${section.name}`), "");
    lines.push(
      `${regressions.length} regressions, ${improvements.length} improvements, ${sameCount} unchanged of ${section.rows.length} metrics.`,
      "",
    );
    lines.push(markdownHeading(3, "Regressions"), "", describeChangeTable(regressions), "");
    lines.push(markdownHeading(3, "Improvements"), "", describeChangeTable(improvements), "");
  }
  return lines.join("\n");
}
