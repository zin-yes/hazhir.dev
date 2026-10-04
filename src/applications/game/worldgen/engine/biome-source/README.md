# biome-source

Climate-to-biome lookup and block-resolution biome zoom for the Terralith worldgen port.

- `MultiNoiseBiomeSource(generator.biome_source JSON)`: `findBiome(target)` returns the parameter point with minimal
  `Climate` fitness. Mirrors `Climate.Parameter/ParameterPoint/ParameterList` (floats quantized with
  `(long)(x * 10000.0F)`) and `Climate.RTree` (same construction and search order; the thread-local last-leaf hint is
  opt-in via `{ reuseLastLeaf: true }`). `findBiomeBruteForce` is the exhaustive reference used by the tests.
- `BiomeManager(rawBiomeAtQuart, worldSeed)`: `getBiome(blockX, blockY, blockZ)` mirrors `BiomeManager.getBiome(BlockPos)`
  (8-cell fiddled voronoi using `LinearCongruentialGenerator`). It obfuscates the world seed itself with
  `obfuscateSeed` (SHA-256 from `engine/random`).

Tests read the real Terralith table; set `TERRALITH_PACK_ROOT` to the pack directory (they skip when it is absent).

`BiomeManager` also remembers which 2x2x2 candidate cubes hold a single biome (that biome is then the answer whatever
the fiddled distances); a cube spanning chunks is only classified when those chunks' biomes are already cached, so
scattered lookups never generate extra chunks. It keeps a direct-mapped cache of the per-quart-cell fiddle offsets (they depend only on the cell, and neighbouring blocks share cells), which removes about 60% of surface-generation time; results stay bit-identical to the uncached BigInt oracle used in the tests.
