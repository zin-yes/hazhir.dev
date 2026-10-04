import type { SamplingSummary } from "../types";
import { formatCount, formatMilliseconds, formatPercent } from "./format";
import { DataTable, SectionTitle, type Column } from "./table";

type SamplingFunction = SamplingSummary["topSelf"][number];

const STACK_LIMIT = 5;

/** Last path segment of a script URL, so the column stays readable. */
export function shortResourceName(resource: string): string {
  if (!resource) return "(native)";
  const withoutQuery = resource.split("?")[0];
  return withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1) || withoutQuery;
}

function buildColumns(totalSamples: number): Column<SamplingFunction>[] {
  return [
    {
      header: "function",
      render: (entry) => entry.functionName || "(anonymous)",
      className: "max-w-[200px] truncate text-zinc-100",
    },
    {
      header: "location",
      render: (entry) => `${shortResourceName(entry.resource)}:${entry.line}`,
      className: "max-w-[150px] truncate text-zinc-500",
    },
    { header: "self", align: "right", render: (entry) => formatMilliseconds(entry.selfMs) },
    { header: "share", align: "right", render: (entry) => formatPercent(totalSamples > 0 ? entry.samples / totalSamples : 0) },
    { header: "samples", align: "right", render: (entry) => formatCount(entry.samples) },
  ];
}

export function SamplingPanel({ sampling }: { sampling: SamplingSummary | null }) {
  if (!sampling) return null;
  return (
    <div>
      <SectionTitle>
        Sampling profiler: {formatCount(sampling.totalSamples)} samples every {sampling.sampleIntervalMs}ms over{" "}
        {formatMilliseconds(sampling.durationMs)} (main thread)
      </SectionTitle>
      <DataTable
        columns={buildColumns(sampling.totalSamples)}
        rows={sampling.topSelf}
        getKey={(entry) => `${entry.functionName}@${entry.resource}:${entry.line}`}
        emptyText="no samples yet"
      />
      {sampling.topStacks.slice(0, STACK_LIMIT).map((stack) => (
        <div key={stack.frames.join(">")} className="truncate px-1 py-0.5 text-zinc-500" title={stack.frames.join(" > ")}>
          <span className="text-zinc-300">{formatCount(stack.samples)}</span> {stack.frames.join(" > ")}
        </div>
      ))}
    </div>
  );
}
