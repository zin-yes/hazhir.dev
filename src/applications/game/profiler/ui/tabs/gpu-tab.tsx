import type { ByteSummary, GaugeSummary, ProfileReport, TimerSummary } from "../../types";
import { formatBytes, formatBytesPerSecond, formatMilliseconds } from "../format";
import { DataTable, SectionTitle, type Column } from "../table";

const TIMER_COLUMNS: Column<TimerSummary>[] = [
  { header: "name", render: (timer) => timer.name, className: "text-zinc-100" },
  { header: "ms/s", align: "right", render: (timer) => timer.recentPerSecondTotal.toFixed(1) },
  { header: "calls/s", align: "right", render: (timer) => timer.recentPerSecondCount.toFixed(1) },
  { header: "mean", align: "right", render: (timer) => formatMilliseconds(timer.mean) },
  { header: "p95", align: "right", render: (timer) => formatMilliseconds(timer.p95) },
  { header: "max", align: "right", render: (timer) => formatMilliseconds(timer.max) },
];

const GAUGE_COLUMNS: Column<GaugeSummary>[] = [
  { header: "gauge", render: (gauge) => gauge.name, className: "text-zinc-100" },
  { header: "now", align: "right", render: (gauge) => formatGauge(gauge, gauge.last) },
  { header: "mean", align: "right", render: (gauge) => formatGauge(gauge, gauge.mean) },
  { header: "max", align: "right", render: (gauge) => formatGauge(gauge, gauge.max) },
];

const UPLOAD_COLUMNS: Column<ByteSummary>[] = [
  { header: "upload", render: (meter) => meter.name, className: "text-zinc-100" },
  { header: "per second", align: "right", render: (meter) => formatBytesPerSecond(meter.recentPerSecondTotal) },
  { header: "calls/s", align: "right", render: (meter) => meter.recentPerSecondCount.toFixed(1) },
  { header: "mean", align: "right", render: (meter) => formatBytes(meter.mean) },
  { header: "max", align: "right", render: (meter) => formatBytes(meter.max) },
];

function formatGauge(gauge: GaugeSummary, value: number): string {
  return gauge.unit === "bytes" ? formatBytes(value) : value.toFixed(value >= 100 ? 0 : 1);
}

export function GpuTab({ report }: { report: ProfileReport }) {
  const { session, timers, gauges, bytes } = report.snapshot;
  const gpuTimers = timers.filter((timer) => timer.domain === "gpu");
  const glTimers = timers.filter((timer) => timer.domain === "gl");
  const gpuGauges = gauges.filter((gauge) => gauge.name.startsWith("gpu."));
  const uploads = bytes.filter((meter) => meter.name.startsWith("gl.upload."));
  return (
    <div>
      <div className="px-1 py-1 text-zinc-400">
        {session.gpuRenderer ?? "unknown GPU"} | timer: {session.gpuTimerMode}
        {session.gpuTimerSupported ? "" : " (GPU timing unavailable in this browser)"} | pass breakdown:{" "}
        {session.gpuPassBreakdownEnabled ? "on" : "off"}
      </div>
      <SectionTitle>GPU execution time</SectionTitle>
      <DataTable columns={TIMER_COLUMNS} rows={gpuTimers} getKey={(timer) => timer.name} emptyText="no GPU timings (unsupported or not recording)" />
      <SectionTitle>GL driver CPU time (main thread, inside render)</SectionTitle>
      <DataTable columns={TIMER_COLUMNS} rows={glTimers} getKey={(timer) => timer.name} />
      <SectionTitle>Draw load and GPU memory</SectionTitle>
      <DataTable columns={GAUGE_COLUMNS} rows={gpuGauges} getKey={(gauge) => gauge.name} />
      <SectionTitle>CPU to GPU uploads</SectionTitle>
      <DataTable columns={UPLOAD_COLUMNS} rows={uploads} getKey={(meter) => meter.name} />
    </div>
  );
}
