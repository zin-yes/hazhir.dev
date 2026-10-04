import { useMemo, useState } from "react";

import type { BreakdownSummary, ProfileReport } from "../../types";
import {
  breakdownLabel,
  buildBreakdownMatrix,
  buildBreakdownRows,
  type BreakdownMatrix,
  type BreakdownRow,
  type BreakdownSortKey,
  type SortDirection,
} from "../breakdown-model";
import { formatCount, formatMilliseconds, formatNanosecondsPerUnit, formatOptional, formatPercent } from "../format";
import { DataTable, ProportionBar, SectionTitle, type Column } from "../table";

function formatMicroseconds(microseconds: number): string {
  return microseconds >= 1000 ? formatMilliseconds(microseconds / 1000) : `${microseconds.toFixed(microseconds >= 100 ? 0 : 1)}us`;
}

function buildColumns(
  sortKey: BreakdownSortKey,
  direction: SortDirection,
  onSort: (sortKey: BreakdownSortKey) => void,
): Column<BreakdownRow>[] {
  const sortable = (header: string, key: BreakdownSortKey) => ({
    header,
    onHeaderClick: () => onSort(key),
    headerSuffix: sortKey === key ? (direction === "descending" ? " v" : " ^") : "",
  });
  return [
    {
      ...sortable("key", "key"),
      render: (row) => row.key,
      className: "max-w-[170px] truncate text-zinc-100",
    },
    { ...sortable("share", "share"), render: (row) => <ProportionBar fraction={row.share} label={formatPercent(row.share)} />, className: "w-[90px]" },
    { ...sortable("self", "selfMs"), align: "right", render: (row) => formatMilliseconds(row.selfMs) },
    { ...sortable("calls", "calls"), align: "right", render: (row) => formatCount(row.calls) },
    { ...sortable("units", "units"), align: "right", render: (row) => formatCount(row.units) },
    {
      ...sortable("us/call", "microsecondsPerCall"),
      align: "right",
      render: (row) => formatOptional(row.microsecondsPerCall, formatMicroseconds),
    },
    {
      ...sortable("ns/unit", "nanosecondsPerUnit"),
      align: "right",
      render: (row) => formatOptional(row.nanosecondsPerUnit, formatNanosecondsPerUnit),
    },
  ];
}

function MatrixHeatmap({ matrix }: { matrix: BreakdownMatrix }) {
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-[10px] tabular-nums">
        <thead>
          <tr>
            <th />
            {matrix.columnKeys.map((columnKey) => (
              <th key={columnKey} className="max-w-[64px] truncate px-1 font-normal text-zinc-400" title={columnKey}>
                {columnKey}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rowKeys.map((rowKey, rowIndex) => (
            <tr key={rowKey}>
              <th className="max-w-[90px] truncate pr-1 text-left font-normal text-zinc-400" title={rowKey}>
                {rowKey}
              </th>
              {matrix.cells[rowIndex].map((cellMs, columnIndex) => (
                <td
                  key={matrix.columnKeys[columnIndex]}
                  className="h-5 min-w-[44px] border border-zinc-950 px-1 text-center text-zinc-100"
                  style={{
                    backgroundColor: `rgba(6, 182, 212, ${matrix.maxCellMs > 0 ? Math.sqrt(cellMs / matrix.maxCellMs) * 0.85 : 0})`,
                  }}
                  title={`${rowKey} x ${matrix.columnKeys[columnIndex]}: ${formatMilliseconds(cellMs)}`}
                >
                  {cellMs > 0 ? formatMilliseconds(cellMs).replace("ms", "") : ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-1 pt-1 text-zinc-500">
        Self ms per cell
        {matrix.hiddenRowCount + matrix.hiddenColumnCount > 0
          ? `, ${matrix.hiddenRowCount} rows and ${matrix.hiddenColumnCount} columns hidden`
          : ""}
        {matrix.uncrossedMs > 0 ? `, ${formatMilliseconds(matrix.uncrossedMs)} in non-cross keys` : ""}
      </div>
    </div>
  );
}

function BreakdownSection({ summary }: { summary: BreakdownSummary }) {
  const [sortKey, setSortKey] = useState<BreakdownSortKey>("selfMs");
  const [direction, setDirection] = useState<SortDirection>("descending");
  const rows = useMemo(() => buildBreakdownRows(summary, sortKey, direction), [summary, sortKey, direction]);
  const matrix = useMemo(() => buildBreakdownMatrix(summary), [summary]);
  const columns = buildColumns(sortKey, direction, (nextSortKey) => {
    if (nextSortKey === sortKey) setDirection(direction === "descending" ? "ascending" : "descending");
    else {
      setSortKey(nextSortKey);
      setDirection(nextSortKey === "key" ? "ascending" : "descending");
    }
  });
  return (
    <div>
      <div className="px-1 text-zinc-500">
        {formatMilliseconds(summary.totalSelfMs)} self, {formatCount(summary.totalUnits)} units
        {summary.droppedKeys > 0 ? `, ${summary.droppedKeys} keys folded into <other>` : ""}
      </div>
      <DataTable columns={columns} rows={rows} getKey={(row) => row.key} />
      {matrix ? (
        <>
          <SectionTitle>Matrix (row | column)</SectionTitle>
          <MatrixHeatmap matrix={matrix} />
        </>
      ) : null}
    </div>
  );
}

export function BreakdownsTab({ report }: { report: ProfileReport }) {
  const { breakdowns } = report.snapshot;
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  if (breakdowns.length === 0) return <div className="p-2 text-zinc-500">no breakdowns recorded yet</div>;

  const selected = breakdowns.find((summary) => breakdownLabel(summary) === selectedLabel) ?? breakdowns[0];
  return (
    <div>
      <div className="p-1">
        <select
          value={breakdownLabel(selected)}
          onChange={(event) => setSelectedLabel(event.target.value)}
          className="border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-zinc-100"
          aria-label="Breakdown dimension"
        >
          {breakdowns.map((summary) => (
            <option key={breakdownLabel(summary)} value={breakdownLabel(summary)}>
              {breakdownLabel(summary)}
            </option>
          ))}
        </select>
      </div>
      <BreakdownSection key={breakdownLabel(selected)} summary={selected} />
    </div>
  );
}
