import type { BreakdownEntry, BreakdownSummary } from "../types";

export type BreakdownSortKey =
  | "key"
  | "share"
  | "selfMs"
  | "calls"
  | "units"
  | "microsecondsPerCall"
  | "nanosecondsPerUnit";

export type SortDirection = "ascending" | "descending";

export interface BreakdownRow {
  key: string;
  calls: number;
  selfMs: number;
  totalMs: number;
  units: number;
  /** Fraction of the dimension's total self time. */
  share: number;
  microsecondsPerCall: number | null;
  nanosecondsPerUnit: number | null;
}

export const CROSS_KEY_SEPARATOR = "|";

function toRow(entry: BreakdownEntry, totalSelfMs: number): BreakdownRow {
  return {
    key: entry.key,
    calls: entry.calls,
    selfMs: entry.selfMs,
    totalMs: entry.totalMs,
    units: entry.units,
    share: totalSelfMs > 0 ? entry.selfMs / totalSelfMs : 0,
    microsecondsPerCall: entry.calls > 0 ? (entry.selfMs * 1000) / entry.calls : null,
    nanosecondsPerUnit: entry.units > 0 ? (entry.selfMs * 1_000_000) / entry.units : null,
  };
}

function sortValue(row: BreakdownRow, sortKey: BreakdownSortKey): number | string | null {
  return sortKey === "key" ? row.key : row[sortKey];
}

/** Rows with a missing metric (null) always sort last regardless of direction. */
export function buildBreakdownRows(
  summary: BreakdownSummary,
  sortKey: BreakdownSortKey = "selfMs",
  direction: SortDirection = "descending",
): BreakdownRow[] {
  const directionSign = direction === "ascending" ? 1 : -1;
  return summary.entries
    .map((entry) => toRow(entry, summary.totalSelfMs))
    .sort((first, second) => {
      const firstValue = sortValue(first, sortKey);
      const secondValue = sortValue(second, sortKey);
      if (firstValue === null && secondValue === null) return 0;
      if (firstValue === null) return 1;
      if (secondValue === null) return -1;
      if (typeof firstValue === "string" || typeof secondValue === "string") {
        return directionSign * String(firstValue).localeCompare(String(secondValue));
      }
      return directionSign * (firstValue - secondValue);
    });
}

export interface BreakdownMatrix {
  rowKeys: string[];
  columnKeys: string[];
  /** cells[rowIndex][columnIndex] is self ms. */
  cells: number[][];
  maxCellMs: number;
  hiddenRowCount: number;
  hiddenColumnCount: number;
  /** Self time of entries that are not cross keys (such as the overflow entry). */
  uncrossedMs: number;
}

export function isCrossDimension(summary: BreakdownSummary): boolean {
  return summary.entries.some((entry) => entry.key.includes(CROSS_KEY_SEPARATOR));
}

function addToTotals(totals: Map<string, number>, key: string, amountMs: number) {
  totals.set(key, (totals.get(key) ?? 0) + amountMs);
}

function topKeysByTotal(totals: Map<string, number>, limit: number): string[] {
  return [...totals.entries()]
    .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]))
    .slice(0, limit)
    .map(([key]) => key);
}

/**
 * Builds a rows x columns self-time matrix from `row|column` keys, keeping the
 * rows and columns with the largest totals. Returns null when no key is a cross key.
 */
export function buildBreakdownMatrix(
  summary: BreakdownSummary,
  maxRows = 12,
  maxColumns = 10,
): BreakdownMatrix | null {
  const rowTotals = new Map<string, number>();
  const columnTotals = new Map<string, number>();
  const cellByCoordinates = new Map<string, number>();
  let uncrossedMs = 0;

  for (const entry of summary.entries) {
    const separatorIndex = entry.key.indexOf(CROSS_KEY_SEPARATOR);
    if (separatorIndex === -1) {
      uncrossedMs += entry.selfMs;
      continue;
    }
    const rowKey = entry.key.slice(0, separatorIndex);
    const columnKey = entry.key.slice(separatorIndex + 1);
    addToTotals(rowTotals, rowKey, entry.selfMs);
    addToTotals(columnTotals, columnKey, entry.selfMs);
    addToTotals(cellByCoordinates, entry.key, entry.selfMs);
  }
  if (rowTotals.size === 0) return null;

  const rowKeys = topKeysByTotal(rowTotals, maxRows);
  const columnKeys = topKeysByTotal(columnTotals, maxColumns);
  const cells = rowKeys.map((rowKey) =>
    columnKeys.map((columnKey) => cellByCoordinates.get(`${rowKey}${CROSS_KEY_SEPARATOR}${columnKey}`) ?? 0),
  );
  return {
    rowKeys,
    columnKeys,
    cells,
    maxCellMs: Math.max(...cells.flat(), 0),
    hiddenRowCount: rowTotals.size - rowKeys.length,
    hiddenColumnCount: columnTotals.size - columnKeys.length,
    uncrossedMs,
  };
}

export function breakdownLabel(summary: BreakdownSummary): string {
  return `${summary.dimension} (${summary.thread})`;
}
