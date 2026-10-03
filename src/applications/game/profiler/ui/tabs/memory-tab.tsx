import type { GaugeSummary, ProfileReport } from "../../types";
import { formatBytes } from "../format";
import { DataTable, SectionTitle, StackedBar, type Column, type StackedSegment } from "../table";

const ATTRIBUTE_COLORS = [
  "bg-sky-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-fuchsia-500",
  "bg-rose-500",
  "bg-indigo-500",
  "bg-teal-500",
  "bg-orange-500",
];

const COLUMNS: Column<GaugeSummary>[] = [
  { header: "gauge", render: (gauge) => gauge.name, className: "text-zinc-100" },
  { header: "now", align: "right", render: (gauge) => formatGaugeValue(gauge, gauge.last) },
  { header: "min", align: "right", render: (gauge) => formatGaugeValue(gauge, gauge.min) },
  { header: "mean", align: "right", render: (gauge) => formatGaugeValue(gauge, gauge.mean) },
  { header: "max", align: "right", render: (gauge) => formatGaugeValue(gauge, gauge.max) },
];

function formatGaugeValue(gauge: GaugeSummary, value: number): string {
  return gauge.unit === "bytes" ? formatBytes(value) : `${value.toFixed(value >= 100 ? 0 : 1)} ${gauge.unit}`;
}

export function MemoryTab({ report }: { report: ProfileReport }) {
  const { gauges, meshes } = report.snapshot;
  const memoryGauges = gauges
    .filter((gauge) => gauge.unit === "bytes" || gauge.name.startsWith("memory."))
    .sort((first, second) => second.last - first.last);
  const segments: StackedSegment[] = Object.entries(meshes.bytesPerVertexByAttribute)
    .sort((first, second) => second[1] - first[1])
    .map(([attribute, bytesPerVertex], index) => ({
      label: attribute,
      value: bytesPerVertex,
      colorClass: ATTRIBUTE_COLORS[index % ATTRIBUTE_COLORS.length],
    }));
  return (
    <div>
      <SectionTitle>Sizes (largest first)</SectionTitle>
      <DataTable columns={COLUMNS} rows={memoryGauges} getKey={(gauge) => gauge.name} />
      <SectionTitle>
        Bytes per vertex by attribute ({meshes.bytesPerVertex.toFixed(1)} B/vertex, {formatBytes(meshes.liveBytes)} live)
      </SectionTitle>
      <StackedBar segments={segments} formatValue={(value) => `${value.toFixed(1)}B`} />
    </div>
  );
}
