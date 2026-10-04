# World generation

Terralith-inspired, fully deterministic generation: every block is a pure function of `(seed, x, y, z)`.

- `climate.ts`: continentalness, erosion, ridges, temperature, humidity, weirdness (uniform [-1, 1] fields).
- `terrain-model.ts` + `landforms/`: heights and water. Continental profile with sea cliffs, mountain belts along ridge lines, arid plateaus (badlands buttes, stepped canyons), volcanoes, ocean islands (atolls, cays, skerries), rivers and fjords, lakes.
- `biomes/`: biome data (`*-biomes.ts`) and `biome-selection.ts`, which maps climate, altitude and landforms to a biome.
- `column-grid.ts`: cached per-column description (terrain, biome, slope) for a chunk footprint.
- `surface-layers.ts`: block at a given height (soil layers, cliff rock, banks and beds, strata).
- `trees/`: pure tree, bush and cactus shape builders. `vegetation/`: where they grow (jittered grid, groves, slope, cold limits, water proximity) and per-column ground cover.
- `chunk-generator.ts`: assembles a chunk. `spawn-point.ts`: dry start position.

Block textures for biome blocks are Minecraft placeholders in `public/game`, to be replaced with original art.
