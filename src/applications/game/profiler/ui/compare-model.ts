/**
 * Overlay-side view of snapshot diff rows. Rows come back from
 * window.__gameProfiler, so they are read defensively and accept both the
 * profiler/diff.ts shape (category, base, current, absoluteDelta, impact) and
 * the plain shape (kind, baseValue, currentValue, delta).
 */
export interface CompareRow {
  name: string;
  kind: string;
  baseValue: number | null;
  currentValue: number | null;
  delta: number;
  percentDelta: number | null;
  verdict: string;
  /** Size of the change in units of the metric's noise floor; null when the source gave none. */
  impact: number | null;
}

export type VerdictTone = "regression" | "improvement" | "neutral";

export function verdictTone(verdict: string): VerdictTone {
  const lowered = verdict.toLowerCase();
  if (lowered.includes("regress") || lowered === "worse" || lowered === "slower") return "regression";
  if (lowered.includes("improv") || lowered === "better" || lowered === "faster") return "improvement";
  return "neutral";
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeRow(candidate: unknown, namePrefix: string): CompareRow | null {
  if (typeof candidate !== "object" || candidate === null) return null;
  const record = candidate as Record<string, unknown>;
  const baseValue = readNumber(record.baseValue ?? record.base);
  const currentValue = readNumber(record.currentValue ?? record.current);
  if (typeof record.name !== "string" || (baseValue === null && currentValue === null)) return null;
  const metricSuffix = typeof record.metric === "string" ? ` (${record.metric})` : "";
  return {
    name: `${namePrefix}${record.name}${metricSuffix}`,
    kind: typeof record.kind === "string" ? record.kind : typeof record.category === "string" ? record.category : "other",
    baseValue,
    currentValue,
    delta: readNumber(record.delta ?? record.absoluteDelta) ?? (currentValue ?? 0) - (baseValue ?? 0),
    percentDelta: readNumber(record.percentDelta),
    verdict: typeof record.verdict === "string" ? record.verdict : "",
    impact: readNumber(record.impact),
  };
}

function collectCandidates(result: unknown): { candidate: unknown; namePrefix: string }[] {
  if (Array.isArray(result)) return result.map((candidate) => ({ candidate, namePrefix: "" }));
  if (typeof result !== "object" || result === null) return [];
  const record = result as { rows?: unknown; sections?: unknown };
  if (Array.isArray(record.rows)) return record.rows.map((candidate) => ({ candidate, namePrefix: "" }));
  if (!Array.isArray(record.sections)) return [];
  const isSingleSection = record.sections.length === 1;
  return record.sections.flatMap((section: { name?: unknown; rows?: unknown }) =>
    Array.isArray(section?.rows)
      ? section.rows.map((candidate: unknown) => ({
          candidate,
          namePrefix: isSingleSection ? "" : `${String(section.name)}: `,
        }))
      : [],
  );
}

/** Accepts a bare row array, `{ rows }`, or a `ProfileDiff` with sections of rows. */
export function normalizeDiffResult(result: unknown): CompareRow[] {
  return collectCandidates(result)
    .map(({ candidate, namePrefix }) => normalizeRow(candidate, namePrefix))
    .filter((row): row is CompareRow => row !== null);
}

const TONE_ORDER: Record<VerdictTone, number> = { regression: 0, improvement: 1, neutral: 2 };

/** Regressions first, then improvements, then the rest; within a group the biggest change leads. */
export function sortByImpact(rows: CompareRow[]): CompareRow[] {
  const magnitude = (row: CompareRow) => row.impact ?? Math.abs(row.percentDelta ?? 0);
  return [...rows].sort((first, second) => {
    const toneDifference = TONE_ORDER[verdictTone(first.verdict)] - TONE_ORDER[verdictTone(second.verdict)];
    if (toneDifference !== 0) return toneDifference;
    return magnitude(second) - magnitude(first) || Math.abs(second.delta) - Math.abs(first.delta);
  });
}

export function listKinds(rows: CompareRow[]): string[] {
  return [...new Set(rows.map((row) => row.kind))].sort();
}

export function filterByKinds(rows: CompareRow[], enabledKinds: ReadonlySet<string>): CompareRow[] {
  return rows.filter((row) => enabledKinds.has(row.kind));
}

function formatNumber(value: number | null): string {
  if (value === null) return "-";
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);
}

/** Fallback markdown used when the profiler does not expose its own diff renderer. */
export function renderCompareMarkdown(baselineName: string, rows: CompareRow[]): string {
  const lines = [
    `# Compare against ${baselineName}`,
    "",
    "| name | kind | base | current | delta | % | verdict |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of sortByImpact(rows)) {
    const percentText = row.percentDelta === null ? "-" : `${row.percentDelta.toFixed(1)}%`;
    lines.push(
      `| ${row.name} | ${row.kind} | ${formatNumber(row.baseValue)} | ${formatNumber(row.currentValue)} | ${formatNumber(row.delta)} | ${percentText} | ${row.verdict} |`,
    );
  }
  return lines.join("\n");
}
