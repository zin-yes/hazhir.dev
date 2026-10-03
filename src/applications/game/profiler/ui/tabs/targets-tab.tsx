import type { OptimizationHint, OptimizationTarget, ProfileReport } from "../../types";
import {
  formatBytesPerSecond,
  formatCount,
  formatMilliseconds,
  formatOptional,
} from "../format";
import { DataTable, SectionTitle, type Column } from "../table";

const GROUP_TITLES: Record<OptimizationTarget["group"], string> = {
  "main-thread": "Main thread (self time)",
  gpu: "GPU",
  "gl-driver": "GL driver CPU",
  transfer: "Transfers",
  worker: "Workers",
  memory: "Memory",
  light: "Light edits",
  latency: "Latency",
};

const SEVERITY_CLASSES: Record<OptimizationHint["severity"], string> = {
  high: "border-red-500 text-red-300",
  medium: "border-yellow-500 text-yellow-200",
  low: "border-zinc-600 text-zinc-300",
};

const TARGET_COLUMNS: Column<OptimizationTarget>[] = [
  { header: "#", render: (target) => target.rank, className: "text-zinc-500" },
  { header: "name", render: (target) => target.name, className: "max-w-[190px] truncate text-zinc-100" },
  { header: "ms/s", align: "right", render: (target) => formatOptional(target.millisecondsPerSecond, (value) => value.toFixed(1)) },
  { header: "%bud", align: "right", render: (target) => formatOptional(target.frameBudgetSharePercent, (value) => value.toFixed(1)) },
  { header: "B/s", align: "right", render: (target) => formatOptional(target.bytesPerSecond, formatBytesPerSecond) },
  { header: "n", align: "right", render: (target) => formatCount(target.count) },
  { header: "mean", align: "right", render: (target) => formatOptional(target.meanMs, formatMilliseconds) },
  { header: "p95", align: "right", render: (target) => formatOptional(target.p95Ms, formatMilliseconds) },
  { header: "max", align: "right", render: (target) => formatOptional(target.maxMs, formatMilliseconds) },
];

export function TargetsTab({ report }: { report: ProfileReport }) {
  return (
    <div>
      <SectionTitle>Hints</SectionTitle>
      {report.hints.length === 0 ? (
        <div className="px-2 py-1 text-zinc-500">no rule has fired yet</div>
      ) : (
        <div className="space-y-1 px-1">
          {report.hints.map((hint) => (
            <div key={hint.title} className={`border-l-2 bg-zinc-900 px-2 py-1 ${SEVERITY_CLASSES[hint.severity]}`}>
              <div className="font-bold">
                [{hint.severity}] {hint.title}
              </div>
              <div className="text-zinc-400">{hint.evidence}</div>
              <div className="text-zinc-300">{hint.suggestion}</div>
            </div>
          ))}
        </div>
      )}
      {(Object.keys(GROUP_TITLES) as OptimizationTarget["group"][]).map((group) => {
        const rows = report.targets.filter((target) => target.group === group);
        if (rows.length === 0) return null;
        return (
          <div key={group}>
            <SectionTitle>{GROUP_TITLES[group]}</SectionTitle>
            <DataTable columns={TARGET_COLUMNS} rows={rows} getKey={(target) => target.name} />
          </div>
        );
      })}
    </div>
  );
}
