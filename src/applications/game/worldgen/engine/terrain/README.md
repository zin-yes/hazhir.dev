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

Structures are not generated yet, so the beardifier evaluates to 0 (with the infinite bounds of the real `Beardifier`).
