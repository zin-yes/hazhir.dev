import { buildLightEditRows, type LightEditRow } from "../../light-report";
import type { ProfileReport } from "../../types";
import { formatMilliseconds, formatOptional } from "../format";
import { DataTable, SectionTitle, type Column } from "../table";

const EDIT_COLUMNS: Column<LightEditRow>[] = [
  { header: "edit", render: (row) => row.kind, className: "text-zinc-100" },
  { header: "n", align: "right", render: (row) => row.total.count },
  {
    header: "total mean",
    align: "right",
    render: (row) => formatMilliseconds(row.total.mean),
  },
  {
    header: "p95",
    align: "right",
    render: (row) => formatMilliseconds(row.total.p95),
  },
  {
    header: "max",
    align: "right",
    render: (row) => formatMilliseconds(row.total.max),
  },
  {
    header: "first mesh",
    align: "right",
    render: (row) =>
      formatOptional(row.firstMesh, (timer) => formatMilliseconds(timer.mean)),
  },
  {
    header: "relight",
    align: "right",
    render: (row) =>
      formatOptional(row.relight, (timer) => formatMilliseconds(timer.mean)),
  },
  {
    header: "remesh",
    align: "right",
    render: (row) =>
      formatOptional(row.remesh, (timer) => formatMilliseconds(timer.mean)),
  },
];

export function LightTab({ report }: { report: ProfileReport }) {
  const rows = buildLightEditRows(report.snapshot);
  return (
    <div>
      <div className="px-1 py-1 text-zinc-400">
        Wall clock from a block edit to the last affected chunk mesh on screen.
        Run the benchmark (or place and break light blocks) to fill this in.
      </div>
      <SectionTitle>Edits, click to pixels</SectionTitle>
      <DataTable
        columns={EDIT_COLUMNS}
        rows={rows}
        getKey={(row) => row.kind}
        emptyText="no block edits recorded"
      />
      {rows.map((row) => (
        <div key={row.kind}>
          <SectionTitle>{row.kind} stages</SectionTitle>
          <DataTable
            columns={[
              {
                header: "stage",
                render: (stage) => stage.name,
                className: "text-zinc-100",
              },
              {
                header: "mean",
                align: "right",
                render: (stage) => formatMilliseconds(stage.timer.mean),
              },
              {
                header: "p95",
                align: "right",
                render: (stage) => formatMilliseconds(stage.timer.p95),
              },
              {
                header: "max",
                align: "right",
                render: (stage) => formatMilliseconds(stage.timer.max),
              },
              {
                header: "share",
                align: "right",
                render: (stage) => `${stage.shareOfTotalPercent.toFixed(0)}%`,
              },
            ]}
            rows={row.stages}
            getKey={(stage) => stage.name}
          />
        </div>
      ))}
    </div>
  );
}
