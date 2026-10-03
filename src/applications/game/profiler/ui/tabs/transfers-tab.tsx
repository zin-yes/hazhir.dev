import { estimateReceiveCloneMillisecondsPerSecond, estimateSelfMillisecondsPerSecond } from "../../cost-model";
import { buildWorkerMethodRows, type WorkerMethodRow } from "../../metric-names";
import type { ProfileReport } from "../../types";
import { formatBytes, formatBytesPerSecond, formatMilliseconds, formatOptional } from "../format";
import { DataTable, SectionTitle, type Column } from "../table";

function buildColumns(cloneMegabytesPerSecond: number | null): Column<WorkerMethodRow>[] {
  return [
    { header: "pool.method", render: (row) => `${row.pool}.${row.method}`, className: "max-w-[150px] truncate text-zinc-100" },
    { header: "param size", align: "right", render: (row) => formatOptional(row.paramBytes, (meter) => formatBytes(meter.mean)) },
    { header: "result size", align: "right", render: (row) => formatOptional(row.resultBytes, (meter) => formatBytes(meter.mean)) },
    {
      header: "bytes/s",
      align: "right",
      render: (row) =>
        formatBytesPerSecond((row.paramBytes?.recentPerSecondTotal ?? 0) + (row.resultBytes?.recentPerSecondTotal ?? 0)),
    },
    { header: "post ms/s", align: "right", render: (row) => formatOptional(row.mainPost, (timer) => estimateSelfMillisecondsPerSecond(timer).toFixed(1)) },
    {
      header: "recv ms/s*",
      align: "right",
      render: (row) =>
        formatOptional(
          estimateReceiveCloneMillisecondsPerSecond(row.resultBytes?.recentPerSecondTotal ?? 0, cloneMegabytesPerSecond),
          (value) => value.toFixed(1),
        ),
    },
    { header: "worker ser", align: "right", render: (row) => formatOptional(row.workerSerialize, (timer) => formatMilliseconds(timer.mean)) },
    { header: "to worker", align: "right", render: (row) => formatOptional(row.toWorker, (timer) => formatMilliseconds(timer.mean)) },
    { header: "to main", align: "right", render: (row) => formatOptional(row.toMain, (timer) => formatMilliseconds(timer.mean)) },
  ];
}

export function TransfersTab({ report }: { report: ProfileReport }) {
  const { session } = report.snapshot;
  const rows = buildWorkerMethodRows(report.snapshot).filter((row) => row.paramBytes || row.resultBytes);
  return (
    <div>
      <div className="px-1 py-1 text-zinc-400">
        structuredClone throughput:{" "}
        {formatOptional(session.structuredCloneMegabytesPerSecond, (value) => `${value.toFixed(0)} MB/s`)}. Columns marked * are
        estimated from that calibration because the browser deserializes before onmessage runs. All payloads here are copied, not
        transferred, unless the byte counts drop to zero.
      </div>
      <SectionTitle>Worker messages (main thread to worker and back)</SectionTitle>
      <DataTable
        columns={buildColumns(session.structuredCloneMegabytesPerSecond)}
        rows={rows}
        getKey={(row) => `${row.pool}.${row.method}`}
        emptyText="no worker traffic recorded"
      />
    </div>
  );
}
