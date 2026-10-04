# pipeline

Base overworld generator that wires the finished engine stages in vanilla `NoiseBasedChunkGenerator` order:
fill noise -> biomes -> `buildSurface`.

- `createOverworldGenerator({ registries, overworldDimension, seed })` returns `settings`, `stages`,
  `generateBaseColumn(chunkX, chunkZ)` (bounded LRU of 64 columns, read-only results), `rawBiomeAtQuart`, `biomeAt`
  (BiomeManager zoom) and `surfaceHeight(x, z, "WORLD_SURFACE_WG" | "OCEAN_FLOOR_WG")` (first free y, like `Heightmap`).
- Hook point: `generator.stages` is an ordered `ColumnStage[]` (`run(column, context)`, mutating one `ChunkBlocks`).
  Defaults are `noise-fill` (terrain symbols mapped to the noise settings' default block/fluid and `lava[level=0]`)
  and `surface`. Splice aquifers, ore veins, carvers and features in before the first `generateBaseColumn` call.
- Biomes mirror `doCreateBiomes`: per chunk, a `NoiseChunk`-cached climate sampler is evaluated in
  `LevelChunkSection.fillBiomesFromNoise` order with the R-tree last-leaf hint, so exact climate ties resolve as in vanilla.
  The hint is primed per chunk so results do not depend on generation order. Bounded LRU of 64 chunks.

Tests (`overworld-generator.test.ts`) compare against the real-server fixtures and skip without the scratch data
(`WORLDGEN_SCRATCH`). The default run samples every 50th fixture chunk; `RUN_INTEGRATION=1` runs all of them.
Note: fixture `biomes` hold only sections 0-15 (y -64..191), an extractor bug, so only those are compared.
