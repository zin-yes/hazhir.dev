# engine/surface

Port of `SurfaceSystem.buildSurface` and `SurfaceRules` (Minecraft 1.20.6). Rewrites the terrain stage's
stone/water/air column into grass, sand, terracotta bands, deepslate, bedrock and so on, as chosen by the
`surface_rule` of the noise settings, plus the eroded badlands and frozen ocean (iceberg) extensions.

Public API (`index.ts`):
- `createSurfaceSystem(config)` builds the per-seed state once: clay bands, noises, compiled rule closures.
  `system.buildSurface({ chunk, router, biomeAt })` mutates a `ChunkBlocks` column in place.
- `buildSurface(params)` is the one-call form; it caches a system per root random factory and rule object.
- `createBiomeClimateLookup(biomeRegistry)` supplies `biomeClimate`, needed only by the `temperature` rule and icebergs.

Mirrors: `SurfaceSystem`, `SurfaceRules` (+ `Context`), `NoiseChunk.preliminarySurfaceLevel`, `Heightmap` (WORLD_SURFACE_WG),
and the temperature parts of `Biome`.

Tests: `surface-system.test.ts` (real Terralith rules on hand-built columns, clay bands vs Minecraft),
`biome-noises.test.ts` (vs Minecraft), `surface-fixtures.test.ts` (real server chunks, needs the scratch data,
`SURFACE_FIXTURE_STRIDE=1` runs every interior chunk). `fixtures/SurfaceReference.java` produced the recorded values.
