# Game profiler

Measures every part of the voxel game and ranks the results as optimization targets: main-thread CPU, worker CPU, GPU time, time spent in WebGL calls, the cost of sending data to workers and to the GPU, and the size of everything that moves or is stored. Code lives in `src/applications/game/profiler/`.

Everything is a cheap early return while the profiler is disabled, so instrumentation stays in production code.

## Quick start

1. Open the game with `?profile=1` (or press `F4` in the game) to show the overlay and start recording.
2. For repeatable numbers, run the benchmark: `?benchmark=1`, the overlay's "Run benchmark" button, or `await window.__gameProfiler.runBenchmark()`.
3. Read the ranked targets in the overlay, or read `.profiles/latest-benchmark.md` (agents: start here).

`F3` is the separate debug overlay and is untouched.

## What is measured

| Area | Where it lands | Examples |
| --- | --- | --- |
| Main-thread CPU | `main.*` scopes, inclusive and self time | `main.frame.render`, `main.chunk.buildGeometry`, `main.interval.randomTick`, `main.react.commit.game` |
| Worker CPU | `worker.<pool>.<method>.exec` and per section | `worker.mesh.generateMesh.faceGeneration` |
| Work done | `work.<pool>.<method>.<counter>` | `facesEmitted`, `bfsNodesVisited`, `blocksGenerated`; the report divides time by units (ns per face, etc.) |
| GPU | `gpu.frame`, `gpu.pass.<sky,opaque,transparent,overlay>` | disjoint timer query, results arrive a few frames late |
| WebGL driver CPU | `gl.cpu.upload`, `.draw`, `.programCompile`, `.sync` | time inside `bufferData`, `texSubImage3D`, `drawElements` |
| Sending to GPU | `gl.upload.buffer`, `gl.upload.texture` bytes, `gpu.memory.*` | per-upload sizes, live buffer and texture memory |
| Sending to workers | `main.workerPost.*`, `transfer.*`, `bytes.*` | postMessage serialization, transit latency, payload bytes, estimated receive-side clone cost |
| Queues and pipelines | `queue.*`, `latency.*`, `chunk.pipeline.*`, `chunk.load.*` | wall-clock durations, not CPU |
| Memory and data sizes | `memory.*`, `meshes.*` gauges | chunk and light data, geometry bytes, bytes per vertex by attribute, JS heap |
| Browser | long tasks, long animation frames, event loop lag, GC estimates | Events tab |
| Network | `network.sent.<type>`, `network.received.<type>` | estimated packet bytes |

Frames are tracked as intervals between render callbacks. Every main-thread scope's self time inside an interval is added up as "busy"; the rest is "unattributed" (GC, compositor, vsync idle, GPU backpressure, unmeasured code). The 20 worst frames keep their top scopes, so a hitch can be traced to what ran in it.

## Overlay tabs

Targets (ranked list per group plus hints), Frames (interval, busy and GPU graphs, percentiles, worst frames), Main (scope tree), Workers (pool utilization, queue depth, per-method sections and efficiency), GPU (frame and pass time, draw calls, triangles, driver CPU, uploads), Transfers (bytes, serialization, latencies), Memory, Meshes (heaviest chunks, vertex distribution), Events.

Header buttons: Pause, Reset, Save to `.profiles`, Copy markdown, Download JSON, Run benchmark, and a "GPU pass split" checkbox. Pass split renders sky, opaque, transparent and overlay objects as separate passes so each gets its own GPU timer. It distorts CPU render time slightly, so leave it off unless GPU time is the question.

## Benchmark

Creates a throwaway in-memory world (default seed `20240607`) and runs four phases, each profiled on its own. The world is never saved or listed, and the game returns to the title screen afterwards.

1. `world-load`: cold start until every initial mesh is on screen, including the staged load timings.
2. `fly`: straight flight at 12 blocks per second so new chunks stream in (default 20 s).
3. `hover`: stationary, camera turning, steady-state rendering after a 3 s warmup (default 8 s).
4. `edit`: a burst of place and break edits, alternating stone and light sources (default 8 s).

Options: `runBenchmark({ seed, flySeconds, hoverSeconds, editSeconds })`. The `overall` report merges the phases: totals and counts are exact, percentiles are the worst phase's value.

## Agent workflow

Agents read data from disk or from the page; both give the same report.

- **From disk:** run the benchmark (or press "Save to .profiles"), then read `.profiles/latest-benchmark.md` or `.profiles/latest-snapshot.md`. The matching `.json` has the full data. Timestamped copies sit next to them. `.profiles/` is gitignored and written by the dev-only route `src/app/api/dev/game-profile` (returns 404 in production, fixed filenames, no client-chosen paths).
- **From the page** (Playwright or DevTools): `window.__gameProfiler` exposes `enable()`, `disable()`, `isEnabled()`, `reset(label?)`, `snapshot()`, `report()`, `markdown()`, `save(label?)`, `runBenchmark(options?)` and a live `settings` object. `runBenchmark` saves the result itself.

Markdown report layout: session info (GPU, viewport, DPR, cores, timer mode), frame-time table, top targets per group (rank, ms per second, frame budget share, bytes per second, mean, p95, max), hints with evidence, then appendices (all timers, worker methods, transfers, memory, worst frames, events).

Optimization loop: run the benchmark, pick the top target, change one thing, rerun with the same seed, compare the same rows.

## Hints

`hints.ts` derives evidence-based suggestions from the snapshot. Each cites the measured numbers. Current rules cover: worker payloads copied instead of transferred, GPU upload spikes, wide vertex data (bytes per vertex and per attribute), index buffers wider than needed, frame spikes and their top scope, high unattributed frame time, high draw call counts, GPU time over budget, Game component re-render rate, long tasks, JS heap allocation rate, and worker pools that are saturated or idle. Thresholds are named constants at the top of the file.

## Architecture

```
game code ──► profiler (singleton, main thread)
                 ├─ scopes / timers / bytes / counters / gauges (RollingStat each)
                 ├─ frame intervals + worst frames
                 └─ snapshot() ──► report.ts (targets) + hints.ts ──► overlay / markdown / JSON

workers ──► worker-recorder.ts ──► profile attached to each result message
WorkerPool ──► WorkerTaskRecord ──► worker-task-ingest.ts ──► profiler
renderer ──► profiled-render.ts ──► gl-instrumentation.ts + gpu-timer.ts ──► profiler
```

| File | Role |
| --- | --- |
| `profiler.ts`, `rolling-stat.ts`, `types.ts` | Core registry, streaming stats (percentiles, per-second rates), shared JSON shapes |
| `worker-recorder.ts` | Worker-side sections and counters. Workers import only this file from the profiler folder |
| `worker-task-ingest.ts` | Turns one worker task into metrics (queue wait, transfer latencies, sizes) |
| `profiled-render.ts`, `render-passes.ts` | Wraps `renderer.render`, optional pass split |
| `gl-instrumentation.ts` (+ `gl-*.ts`) | Patches the GL context instance only while enabled, tracks uploads and GPU memory |
| `gpu-timer.ts` | `EXT_disjoint_timer_query_webgl2` query pool, discards disjoint results |
| `browser-observers.ts` | Long tasks, long animation frames, event loop lag, heap sampling, structured clone calibration |
| `scene-memory-sampler.ts` | Per-second gauges for chunk, light and geometry memory |
| `report.ts`, `cost-model.ts`, `metric-names.ts`, `hints.ts`, `markdown-report.ts` | Ranking, efficiency lines, hints, markdown |
| `benchmark.ts` | Phase plan, flight path, edit targets, runner |
| `mount-overlay.tsx`, `ui/`, `global-api.ts`, `export-report.ts` | Overlay (own React root, so the game does not re-render), window API, dev-route client |

Worker protocol: the pool sends `profile: true` with a request. The worker returns `profile` (execution time, section self times, counters, epoch timestamps) with the result, then a small `resultTail` message carrying the time its `postMessage` took. Worker and main thread are compared on epoch time (`performance.timeOrigin + performance.now()`).

## Caveats

- `performance.now()` is clamped by the browser (about 100 microseconds, 5 when cross-origin isolated). Do not wrap sub-0.1 ms operations in a scope or section; count them with a counter.
- GPU timing needs `EXT_disjoint_timer_query_webgl2`. Without it only CPU-side render cost is available.
- Receive-side structured clone cost cannot be observed directly; it is estimated from bytes received and a startup calibration of `structuredClone` throughput.
- JS heap numbers are quantized by Chrome, so allocation rate and GC counts are estimates.
- "Frame budget share" assumes a 60 fps (16.7 ms) budget, even on 120 Hz displays.
- Scopes are synchronous. For work that spans awaits record a `latency` timer instead.
- The profiler's own overlay cost is reported as `main.profilerOverlay`.

## Adding instrumentation

Main thread:

```ts
import { profiler } from "./profiler";

const token = profiler.begin("main.feature.step");
try {
  doTheWork();
} finally {
  profiler.end(token);
}
```

Also available: `profiler.measure(name, fn)`, `profiler.addCounter(name, amount)` for units of work, `profiler.recordBytes(name, bytes)` for payload sizes, `profiler.sampleGauge(name, value, unit)` for levels, `profiler.recordTimer(name, ms, "latency")` for async durations, `profiler.noteFrame(key, value)` for per-frame facts.

In a worker:

```ts
import { workerSection, addWorkerCounter } from "../profiler/worker-recorder";

const faces = workerSection("faceGeneration", () => buildFaces());
addWorkerCounter("facesEmitted", faces);
```

Naming: dotted, starting with where the cost lands (`main.`, `worker.`, `queue.`, `latency.`, `transfer.`, `bytes.`, `gpu.`, `gl.`, `memory.`, `game.`, `network.`). Reports group by these prefixes.

## Tests

`bun test src/applications/game` runs the profiler tests (fake clock, fake WebGL, fake Worker; no GPU or network).
