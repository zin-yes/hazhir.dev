# engine/carvers

Port of the carving stage of `NoiseBasedChunkGenerator.applyCarvers` (Minecraft 1.20.6, `GenerationStep.Carving.AIR`):
caves, extra underground caves and canyons, carved into a chunk after the surface stage.

Public API (`index.ts`):
- `createCarverSystem({ registries, blockTags, seed, rawBiomeAtQuart })` builds the per-seed state (parsed `configured_carver`
  entries, per-chunk carver lists). `system.applyCarvers({ chunk, aquifer, symbolStates, topMaterial? })` mutates a
  `ChunkBlocks` in place. `rawBiomeAtQuart` is read once per source chunk at `(chunkX * 4, 0, chunkZ * 4)` for the 17 x 17
  neighbourhood, so a point sampler is much cheaper than one that generates whole chunks of biomes.
- `aquifer` is `FilledChunkColumn.aquifer` from `terrain/fillChunkColumnDetailed({ aquifers })`, or `createChunkAquifer(...)`;
  it decides air / water / lava inside carved space. `symbolStates` is `terrainSymbolStates(defaultBlock, defaultFluid)`.
- `createTopMaterialSourceFactory(config)(chunk, biomeAtBlock)` gives the `topMaterial` source (`SurfaceSystem.topMaterial`),
  which restores grass over dirt exposed by a carved surface block. Without it, that restoration is skipped.

Mirrors: `WorldCarver`, `CaveWorldCarver`, `CanyonWorldCarver`, `ConfiguredWorldCarver`, `CarvingContext`, `CarvingMask`,
`WorldgenRandom.setLargeFeatureSeed`, `FloatProvider` / `HeightProvider` / `VerticalAnchor`, `Mth.sin` / `Mth.cos` (lookup table).
Carver math is Java float arithmetic (`Math.fround`). Carved air is `minecraft:air` (1.20.6 uses the aquifer's air, not cave_air).

Tests: `carvers.test.ts` compares whole chunks block by block with the real classes (`fixtures/CarversReference.java` recorded
`fixtures/carvers-reference-vectors.json.gz`, which also produced `terrain/fixtures/aquifer-reference-vectors.json.gz`);
`carvers-fixtures.test.ts` compares generated columns with real server chunks (`RUN_INTEGRATION=1` for the large sample).
