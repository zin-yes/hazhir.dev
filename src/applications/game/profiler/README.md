# Game profiler

Measures CPU (main thread and workers), GPU, WebGL driver time, worker transfer cost and data sizes for the voxel game, and ranks the results as optimization targets.

## Turning it on

- `?profile=1` in the URL, or press `F4` in the game to toggle the overlay.
- Everything is a cheap early return while disabled, so instrumentation stays in production code.

## Reading the output

- Overlay (`F4`): ranked targets, frame budget, workers, GPU, transfers, memory, meshes.
- Agents: `window.__gameProfiler` (`snapshot()`, `report()`, `markdown()`, `save()`, `runBenchmark()`). Saved files land in `.profiles/` as `latest-*.md` and `latest-*.json` (gitignored, written by the dev-only API route).

## Metric naming

Names are dotted and start with where the cost lands:

- `main.*` main-thread scope (inclusive and self time), for example `main.chunk.buildGeometry`
- `worker.<pool>.<method>.<section>` worker CPU time, `work.<pool>.<method>.<counter>` units of work
- `queue.*`, `latency.*`, `chunk.pipeline.*`, `chunk.load.*` asynchronous wall-clock durations (not CPU)
- `transfer.<pool>.<method>.*` postMessage transit and serialization, `bytes.*` payload sizes
- `game.*` counters, `memory.*` gauges, `gpu.*` and `gl.*` render costs, `network.*` packet sizes

## Benchmark

`?benchmark=1` (or `window.__gameProfiler.runBenchmark()`, or the overlay button) creates a throwaway in-memory world with a fixed seed and runs four phases, each profiled on its own:

1. `world-load` cold start until every initial mesh is on screen
2. `fly` straight flight at 12 blocks per second so new chunks stream in
3. `hover` stationary, camera turning (steady-state rendering, after a 3 second warmup)
4. `edit` a burst of place and break edits, alternating stone and light sources

The benchmark world is never saved or listed. The game returns to the title screen afterwards. `overall` merges the phases: totals and counts are exact, percentiles are the worst phase's value.

## Caveats

- `performance.now()` is clamped by the browser (about 100 microseconds). Do not wrap sub-0.1ms operations in a scope; count them with a counter instead.
- GPU time needs `EXT_disjoint_timer_query_webgl2`. Without it only CPU side render cost is available.
- Scopes are synchronous. For work that spans awaits, record a `latency` timer with `profiler.recordTimer(name, ms, "latency")`.

## Adding a scope

```ts
import { profiler } from "./profiler";

const token = profiler.begin("main.feature.step");
try {
  doTheWork();
} finally {
  profiler.end(token);
}
```

Use `profiler.addCounter(name, amount)` for units of work, `profiler.recordBytes(name, bytes)` for payload sizes and `profiler.sampleGauge(name, value, unit)` for levels such as memory. In a worker use `workerSection` and `addWorkerCounter` from `worker-recorder.ts`.
