import type { BrowserEvent, ProfileReport } from "../../types";
import { formatMilliseconds } from "../format";
import { DataTable, SectionTitle, type Column } from "../table";

const COLUMNS: Column<BrowserEvent & { key: string }>[] = [
  { header: "at", render: (event) => `${(event.atMs / 1000).toFixed(1)}s` },
  { header: "kind", render: (event) => event.kind, className: "text-zinc-100" },
  { header: "duration", align: "right", render: (event) => formatMilliseconds(event.durationMs) },
  { header: "detail", render: (event) => event.detail, className: "max-w-[260px] truncate" },
];

export function EventsTab({ report }: { report: ProfileReport }) {
  const rows = [...report.snapshot.events]
    .reverse()
    .map((event, index) => ({ ...event, key: `${event.atMs}-${index}` }));
  return (
    <div>
      <SectionTitle>Long tasks, long animation frames, event loop lag, GC estimates (newest first)</SectionTitle>
      <DataTable columns={COLUMNS} rows={rows} getKey={(event) => event.key} emptyText="no browser events recorded" />
    </div>
  );
}
