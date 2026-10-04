# terrain

Noise-based terrain fill for the Terralith worldgen port, bit-identical to Minecraft 1.20.6 for the final density.

- `NoiseChunk(router, settings)`: mirrors `NoiseChunk`. Each density Marker becomes a per-chunk cache:
  `interpolated` (cell-corner slices, trilinear interpolation), `flat_cache` (quart columns sampled at y = 0),
  `cache_2d`, `cache_once` (keyed on the interpolation counters) and `cache_all_in_cell`. The chunk object is the
  `FunctionContext` and `ContextProvider`, as in Java. `wiredRouterFields` limits which router functions get caches
  (Java wires all of them; doing so changes no final density value, only cost).
- `fillChunkColumn({ router, chunkX, chunkZ, minY, height, seaLevel })`: mirrors `NoiseBasedChunkGenerator.doFill`
  with `Aquifer.createDisabled` and the generator's fluid picker. Returns block ids indexed
  `(y - minY) * 256 + localZ * 16 + localX`: `BLOCK_AIR`, `BLOCK_DEFAULT_BLOCK` (stone), `BLOCK_DEFAULT_FLUID`
  (water below sea level) and `BLOCK_LAVA` (open space below y = -54).
- `fillChunkColumn({ ..., aquifers: { rootRandomFactory, oreVeins? } })` runs the real material rule list instead:
  `Aquifer.NoiseBasedAquifer` (`aquifer.ts`), then `OreVeinifier` (`ore-veinifier.ts`), null from both meaning the default
  block. Output symbols grow to `BLOCK_GRANITE`, `BLOCK_TUFF`, `BLOCK_COPPER_ORE`, `BLOCK_DEEPSLATE_IRON_ORE`,
  `BLOCK_RAW_COPPER_BLOCK`, `BLOCK_RAW_IRON_BLOCK` (`terrain-blocks.ts`; `terrainSymbolStates(defaultBlock, defaultFluid)`
  gives the block state of every symbol). `fillChunkColumnDetailed` also returns the aquifer for the carvers, and
  `createChunkAquifer` builds one for a chunk that was not just filled. Preliminary surface levels are cached per router.
  Verified block-for-block (1M blocks, 0 mismatches) and at 7700 sampled positions against the real classes
  (`aquifer.test.ts`, recorded by `carvers/fixtures/CarversReference.java`).

The chunk-independent part of the wiring (holder unwrapping, constant folding, structural merging of markers) is done
once per router in `noise-chunk-template.ts`; per chunk only the marker-carrying subgraph is rebuilt.

Exact fast paths (each falls back to the NoiseChunk machinery when its premise does not hold for the router):
- `corner-column-sampler.ts`: an interpolator's cell-corner columns are pure functions of the corner position when no
  cache inside it can return a stale or quantized value (`isCornerSamplingExact`), so they are evaluated directly with
  compiled code, and columns on chunk borders are shared with the neighbouring chunks.
- `cell-fill-compiler.ts`: the cache_all_in_cell fill (final density from the interpolators' lerp3) as generated code.
- `NoiseInterpolator` computes its incremental value lazily from the chunk's deltas (the same lerps), and the fill
  loop positions the chunk as a context only for blocks that evaluate density functions through it.
- `aquifer.ts`: an origin cell whose 12 candidate centres share one fluid status answers that fluid directly (all
  pressures are 0); statuses are pure per chunk, so classifying them up front changes nothing.
- `FlatCache` fills its slots on first read; `preliminary-surface-level.ts` evaluates a compiled, column-memoized
  initial density.
- `terrain-height-sampler.ts`: `TerrainHeightSampler.create(router, settings)` answers OCEAN_FLOOR_WG /
  WORLD_SURFACE_WG of the aquifer-free fill for one block column from its four corner columns, evaluated lazily from
  the top down (`terrain-height-sampler.test.ts` compares it with filled columns).

Structures are not generated yet, so the beardifier evaluates to 0 (with the infinite bounds of the real `Beardifier`).
