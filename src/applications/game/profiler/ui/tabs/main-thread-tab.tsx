import { estimateSelfMillisecondsPerSecond } from "../../cost-model";
import type { ProfileReport } from "../../types";
import { formatCount, formatMilliseconds } from "../format";
import { buildScopeTree, type ScopeTreeRow } from "../scope-tree";
import { DataTable, SectionTitle, type Column } from "../table";

const COLUMNS: Column<ScopeTreeRow>[] = [
  {
    header: "scope",
    render: (row) => (
      <span style={{ paddingLeft: `${row.depth * 10}px` }} className="text-zinc-100">
        {row.timer.name}
      </span>
    ),
    className: "max-w-[210px] truncate",
  },
  { header: "self ms/s", align: "right", render: (row) => estimateSelfMillisecondsPerSecond(row.timer).toFixed(1) },
  { header: "calls/s", align: "right", render: (row) => row.timer.recentPerSecondCount.toFixed(1) },
  { header: "total", align: "right", render: (row) => formatMilliseconds(row.timer.total) },
  { header: "self", align: "right", render: (row) => formatMilliseconds(row.timer.selfTotal) },
  { header: "n", align: "right", render: (row) => formatCount(row.timer.count) },
  { header: "mean", align: "right", render: (row) => formatMilliseconds(row.timer.mean) },
  { header: "p95", align: "right", render: (row) => formatMilliseconds(row.timer.p95) },
  { header: "max", align: "right", render: (row) => formatMilliseconds(row.timer.max) },
];

export function MainThreadTab({ report }: { report: ProfileReport }) {
  const rows = buildScopeTree(report.snapshot.timers);
  return (
    <div>
      <SectionTitle>Main-thread scopes (nested under the scope they ran inside)</SectionTitle>
      <DataTable columns={COLUMNS} rows={rows} getKey={(row) => row.timer.name} />
    </div>
  );
}
