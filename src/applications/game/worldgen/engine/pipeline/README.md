# pipeline

Base overworld generator that wires the finished engine stages in vanilla `NoiseBasedChunkGenerator` order:
fill noise (aquifers + ore veins) -> biomes -> `buildSurface` -> carvers.

- `createOverworldGenerator({ registries, overworldDimension, seed })` returns `settings`, `stages`,
  `generateBaseColumn(chunkX, chunkZ)` (bounded LRU of 64 columns, read-only results), `rawBiomeAtQuart`, `biomeAt`
  (BiomeManager zoom) and `surfaceHeight(x, z, "WORLD_SURFACE_WG" | "OCEAN_FLOOR_WG")` (first free y, like `Heightmap`).
- Hook point: `generator.stages` is an ordered `ColumnStage[]` (`run(column, context)`, mutating one `ChunkBlocks`).
  Defaults are `noise-fill` (aquifers and ore veins; its aquifer travels in `context.aquifer`), `surface` and, when
  `blockTags` is passed, `carvers` (reuses that aquifer; the cached column is the final carved one). Splice features in
  before the first `generateBaseColumn` call. `createNoiseFillStage()` without options is the aquifer-free fill.
- `generator.carvingMask(chunkX, chunkZ, "air")` returns the carvers' mask of a base column (packed `CarvingMask`, what the `carving_mask` placement modifier reads); the liquid step is always empty, as in 1.20.6.
- The carvers read biomes through a memoized point sampler (stripped climate sampler, no chunk grids); `rawBiomeAtQuart`
  and `biomeAt` stay on the exact chunk-grid store.
- A chunk's biome grid samples its climate one quart column at a time with compiled plain functions (equal to the
  NoiseChunk-cached sampler at quart cells, checked by `chunk-climate-samples.test.ts`) and then runs the R-tree
  searches in the vanilla order. Up to 1024 grids are kept (about 3 KB each).
- `bounded-lru-cache.ts` is a second-chance (CLOCK) cache keyed by packed chunk coordinates (`packChunkColumnKey`).
- `generator.router` exposes the seeded noise router (for samplers such as `TerrainHeightSampler`).
- Biomes mirror `doCreateBiomes`: per chunk, a `NoiseChunk`-cached climate sampler is evaluated in
  `LevelChunkSection.fillBiomesFromNoise` order with the R-tree last-leaf hint, so exact climate ties resolve as in vanilla.
  The hint is primed per chunk so results do not depend on generation order.

## Profiling

Worker profiler instrumentation (see `game/docs/profiler.md`) costs nothing while profiling is off: every section is behind `isWorkerProfiling()` or a null check, and keyed strings are built only while profiling. While a worker task is profiled, `profiled-stage-runner.ts` runs each stage inside `pipeline.biome > pipeline.biomeStage > <stage name>` sections (dimensions `worldgen.biome`, `worldgen.biomeStage`, `worldgen.stage`; biome = surface biome at the column center). Inside the stages: `noise.*` (wire, aquifer, cell loops), `aquifer.*`, `biome.*` (grid fill, climate sampling, R-tree search), `surface.*` (`worldgen.surfaceRule` is timed on one in 32 evaluations), `carver.*` (`worldgen.carver` by carver id, units = blocks removed). Density node evaluations (`worldgen.densityNode`, units per node type) and cache hits/misses are batched per stage and flushed once. Sampled sections give accurate self time but inflated inclusive time when a rare heavy child sits inside them, so read self time for those.

Tests (`overworld-generator.test.ts`) compare against the real-server fixtures and skip without the scratch data
(`WORLDGEN_SCRATCH`). The default run samples every 50th fixture chunk; `RUN_INTEGRATION=1` runs all of them.
Note: fixture `biomes` hold only sections 0-15 (y -64..191), an extractor bug, so only those are compared.
