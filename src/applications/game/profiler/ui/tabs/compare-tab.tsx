import { useMemo, useState } from "react";

import type { ProfileReport } from "../../types";
import {
  filterByKinds,
  listKinds,
  normalizeDiffResult,
  renderCompareMarkdown,
  sortByImpact,
  verdictTone,
  type CompareRow,
} from "../compare-model";
import { renderDiffMarkdown, type ProfileDiff } from "../../diff";
import { getOptionalProfilerApi } from "../profiler-api-access";
import { DataTable, SectionTitle, type Column } from "../table";

const BUTTON_CLASSES = "border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 hover:bg-zinc-700 disabled:opacity-40";
const DEFAULT_BASELINE_NAME = "baseline";
const MAX_RENDERED_ROWS = 300;

const TONE_CLASSES = {
  regression: "text-red-400",
  improvement: "text-green-400",
  neutral: "text-zinc-400",
} as const;

function formatValue(value: number | null): string {
  if (value === null) return "-";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  return value.toFixed(2);
}

const COLUMNS: Column<CompareRow>[] = [
  { header: "name", render: (row) => row.name, className: "max-w-[210px] truncate text-zinc-100" },
  { header: "kind", render: (row) => row.kind, className: "text-zinc-500" },
  { header: "base", align: "right", render: (row) => formatValue(row.baseValue) },
  { header: "current", align: "right", render: (row) => formatValue(row.currentValue) },
  {
    header: "delta",
    align: "right",
    render: (row) => (
      <span className={TONE_CLASSES[verdictTone(row.verdict)]}>
        {row.delta > 0 ? "+" : ""}
        {formatValue(row.delta)}
      </span>
    ),
  },
  {
    header: "%",
    align: "right",
    render: (row) => (
      <span className={TONE_CLASSES[verdictTone(row.verdict)]}>
        {row.percentDelta === null ? "-" : `${row.percentDelta > 0 ? "+" : ""}${row.percentDelta.toFixed(1)}%`}
      </span>
    ),
  },
  {
    header: "verdict",
    render: (row) => <span className={TONE_CLASSES[verdictTone(row.verdict)]}>{row.verdict || "-"}</span>,
  },
];

function isProfileDiff(result: unknown): result is ProfileDiff {
  return typeof result === "object" && result !== null && Array.isArray((result as ProfileDiff).sections);
}

export function CompareTab({ report: _report }: { report: ProfileReport }) {
  const [baselineName, setBaselineName] = useState(DEFAULT_BASELINE_NAME);
  const [rows, setRows] = useState<CompareRow[] | null>(null);
  const [comparedAgainst, setComparedAgainst] = useState("");
  const [rawDiff, setRawDiff] = useState<ProfileDiff | null>(null);
  const [isShowingUnchanged, setIsShowingUnchanged] = useState(false);
  const [disabledKinds, setDisabledKinds] = useState<ReadonlySet<string>>(new Set());
  const [statusText, setStatusText] = useState("");
  const profilerApi = getOptionalProfilerApi();

  const sortedRows = useMemo(() => (rows ? sortByImpact(rows) : []), [rows]);
  const kinds = useMemo(() => listKinds(sortedRows), [sortedRows]);
  const kindFilteredRows = useMemo(
    () => filterByKinds(sortedRows, new Set(kinds.filter((kind) => !disabledKinds.has(kind)))),
    [sortedRows, kinds, disabledKinds],
  );
  const changedRows = useMemo(
    () => kindFilteredRows.filter((row) => verdictTone(row.verdict) !== "neutral"),
    [kindFilteredRows],
  );
  const visibleRows = (isShowingUnchanged ? kindFilteredRows : changedRows).slice(0, MAX_RENDERED_ROWS);

  const trimmedName = baselineName.trim();

  const saveBaseline = async () => {
    try {
      await profilerApi.saveBaseline?.(trimmedName);
      setStatusText(`saved baseline "${trimmedName}"`);
    } catch (error) {
      setStatusText(`save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const compare = async () => {
    try {
      const result = await profilerApi.diffAgainst?.(trimmedName);
      const nextRows = normalizeDiffResult(result);
      setRows(nextRows);
      setRawDiff(isProfileDiff(result) ? result : null);
      setComparedAgainst(trimmedName);
      setStatusText(nextRows.length === 0 ? `no differences against "${trimmedName}"` : "");
    } catch (error) {
      setStatusText(`compare failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const copyMarkdown = async () => {
    const markdown = rawDiff ? renderDiffMarkdown(rawDiff) : renderCompareMarkdown(comparedAgainst, visibleRows);
    await navigator.clipboard.writeText(markdown);
    setStatusText("diff markdown copied");
  };

  const toggleKind = (kind: string) =>
    setDisabledKinds((previous) => {
      const next = new Set(previous);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  const isApiAvailable = Boolean(profilerApi.saveBaseline && profilerApi.diffAgainst);
  const regressionCount = changedRows.filter((row) => verdictTone(row.verdict) === "regression").length;
  const improvementCount = changedRows.length - regressionCount;
  const unchangedCount = kindFilteredRows.length - changedRows.length;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 p-1">
        <input
          value={baselineName}
          onChange={(event) => setBaselineName(event.target.value)}
          aria-label="Baseline name"
          placeholder="baseline name"
          className="w-[140px] border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100"
        />
        <button className={BUTTON_CLASSES} onClick={saveBaseline} disabled={!profilerApi.saveBaseline || !trimmedName}>
          Save baseline
        </button>
        <button className={BUTTON_CLASSES} onClick={compare} disabled={!profilerApi.diffAgainst || !trimmedName}>
          Compare against baseline
        </button>
        <button className={BUTTON_CLASSES} onClick={copyMarkdown} disabled={visibleRows.length === 0}>
          Copy markdown
        </button>
        <span className="text-zinc-500">{statusText}</span>
      </div>
      {!isApiAvailable ? (
        <div className="px-2 py-1 text-zinc-500">baseline API is not available in this build of the profiler</div>
      ) : null}
      {rows ? (
        <>
          <div className="flex flex-wrap items-center gap-1 px-1">
            {kinds.map((kind) => (
              <button
                key={kind}
                onClick={() => toggleKind(kind)}
                aria-pressed={!disabledKinds.has(kind)}
                className={`border px-1.5 py-0.5 ${disabledKinds.has(kind) ? "border-zinc-700 text-zinc-600" : "border-cyan-700 bg-zinc-800 text-cyan-300"}`}
              >
                {kind}
              </button>
            ))}
            <button
              onClick={() => setIsShowingUnchanged(!isShowingUnchanged)}
              aria-pressed={isShowingUnchanged}
              className={`border px-1.5 py-0.5 ${isShowingUnchanged ? "border-cyan-700 bg-zinc-800 text-cyan-300" : "border-zinc-700 text-zinc-500"}`}
            >
              unchanged ({unchangedCount})
            </button>
            <span className="ml-auto text-zinc-500">
              vs "{comparedAgainst}": <span className="text-red-400">{regressionCount} worse</span>,{" "}
              <span className="text-green-400">{improvementCount} better</span>
            </span>
          </div>
          <SectionTitle>Changes, biggest impact first</SectionTitle>
          <DataTable columns={COLUMNS} rows={visibleRows} getKey={(row, index) => `${row.kind}:${row.name}:${index}`} emptyText="no rows for the enabled kinds" />
        </>
      ) : (
        <div className="px-2 py-1 text-zinc-500">Save a baseline, change something, then compare.</div>
      )}
    </div>
  );
}
