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
| GPU | `gpu.frame`, `gpu.pass.<label>`, `gpu.passDraws.<label>.calls/.triangles` | disjoint timer query, results arrive a few frames late. `gpu.frame` is the sum of every pass in the frame (scene, shadow cascades, water translucent, bloom, clouds, world snapshot). The scene is `gpu.pass.scene` (far terrain, sky, chunks); the pass breakdown splits it into `lod`, `sky`, `opaque`, `transparent`, `overlay` |
| WebGL driver CPU | `gl.cpu.upload`, `.draw`, `.programCompile`, `.sync` | time inside `bufferData`, `texSubImage3D`, `drawElements` |
| Sending to GPU | `gl.upload.buffer`, `gl.upload.texture` bytes, `gpu.memory.*` | per-upload sizes, live buffer and texture memory |
| Sending to workers | `main.workerPost.*`, `transfer.*`, `bytes.*` | postMessage serialization, transit latency, payload bytes, estimated receive-side clone cost |
| Queues and pipelines | `queue.*`, `latency.*`, `chunk.pipeline.*`, `chunk.load.*` | wall-clock durations, not CPU |
| Memory and data sizes | `memory.*`, `meshes.*` gauges | chunk and light data, geometry bytes, bytes per vertex by attribute, JS heap |
| Browser | long tasks, long animation frames, event loop lag and drift, GC estimates, input latency (`browser.input.*`: delay, processing, presentation, per event name), resource loads (`browser.resource.<kind>`, `bytes.resource.*`), tab visibility, devicePixelRatio, JS heap limit | Events tab |
| Render passes | `gpu.pass.shadowCascade0..2`, `bloomDown0..4`, `bloomUp0..3`, `bloomComposite`, `godRays`, `worldSnapshotCopy`, `cloudDepthCapture`, `cloudMarch`, `cloudComposite`, `waterTranslucent` | each also has CPU `main.render.<label>`; the GPU tab and the markdown "GPU passes" table rank them with draws and triangles per pass |
| Settings and display | `session.game` (shadow quality, bloom, water reflections, far terrain, FOV, volume shape), `gpu.drawingBufferPixels` | refreshed every second so every benchmark phase records the settings it ran with |
| Network | `network.sent.<type>`, `network.received.<type>` | estimated packet bytes |

### Coverage by area

Each area documents its own metric names next to its code; this is where to look.

| Area | Prefixes | Notes |
| --- | --- | --- |
| Shadows, post-processing, sky, clouds | `main.shadow.*`, `main.post.*`, `main.sky.*`, `game.shadow.*`, `game.post.*`, `game.sky.*`, `memory.shadowMaps.*`, `memory.post.*`, `memory.sky.*` | cascade redraw decisions and why (`game.shadow.cascade.decision.*`), render target memory, cloud density work |
| Chunk streaming, scheduling, edits | `main.streaming.*`, `main.scheduler.*`, `main.affinity.*`, `main.edit.*`, `game.streaming.*`, `game.scheduler.*`, `game.edit.*`, `queue.scheduler.*` | see `world/README.md` and `edits/README.md` |
| Mesh, light and region workers | `worker.mesh.*`, `worker.lighting.*`, `work.<pool>.<method>.*`, dimensions `mesh.faceDirection`, `mesh.vertexAttribute`, `light.channel` | sampled sections for hot loops; AO and packing are counters only |
| Worker pools and chunk geometry | `game.pool.<pool>.*`, `pool.<pool>.*`, `bytes.pool.*`, `main.chunk.buildGeometry.*`, `game.geometry.*`, `memory.geometry.*` | dispatch kind (free, affinity hit, steal), spin-up, payload bytes |
| Far terrain (LOD) | `main.lod.*`, `game.lod.*`, `bytes.lod.*`, `memory.lod.*`, `queue.lod.*`, `latency.lod.*`, dimension `lod.level` | see `lod/README.md` |
| Worldgen | `work.generation.generateChunk.*`, `coldStart.*` | slot counters in `engine/profiling/hot-counters.ts`; the headless probe report has a "Worldgen detail" section |
| UI, input, persistence, network, simulation | `main.ui.*`, `game.ui.*`, `main.settings.*`, `main.worldStore.*`, `game.worldStore.*`, `game.network.*`, `game.input.*`, `game.physics.*`, `game.water.*`, `game.randomTick.*` | per UI surface, per packet type, per input kind, per block |

Frames are tracked as intervals between render callbacks. Every main-thread scope's self time inside an interval is added up as "busy"; the rest is "unattributed" (GC, compositor, vsync idle, GPU backpressure, unmeasured code). The 20 worst frames keep their top scopes, so a hitch can be traced to what ran in it.

## Overlay tabs

Targets (ranked list per group plus hints), Frames (interval, busy and GPU graphs, percentiles, worst frames), Main (scope tree), Workers (pool utilization, queue depth, per-method sections and efficiency), GPU (frame and pass time, draw calls, triangles, driver CPU, uploads), Transfers (bytes, serialization, latencies), Memory, Meshes (heaviest chunks, vertex distribution), Events.

### Far terrain (LOD) metrics

The LOD pass draws before the main scene inside `main.frame.render` (`main.lod.update`, `main.lod.render`); its draws count in `gpu.drawCalls` and `gpu.triangles`. The `lod` worker pool (method `buildLodTile`) shows in the Workers tab. `window.__voxelWorld.lodStats()` returns drawn, missing and cached tiles, cache and real data bytes, and the first horizon and full detail times. The rest of the LOD metrics are listed in `lod/README.md`.

### Chunk pipeline metrics

Streaming, lighting and meshing run through `world/chunk-pipeline.ts` (see `world/README.md`).

- Latency from the moment a chunk was requested: `chunk.pipeline.generate`, `chunk.pipeline.light`, `chunk.pipeline.total` (first mesh on screen); `chunk.load.total` is the start area; `chunk.pipeline.edit` is an edit until its last rebuilt mesh.
- Worker methods: `generation.generateChunkColumn` (one call per column), `lighting.lightRegionFromSlabs` (one call per column), `mesh.generateMesh`.
- Counters: `game.chunks.generated`, `game.chunks.lit`, `game.chunks.unloaded`, `game.chunks.skippedAboveSurface`, `game.mesh.builds`, `game.mesh.skippedUniform` (all air or buried, no worker call), `game.mesh.staleDropped`, `game.light.regionRetries` (light thrown away because an edit landed meanwhile), `game.streaming.plannerOperations`. Builds per chunk on screen is `game.mesh.builds / game.chunks.lit`.
- Bytes and gauges: `bytes.light.surroundingSlabs`, `queue.chunks.columnGenerations`, `queue.chunks.lightings`, `queue.chunks.meshes`, `game.chunks.waitingForMesh`.
- Main-thread scopes: `main.interval.chunkStreaming` (with `main.chunk.planStreaming`), `main.light.collectRegionInputs`, `main.light.mergeRegion`, `main.chunk.extractBorders`, `main.light.relight` (edits), `main.edit.sphere`.

### Light tab

Follows every block edit from the click to the last re-meshed chunk on screen. Each edit is one of `lightPlace`, `lightBreak`, `blockPlace`, `blockBreak`. The tab and the markdown report show per kind: end to end time, first mesh on screen, relight (light data final) and remesh (relight to last mesh), then the pipeline stages with their share of the total, plus cells and chunks touched per edit. Stage timers are `light.stage.<kind>.<stage>`, end to end timers `light.edit.<kind>.<total|firstMesh|relight|remesh>`, and a hint fires when the p95 is over 40 ms. Code: `light-trace.ts`, `light-report.ts`, `light-hints.ts`.

Header buttons: Pause, Reset, Save to `.profiles`, Copy markdown, Download JSON, Run benchmark, and a "GPU pass split" checkbox. Pass split renders sky, opaque, transparent and overlay objects as separate passes so each gets its own GPU timer. It distorts CPU render time slightly, so leave it off unless GPU time is the question.

## Benchmark

Creates a throwaway in-memory world (default seed `20240607`) and runs five phases, each profiled on its own. The world is never saved or listed, and the game returns to the title screen afterwards.

1. `world-load`: cold start until the start area (every drawn chunk within 3 chunks of the player) is on screen; the rest of the render distance keeps streaming in the later phases.
2. `fly`: straight flight at 12 blocks per second so new chunks stream in (default 20 s).
3. `hover`: stationary, camera turning, steady-state rendering after a 3 s warmup (default 8 s).
4. `edit`: a burst of place and break edits, alternating stone and light sources (default 8 s).
5. `light-edit`: one edit at a time on a ring, cycling place light, break light, place block, break block, waiting for each to settle so the Light tab numbers are not blurred by queueing (default 10 s).

Options: `runBenchmark({ seed, flySeconds, hoverSeconds, editSeconds, lightEditSeconds })`. The `overall` report merges the phases: totals and counts are exact, percentiles are the worst phase's value.

## Agent workflow

Agents read data from disk or from the page; both give the same report.

- **From disk:** run the benchmark (or press "Save to .profiles"), then read `.profiles/latest-benchmark.md` or `.profiles/latest-snapshot.md`. The matching `.json` has the full data. Timestamped copies sit next to them. `.profiles/` is gitignored and written by the dev-only route `src/app/api/dev/game-profile` (returns 404 in production, fixed filenames, no client-chosen paths).
- **From the page** (Playwright or DevTools): `window.__gameProfiler` exposes `enable()`, `disable()`, `isEnabled()`, `reset(label?)`, `snapshot()`, `report()`, `markdown()`, `save(label?)`, `runBenchmark(options?)` and a live `settings` object. `runBenchmark` saves the result itself.

Markdown report layout: session info (GPU, viewport, DPR, cores, timer mode), frame-time table, top targets per group (rank, ms per second, frame budget share, bytes per second, mean, p95, max), hints with evidence, then appendices (all timers, worker methods, transfers, memory, worst frames, events).

Optimization loop: run the benchmark, pick the top target, change one thing, rerun with the same seed, compare the same rows.

## Call trees, breakdowns, trace, sampling, diff

- **Call trees:** every scope and worker section is also kept as a path-keyed tree (`a>b>c`) with calls, inclusive, self and max time per node. Overlay tabs `Call tree` and `Flame`, and the "Call trees" markdown section. `__gameProfiler.callTree()` returns the data. Worker trees are merged per `<pool>.<method>`.
- **Breakdowns:** cost grouped by a domain key (biome, stage, feature, feature type, carver, density node, surface rule, block, game block, mesh faces per block, light kind, system, UI surface). Dimension names live in `profiler/dimensions.ts`. Keys containing `|` are cross dimensions (`worldgen.biomeStage`, `worldgen.biomeFeature`) and render as matrices. Tag a section with `workerSection(name, fn, dimension, key)` or `profiler.begin(name, dimension, key)`; add pure units with `addWorkerKeyedUnits`.
- **Hot loops:** `workerSampledSection` / `startWorkerSampledSection(name, every)` count every call exactly and time one in N; the rest is estimated from the running mean (shown as `~`). Read self time on sampled nodes, inclusive time can be inflated by rare heavy children.
- **Trace:** `__gameProfiler.trace(true)` (or `?trace=1`), exercise, then `saveTrace()` writes `.profiles/latest-trace.json` (open in ui.perfetto.dev or chrome://tracing).
- **Sampling:** `?sample=1` or `startSampling()` / `stopSampling()` runs the JS Self-Profiling API on the main thread (Chromium only, dev header `Document-Policy: js-profiling`, not available in workers). Finds hot code nobody instrumented.
- **Diff:** `saveBaseline("name")` then `diffAgainst("name")`, or `bun scripts/profile-diff.ts baseline:<name> latest`. Rows are ranked by impact and flagged regression/improvement beyond a 5% noise threshold.

## Headless worldgen probe

`bun run profile:worldgen` (flags `--seed --columns-per-biome --warmup --biomes a,b --cold --max-biomes --all --out`) finds representative columns for each biome, generates them through the game's own path and writes `.profiles/worldgen-latest.md` and `.json`: slowest biomes, call tree, and per-stage/biome/feature/carver/block breakdowns. No browser needed; use it to attribute generation cost per biome and per block.

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
| `browser-observers.ts` | Long tasks, long animation frames, event loop lag and drift, input latency, resource timing, tab visibility, heap sampling, structured clone calibration |
| `gpu-pass-registry.ts`, `gpu-pass-report.ts` | `measureGpuPass(label, fn)` for passes outside the scene render (CPU, GPU and draws per pass); the ranked pass table |
| `scene-memory-sampler.ts` | Per-second gauges for chunk, light and geometry memory |
| `report.ts`, `cost-model.ts`, `metric-names.ts`, `hints.ts`, `markdown-report.ts` | Ranking, efficiency lines, hints, markdown |
| `benchmark.ts` | Phase plan, flight path, edit targets, runner |
| `mount-overlay.tsx`, `ui/`, `global-api.ts`, `export-report.ts` | Overlay (own React root, so the game does not re-render), window API, dev-route client |

Worker protocol: the pool sends `profile: true` with a request. The worker returns `profile` (execution time, section self times, counters, epoch timestamps) with the result, then a small `resultTail` message carrying the time its `postMessage` took. Worker and main thread are compared on epoch time (`performance.timeOrigin + performance.now()`).

## Caveats

- `performance.now()` is clamped by the browser (about 100 microseconds, 5 when cross-origin isolated). Do not wrap sub-0.1 ms operations in a scope or section; count them with a counter.
- A GPU pass cannot start inside another one (one timer query at a time), so a pass drawn inside the scene render (for example the far terrain depth copy) only gets a CPU scope.
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

Passes rendered outside `renderer.render(scene, camera)` (shadow maps, post-processing, clouds) use `measureGpuPass`:

```ts
import { measureGpuPass } from "../profiler/gpu-pass-registry";

measureGpuPass("shadowCascade0", () => renderer.render(casterScene, lightCamera));
```

Passes must not nest, and labels must come from a small fixed set.

Naming: dotted, starting with where the cost lands (`main.`, `worker.`, `queue.`, `latency.`, `transfer.`, `bytes.`, `gpu.`, `gl.`, `memory.`, `game.`, `network.`). Reports group by these prefixes.

## Tests

`bun test src/applications/game` runs the profiler tests (fake clock, fake WebGL, fake Worker; no GPU or network).
