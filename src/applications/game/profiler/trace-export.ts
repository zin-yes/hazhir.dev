import type { ProfileSnapshot } from "./types";

/**
 * Converts a snapshot's captured spans into Chrome Trace Event JSON, which
 * Perfetto (ui.perfetto.dev), chrome://tracing and speedscope all open.
 * One thread per track; the worst frames are drawn as async slices on their
 * own row so a hitch lines up with the scopes and worker tasks around it.
 */

const PROCESS_ID = 1;
const MICROSECONDS_PER_MILLISECOND = 1000;
const FRAME_CATEGORY = "frame";
const SPAN_CATEGORY = "profiler";

export interface TraceEvent {
  name: string;
  ph: "X" | "M" | "b" | "e";
  pid: number;
  tid: number;
  ts?: number;
  dur?: number;
  cat?: string;
  id?: string;
  args?: { [key: string]: unknown };
}

export function buildTraceEvents(snapshot: ProfileSnapshot): TraceEvent[] {
  const events: TraceEvent[] = [
    { name: "process_name", ph: "M", pid: PROCESS_ID, tid: 0, args: { name: "hazhir.dev game" } },
  ];
  const timedEvents: TraceEvent[] = [];
  const tracks = snapshot.trace?.tracks ?? [];

  tracks.forEach((track, trackIndex) => {
    const threadId = trackIndex + 1;
    events.push(
      { name: "thread_name", ph: "M", pid: PROCESS_ID, tid: threadId, args: { name: track.name } },
      { name: "thread_sort_index", ph: "M", pid: PROCESS_ID, tid: threadId, args: { sort_index: trackIndex } },
    );
    const orderedSpans = [...track.spans].sort(
      (first, second) => first.startMs - second.startMs || second.durationMs - first.durationMs,
    );
    for (const span of orderedSpans) {
      timedEvents.push({
        name: span.name,
        ph: "X",
        cat: SPAN_CATEGORY,
        pid: PROCESS_ID,
        tid: threadId,
        ts: span.startMs * MICROSECONDS_PER_MILLISECOND,
        dur: span.durationMs * MICROSECONDS_PER_MILLISECOND,
        args: { depth: span.depth },
      });
    }
  });

  const frameThreadId = tracks.length + 1;
  if (snapshot.frames.worst.length > 0) {
    events.push({
      name: "thread_name",
      ph: "M",
      pid: PROCESS_ID,
      tid: frameThreadId,
      args: { name: "worst frames" },
    });
  }

  // Frame times are relative to when profiling started, span times to the trace origin
  // (epoch ms); both are placed on the epoch clock via the capture time.
  const profilingStartedAtEpochMs = Date.parse(snapshot.capturedAtIso) - snapshot.profiledForMs;
  const frameOffsetMs = profilingStartedAtEpochMs - (snapshot.trace?.originEpochMs ?? profilingStartedAtEpochMs);
  for (const frame of snapshot.frames.worst) {
    const endMs = frame.atMs + frameOffsetMs;
    const id = `frame-${frame.frameId}`;
    const name = `frame ${frame.frameId} (${frame.intervalMs.toFixed(1)}ms)`;
    const common = { name, cat: FRAME_CATEGORY, pid: PROCESS_ID, tid: frameThreadId, id };
    timedEvents.push(
      {
        ...common,
        ph: "b",
        ts: (endMs - frame.intervalMs) * MICROSECONDS_PER_MILLISECOND,
        args: {
          intervalMs: frame.intervalMs,
          busyMs: frame.busyMs,
          unattributedMs: frame.unattributedMs,
          gpuMs: frame.gpuMs,
          topScopes: frame.topScopes,
          notes: frame.notes,
        },
      },
      { ...common, ph: "e", ts: endMs * MICROSECONDS_PER_MILLISECOND },
    );
  }

  const earliestTimestamp = timedEvents.reduce((earliest, event) => Math.min(earliest, event.ts ?? 0), 0);
  for (const event of timedEvents) event.ts = (event.ts ?? 0) - earliestTimestamp;
  return [...events, ...timedEvents];
}

export function exportTrace(snapshot: ProfileSnapshot): string {
  return JSON.stringify({
    traceEvents: buildTraceEvents(snapshot),
    displayTimeUnit: "ms",
    metadata: {
      source: "hazhir.dev game profiler",
      label: snapshot.label,
      capturedAtIso: snapshot.capturedAtIso,
      droppedSpans: snapshot.trace?.droppedSpans ?? 0,
    },
  });
}
