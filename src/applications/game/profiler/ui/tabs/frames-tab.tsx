import type { FrameSummary, ProfileReport } from "../../types";
import { formatMilliseconds, formatOptional } from "../format";
import { DataTable, SectionTitle, type Column } from "../table";

const CHART_WIDTH = 480;
const CHART_HEIGHT = 90;
const CHART_CAP_MILLISECONDS = 66;
const GOOD_FRAME_MS = 17;
const OKAY_FRAME_MS = 34;

function barColor(intervalMs: number): string {
  if (intervalMs <= GOOD_FRAME_MS) return "#22c55e";
  if (intervalMs <= OKAY_FRAME_MS) return "#eab308";
  return "#ef4444";
}

function heightFor(milliseconds: number): number {
  return (Math.min(CHART_CAP_MILLISECONDS, milliseconds) / CHART_CAP_MILLISECONDS) * CHART_HEIGHT;
}

function FrameChart({ frames }: { frames: FrameSummary }) {
  const count = frames.recentIntervalsMs.length;
  if (count === 0) return <div className="px-2 py-1 text-zinc-500">no frames recorded yet</div>;
  const barWidth = CHART_WIDTH / Math.max(count, 120);
  const gpuPoints = frames.recentGpuMs
    .map((gpu, index) =>
      gpu === null ? null : `${(index * barWidth + barWidth / 2).toFixed(1)},${(CHART_HEIGHT - heightFor(gpu)).toFixed(1)}`,
    )
    .filter((point): point is string => point !== null)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="w-full bg-zinc-900" role="img" aria-label="Recent frame times">
      {frames.recentIntervalsMs.map((interval, index) => (
        <rect
          key={index}
          x={index * barWidth}
          y={CHART_HEIGHT - heightFor(interval)}
          width={Math.max(0.5, barWidth - 0.3)}
          height={heightFor(interval)}
          fill={barColor(interval)}
          opacity={0.45}
        />
      ))}
      {frames.recentBusyMs.map((busy, index) => (
        <rect
          key={`busy-${index}`}
          x={index * barWidth}
          y={CHART_HEIGHT - heightFor(busy)}
          width={Math.max(0.5, barWidth - 0.3)}
          height={heightFor(busy)}
          fill="#38bdf8"
        />
      ))}
      {gpuPoints && <polyline points={gpuPoints} fill="none" stroke="#f0abfc" strokeWidth={1} />}
      <line x1={0} x2={CHART_WIDTH} y1={CHART_HEIGHT - heightFor(16.7)} y2={CHART_HEIGHT - heightFor(16.7)} stroke="#a1a1aa" strokeDasharray="3 3" strokeWidth={0.5} />
      <line x1={0} x2={CHART_WIDTH} y1={CHART_HEIGHT - heightFor(33.3)} y2={CHART_HEIGHT - heightFor(33.3)} stroke="#a1a1aa" strokeDasharray="3 3" strokeWidth={0.5} />
    </svg>
  );
}

interface DistributionRow {
  label: string;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

const DISTRIBUTION_COLUMNS: Column<DistributionRow>[] = [
  { header: "metric", render: (row) => row.label },
  { header: "mean", align: "right", render: (row) => formatMilliseconds(row.mean) },
  { header: "p50", align: "right", render: (row) => formatMilliseconds(row.p50) },
  { header: "p95", align: "right", render: (row) => formatMilliseconds(row.p95) },
  { header: "p99", align: "right", render: (row) => formatMilliseconds(row.p99) },
  { header: "max", align: "right", render: (row) => formatMilliseconds(row.max) },
];

export function FramesTab({ report }: { report: ProfileReport }) {
  const frames = report.snapshot.frames;
  const meanFps = frames.intervalMs.mean > 0 ? 1000 / frames.intervalMs.mean : 0;
  const rows: DistributionRow[] = [
    { label: "frame interval", ...frames.intervalMs },
    { label: "main busy", ...frames.busyMs },
    { label: "gpu", ...frames.gpuMs },
  ];
  return (
    <div>
      <SectionTitle>Recent frames (bars: interval, blue: main busy, pink line: gpu)</SectionTitle>
      <FrameChart frames={frames} />
      <div className="px-1 py-1 text-zinc-400">
        {meanFps.toFixed(1)} fps mean over {frames.count} frames. Over 16.7ms: {frames.framesOver16Point7Ms}, over 33ms: {frames.framesOver33Ms}, over 50ms: {frames.framesOver50Ms}.
      </div>
      <DataTable columns={DISTRIBUTION_COLUMNS} rows={rows} getKey={(row) => row.label} />
      <SectionTitle>Worst frames</SectionTitle>
      {frames.worst.length === 0 ? (
        <div className="px-2 py-1 text-zinc-500">no frame over 20ms yet</div>
      ) : (
        <div className="space-y-1 px-1">
          {frames.worst.map((frame) => (
            <div key={frame.frameId} className="bg-zinc-900 px-2 py-1">
              <div>
                <span className="text-red-300">{formatMilliseconds(frame.intervalMs)}</span> at {(frame.atMs / 1000).toFixed(1)}s, busy{" "}
                {formatMilliseconds(frame.busyMs)}, unattributed {formatMilliseconds(frame.unattributedMs)}, gpu{" "}
                {formatOptional(frame.gpuMs, formatMilliseconds)}
              </div>
              <div className="text-zinc-400">
                {frame.topScopes.slice(0, 5).map((scope) => `${scope.name} ${formatMilliseconds(scope.selfMs)}`).join(" | ")}
              </div>
              {Object.keys(frame.notes).length > 0 && (
                <div className="text-zinc-500">
                  {Object.entries(frame.notes).map(([key, value]) => `${key}=${value}`).join(" ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
