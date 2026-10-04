# World generation

The game generates chunks from a TypeScript port of Minecraft 1.20.6 world generation driven by the Terralith 2.5.1 datapack. Every block is a pure function of `(seed, x, y, z)`.

- `engine/`: the port, in Minecraft coordinates (Y -64..319, sea level 63). Modules: `random`, `noise`, `density`, `terrain`, `biome-source`, `surface`, `chunk`, `registry` (Node-only datapack loader), `blocks` (Minecraft block state -> game `BlockType`), `pipeline` (`createOverworldGenerator`: noise fill, biomes, surface; extra stages plug into its `stages` list). Each has its own README.
- `terralith/`: runtime data. `data/*.json` is the pruned, compact, deterministic output of `bun run generate:terralith` (reads the datapacks from `--pack`/`--vanilla` or `TERRALITH_PACK_DIR`/`VANILLA_DATA_DIR`) and is committed. `loadTerralithRegistries()` decodes it into the registries the engine expects and works in workers (static JSON imports) and in Bun tests. `terralith-data.test.ts` checks the data resolves and, with `WORLDGEN_SCRATCH` set, that the committed files match a fresh compile.
- `overworld-world.ts`: per-seed engine instances per thread. A full generator for chunks, a noise-fill-only generator for height lookups, and `ADDITIONAL_STAGE_REGISTRATIONS` where aquifers, carvers and features get spliced into the full generator.
- `chunk-generator.ts`: `generateChunkBlocks(seed, chunkX, chunkY, chunkZ)`. Game y = Minecraft y + 17 (`GAME_Y_OFFSET`, so sea level 63 is the game's `SEA_LEVEL` 80). A 32x32 game column covers 2x2 engine columns; converted vertical chunks are kept in a bounded per-seed cache.
- `surface-height.ts`: `createSurfaceHeightSampler(seed)`, highest solid game y (lighting and meshing estimates). `spawn-point.ts`: dry, gentle ground near the origin.

Block textures for biome blocks are Minecraft placeholders in `public/game`, to be replaced with original art.
