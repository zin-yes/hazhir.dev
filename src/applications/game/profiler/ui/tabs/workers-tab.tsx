import { buildEfficiencyLines, buildWorkerMethodRows, type EfficiencyLine, type WorkerMethodRow } from "../../metric-names";
import type { ProfileReport, TimerSummary, WorkerPoolSummary } from "../../types";
import { formatMilliseconds, formatNanosecondsPerUnit, formatOptional, formatPercent } from "../format";
import { DataTable, SectionTitle, UtilizationBar, type Column } from "../table";

const METHOD_COLUMNS: Column<WorkerMethodRow>[] = [
  { header: "pool.method", render: (row) => `${row.pool}.${row.method}`, className: "max-w-[150px] truncate text-zinc-100" },
  { header: "tasks/s", align: "right", render: (row) => formatOptional(row.exec, (timer) => timer.recentPerSecondCount.toFixed(1)) },
  { header: "exec", align: "right", render: (row) => formatOptional(row.exec, (timer) => formatMilliseconds(timer.mean)) },
  { header: "exec p95", align: "right", render: (row) => formatOptional(row.exec, (timer) => formatMilliseconds(timer.p95)) },
  { header: "queue", align: "right", render: (row) => formatOptional(row.queueWait, (timer) => formatMilliseconds(timer.mean)) },
  { header: "ser", align: "right", render: (row) => formatOptional(row.workerSerialize, (timer) => formatMilliseconds(timer.mean)) },
  { header: "round trip", align: "right", render: (row) => formatOptional(row.roundTrip, (timer) => formatMilliseconds(timer.mean)) },
];

const EFFICIENCY_COLUMNS: Column<EfficiencyLine>[] = [
  { header: "pool.method", render: (line) => `${line.pool}.${line.method}` },
  { header: "counter", render: (line) => line.counter },
  { header: "units/s", align: "right", render: (line) => line.unitsPerSecond.toFixed(0) },
  { header: "cost per unit", align: "right", render: (line) => formatNanosecondsPerUnit(line.nanosecondsPerUnit) },
];

interface SectionRow {
  key: string;
  method: string;
  section: string;
  timer: TimerSummary;
  shareOfExec: number | null;
}

const SECTION_COLUMNS: Column<SectionRow>[] = [
  { header: "section", render: (row) => `${row.method}.${row.section}`, className: "max-w-[230px] truncate text-zinc-100" },
  { header: "mean", align: "right", render: (row) => formatMilliseconds(row.timer.mean) },
  { header: "p95", align: "right", render: (row) => formatMilliseconds(row.timer.p95) },
  { header: "ms/s", align: "right", render: (row) => row.timer.recentPerSecondTotal.toFixed(1) },
  { header: "% of exec", align: "right", render: (row) => formatOptional(row.shareOfExec, formatPercent) },
];

function PoolRow({ pool }: { pool: WorkerPoolSummary }) {
  return (
    <div className="px-1 py-0.5">
      <UtilizationBar
        fraction={pool.utilization}
        label={`${pool.name}: ${formatPercent(pool.utilization)} of ${pool.workerCount} workers, ${pool.tasksCompleted} done${pool.tasksFailed > 0 ? `, ${pool.tasksFailed} failed` : ""}, queue ${pool.queueDepth ? `${pool.queueDepth.last.toFixed(0)} (max ${pool.queueDepth.max.toFixed(0)})` : "-"}`}
      />
    </div>
  );
}

export function WorkersTab({ report }: { report: ProfileReport }) {
  const rows = buildWorkerMethodRows(report.snapshot);
  const sectionRows: SectionRow[] = rows.flatMap((row) =>
    row.sections.map((section) => ({
      key: `${row.pool}.${row.method}.${section.name}`,
      method: `${row.pool}.${row.method}`,
      section: section.name,
      timer: section.timer,
      shareOfExec: row.exec && row.exec.total > 0 ? section.timer.total / row.exec.total : null,
    })),
  );
  return (
    <div>
      <SectionTitle>Pools</SectionTitle>
      {report.snapshot.workerPools.length === 0 ? (
        <div className="px-2 py-1 text-zinc-500">no pools registered</div>
      ) : (
        report.snapshot.workerPools.map((pool) => <PoolRow key={pool.name} pool={pool} />)
      )}
      <SectionTitle>Methods</SectionTitle>
      <DataTable columns={METHOD_COLUMNS} rows={rows} getKey={(row) => `${row.pool}.${row.method}`} />
      <SectionTitle>Sections inside tasks (self time)</SectionTitle>
      <DataTable
        columns={SECTION_COLUMNS}
        rows={sectionRows}
        getKey={(row) => row.key}
        emptyText="no worker sections recorded"
      />
      <SectionTitle>Cost per unit of work</SectionTitle>
      <DataTable
        columns={EFFICIENCY_COLUMNS}
        rows={buildEfficiencyLines(rows)}
        getKey={(line) => `${line.pool}.${line.method}.${line.counter}`}
        emptyText="no work counters recorded"
      />
    </div>
  );
}
