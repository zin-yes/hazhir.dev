import type { ReactNode } from "react";

export interface Column<Row> {
  header: string;
  align?: "left" | "right";
  render: (row: Row) => ReactNode;
  /** Extra classes for the cell, for example a fixed or truncating width. */
  className?: string;
  /** Makes the header a button, for sortable columns. */
  onHeaderClick?: () => void;
  /** Shown after the header text, for example a sort arrow. */
  headerSuffix?: string;
}

interface DataTableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  getKey: (row: Row, index: number) => string;
  emptyText?: string;
}

export function DataTable<Row>({ columns, rows, getKey, emptyText = "no data yet" }: DataTableProps<Row>) {
  if (rows.length === 0) return <div className="px-2 py-1 text-zinc-500">{emptyText}</div>;
  return (
    <table className="w-full border-collapse text-[11px] tabular-nums">
      <thead>
        <tr className="text-zinc-500">
          {columns.map((column) => (
            <th
              key={column.header}
              className={`px-1 py-0.5 font-normal ${column.align === "right" ? "text-right" : "text-left"}`}
            >
              {column.onHeaderClick ? (
                <button className="hover:text-zinc-200" onClick={column.onHeaderClick}>
                  {column.header}
                  {column.headerSuffix ?? ""}
                </button>
              ) : (
                column.header
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={getKey(row, index)} className="border-t border-zinc-800 hover:bg-zinc-900">
            {columns.map((column) => (
              <td
                key={column.header}
                className={`px-1 py-0.5 ${column.align === "right" ? "text-right" : "text-left"} ${column.className ?? ""}`}
              >
                {column.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="mt-3 mb-1 px-1 text-[10px] uppercase tracking-wider text-cyan-400">{children}</div>;
}

export function UtilizationBar({ fraction, label }: { fraction: number; label: string }) {
  const clamped = Math.max(0, Math.min(1, fraction));
  const color = clamped > 0.85 ? "bg-red-500" : clamped > 0.5 ? "bg-yellow-500" : "bg-green-500";
  return (
    <div className="relative h-4 w-full bg-zinc-800">
      <div className={`h-full ${color}`} style={{ width: `${clamped * 100}%` }} />
      <div className="absolute inset-0 px-1 leading-4 text-zinc-100">{label}</div>
    </div>
  );
}

export interface StackedSegment {
  label: string;
  value: number;
  colorClass: string;
}

export function StackedBar({ segments, formatValue }: { segments: StackedSegment[]; formatValue: (value: number) => string }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0) return <div className="px-2 py-1 text-zinc-500">no data yet</div>;
  return (
    <div>
      <div className="flex h-4 w-full overflow-hidden bg-zinc-800">
        {segments.map((segment) => (
          <div
            key={segment.label}
            className={segment.colorClass}
            style={{ width: `${(segment.value / total) * 100}%` }}
            title={`${segment.label}: ${formatValue(segment.value)}`}
          />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 px-1">
        {segments.map((segment) => (
          <span key={segment.label} className="flex items-center gap-1">
            <span className={`inline-block h-2 w-2 ${segment.colorClass}`} />
            {segment.label} {formatValue(segment.value)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ProportionBar({
  fraction,
  label,
  colorClass = "bg-cyan-600",
}: {
  fraction: number;
  label?: string;
  colorClass?: string;
}) {
  const clamped = Math.max(0, Math.min(1, fraction));
  return (
    <div className="relative h-3 w-full min-w-[40px] bg-zinc-800">
      <div className={`h-full ${colorClass}`} style={{ width: `${clamped * 100}%` }} />
      {label ? <div className="absolute inset-0 px-1 leading-3 text-zinc-100">{label}</div> : null}
    </div>
  );
}
