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
- The carvers read biomes through a memoized point sampler (stripped climate sampler, no chunk grids); `rawBiomeAtQuart`
  and `biomeAt` stay on the exact chunk-grid store.
- Biomes mirror `doCreateBiomes`: per chunk, a `NoiseChunk`-cached climate sampler is evaluated in
  `LevelChunkSection.fillBiomesFromNoise` order with the R-tree last-leaf hint, so exact climate ties resolve as in vanilla.
  The hint is primed per chunk so results do not depend on generation order. Bounded LRU of 64 chunks.

Tests (`overworld-generator.test.ts`) compare against the real-server fixtures and skip without the scratch data
(`WORLDGEN_SCRATCH`). The default run samples every 50th fixture chunk; `RUN_INTEGRATION=1` runs all of them.
Note: fixture `biomes` hold only sections 0-15 (y -64..191), an extractor bug, so only those are compared.
