# LOD (Distant Horizons style far terrain)

Draws the world out to 256 chunks (8192 blocks, tunable to 512+) as blocky heightfield tiles behind the real chunks.
The far field comes straight from the worldgen noise (exact noise-fill heights, real surface rules, climate biomes);
where real chunks were loaded, their actual surface (trees and edits included) replaces it; where real chunks are
rendered, the LOD hides. Self-contained: it reads `blocks.ts`, `config.ts`, the worldgen engine's public modules and
the profiler, and owns its own vertex format, shaders, materials, worker and render pass.

## How it works

```
camera ──► selection (quadtree, screen-space error, rings) ──► render set (ready tiles + stand-ins)
                │                                                   │
                ▼                                                   ▼
         build queue (uncovered > in frustum > nearest) ──► LOD workers ──► tile mesh ──► cache (LRU, budget) ──► LOD pass
                                     ▲                                                       ▲
real chunks ──► summaries ──► real surface pyramid (sparse quadtree) ── overlay ─┘          coverage texture (discard)
```

| Folder | What lives there |
| --- | --- |
| `core/` | Tile addressing (`level, tileX, tileZ`, numeric keys, bounds) and shared dimensions. A tile is 32 x 32 cells; a level-L cell is 2^L blocks, so a level-0 tile is exactly one chunk column. |
| `sampling/` | Worldgen glue (worker side). `column-cached-density` rewrites the router so `flat_cache`/`cache_2d` markers keep a one-column memo (final density drops from ~35 to ~5 microseconds per extra y) and the climate functions share those memos. `terrain-surface-lattice` finds the surface on Minecraft's 4 x 4 x 4 density lattice and reproduces the noise fill's trilinear interpolation, so level-0 heights match the engine block for block. `surface-material-sampler` evaluates the compiled surface rules at one column (biome, sea level, planar slope for `steep`), then snow and sea ice like `freeze_top_layer`. `worldgen-tile-sampler` puts it together per tile, seeded by a coarser tile (the hint) and skipping cells covered by real data. |
| `data/` | `TileSurface` (height, top block, wall block, water level per cell), its packed form (byte height offsets, palette with bit-packed indices, water mask: ~1.3-2.6 KB per tile), the 2 x 2 downsample, real chunk summaries and their column assembly, and `RealSurfacePyramid`, a sparse quadtree of real data with LRU eviction under a budget. |
| `meshing/` | 8-byte vertex format and the heightfield mesher: greedy-merged tops (same height, colour, light), walls merged along each edge line, skirts on all four borders down to the world floor, water quads in a second range. |
| `selection/` | `selectTiles` (screen-space error with per-level threshold growth, merge hysteresis, 2:1 neighbour balance) and `computeRenderSet` (ready leaves, or ready finer children, or a ready ancestor, never overlapping). |
| `cache/` | `LodTileCache` (LRU by bytes, pinned tiles never evicted) and `BuildQueue`. |
| `coverage/` | `RealChunkCoverage` (which chunk columns the real renderer draws) and the toroidal coverage texture writer plus its CPU mirror of the shader test. |
| `rendering/` | Shaders, the two materials (terrain, water), tile mesh creation (shared quad index buffer) and the LOD render pass. |
| `manager/` | `createLodManager`: orchestration, real data tracker, cross-fading display, worker executor, stats. |
| `worker/` | `lod-tile-builder` (pure, deterministic request -> result) and the `lod-worker` entry. |
| `colors/` | Average colour of every block texture in `public/game` (generated) and the top/side colour per block type. |
| `benchmark/` | Headless benchmark (see below). |
| `testing/` | Test helpers: synthetic terrain and chunks, mesh decoding. |

Design points worth knowing:

- **Selection.** A tile splits while one of its cells would cover more than `maximumCellPixels` (8 px at level 0, times 1.2 per level) at the tile's nearest point, giving rings like Distant Horizons: 1-block cells out to ~130 blocks, 8 blocks at ~500, 64 at ~2000, 256 at the 8 km horizon. Split tiles merge only below 0.8 x the threshold. Neighbours differ by at most one level. About 310 tiles cover a 256-chunk radius, 350 a 512-chunk one.
- **Loading order.** An area with nothing drawn asks for its root tile first (level 8 at 256 chunks), so the whole horizon appears after one root build per worker; then tiles in the frustum, nearest first, refine. While a tile builds, its ready parent (or its four ready children after a merge) stands in. A finer tile is built with its nearest cached ancestor as a hint (seeds every height search); a coarser tile whose four children are cached is a pure downsample (no worldgen).
- **No cracks.** Every border cell hangs a skirt to the world floor. Where two tiles meet, the higher side's skirt spans the step; any skirt below the neighbour's surface is inside the neighbour's terrain and hidden. `heightfield-mesher.test.ts` checks every step inside tiles and along borders between levels.
- **No popping.** When the render set changes, entering tiles fade in while leaving ones fade out with complementary ordered-dither thresholds (350 ms), so every pixel is drawn by one of them throughout. At the far edge tiles dither out into the sky while fog takes them to `fogColor`.
- **Real chunks win.** Chunk summaries (highest LOD-visible block per column, leaves included, plants skipped, snow layers as cover, water above) are assembled per column; a cell is trusted only when no unloaded chunk above could hold more terrain. Trusted columns go into the pyramid and every level's tile picks them up as an overlay. A column hides the LOD once all chunks holding its surface are meshed; fully covered tiles are not drawn, partly covered ones discard per fragment through a 64 x 64 toroidal coverage texture (walls on a column border belong to the cell they rise from).
- **Depth and far plane.** The LOD renders in its own pass before the main scene, then clears depth: real chunks always land on top, the main camera keeps its near 0.1 / far 10000, and the LOD camera gets its own planes. Its near plane is pushed out to 0.45 x the distance of the nearest LOD geometry that can show (an uncovered column), clamped to 0.5..64, and its far plane is 1.25 x the radius plus the camera height. With the real chunks loaded
  (3-chunk render distance) the near plane sits around 45, where a 24-bit depth buffer resolves about 0.1 blocks at
  8 km and 0.35 at 16 km; while the LOD is right at the camera (no real chunks yet) near drops to 0.5 and precision degrades to about 8 blocks at 8 km, which only shows as slight water/seabed flicker in shallow seas far away. A logarithmic depth buffer was not used: it needs `gl_FragDepth`, which disables early depth rejection for every LOD fragment (skirts and hidden terrain would all be shaded), and reversed-z needs `EXT_clip_control` and a renderer-wide change.
- **Colours and light.** Vertex colour = the linear-light average of the face's texture (alpha-tested like the main shader); textures are pre-coloured, so there is no biome tint (same as the main shader). Shading is the main shader's `pow(0.8, 15 - light) * (0.55 + 0.15 * ao)` on the output-encoded colour: sky light 15 on land, lower under water, ambient occlusion 1 at wall feet.

## Integration into `index.tsx`

Everything goes through `createLodManager` from `./lod` (see `manager/lod-manager.ts` for the full interface).

1. **Create it with the world**, in `startWorldGeneration(currentSeed)` (so a new seed gets a new LOD), and keep it in a ref:

   ```ts
   import { createLodManager, type LodManager } from "./lod";

   const lodManagerRef = useRef<LodManager | null>(null);

   // in startWorldGeneration(currentSeed), before chunks start loading:
   lodManagerRef.current?.dispose();
   lodManagerRef.current = createLodManager({
     seed: currentSeed,
     workerFactory: () =>
       new Worker(new URL("./lod/worker/lod-worker.ts", import.meta.url), { name: "lod" }),
     workerCount: 2,
     renderDistanceChunks: 256,
   });
   lodManagerRef.current.adoptBackground(skyRef.current); // the Sky object, see step 2
   ```

   The `new Worker(new URL(...literal...), ...)` form must stay literal so Next bundles the worker, like the
   `unified-worker.ts` pools. The pool registers itself with the profiler as `lod`.

2. **Move the sky into the LOD pass.** Create the `Sky` as today but do not `scene.add(sky)`; call
   `lod.adoptBackground(sky)` instead (keep it in a ref so step 1 can re-adopt it). After the LOD pass clears depth,
   a sky left in the main scene would paint over the LOD. Optionally `lod.setFogColor(0x...)` to match the sky's
   horizon colour (default `0xbcd0e6`).

3. **Render loop.** Set `renderer.autoClear = false` once at start-up, then replace the render call at the end of the
   frame with:

   ```ts
   const lod = lodManagerRef.current;
   renderer.clear();
   if (lod) {
     lod.update(camera, renderer.domElement.clientHeight);
     lod.render(renderer, camera);
   }
   if (profiledRenderRef.current) profiledRenderRef.current.render();
   else renderer.render(scene, camera);
   ```

   `lod.render` draws the sky and the tiles with its own camera planes and clears depth; the main render must not
   clear again (hence `autoClear = false`). Pass CSS pixels (`clientHeight`) so detail does not double on high-DPI
   screens.

4. **Chunk data.** Right after `chunks.current[chunkName] = chunk; applySavedEditsToChunk(chunkName, chunk);` (both
   places: the initial load and streaming):

   ```ts
   lodManagerRef.current?.onRealChunkLoaded(x, y, z, chunk);
   ```

5. **Chunk meshes.** At the end of `addChunkMesh(meshResult, chunkName, chunkX, chunkY, chunkZ)`, after the meshes are
   placed (also when the chunk produced no faces):

   ```ts
   lodManagerRef.current?.onRealChunkMeshed(chunkX, chunkY, chunkZ);
   ```

   and in `pruneChunkMesh(chunkName)`:

   ```ts
   const [chunkX, chunkY, chunkZ] = chunkName.split(",").map(Number);
   lodManagerRef.current?.onRealChunkUnloaded(chunkX, chunkY, chunkZ);
   ```

   `addChunkMesh` calls `pruneChunkMesh` first; the unload and the re-mesh happen before the next `update`, so the
   coverage never flickers.

6. **Edits.** After `chunk[blockIndex] = type` in `setBlockUnprofiled`, and after network block updates write
   `chunks.current[chunkName][index]`:

   ```ts
   lodManagerRef.current?.onBlocksEdited(chunkX, chunkY, chunkZ, chunk);
   ```

   Summaries are cheap (one top-down scan per column), re-assembly is batched (8 columns per frame) and tiles refresh
   at most every 4 s.

7. **Teardown.** `lodManagerRef.current?.dispose()` on unmount (terminates the workers, releases geometry, hands the
   sky back to its previous parent).

Optional: `lod.getStats()` for an overlay (drawn, missing, queued tiles, cache MB, first horizon and full detail
times, per-level build costs).

## Tuning (`LodManagerOptions`)

| Option | Default | Effect |
| --- | --- | --- |
| `renderDistanceChunks` | 256 | LOD radius; the root level follows (level 8 at 256, 9 at 512). |
| `maximumCellPixels` | 8 | Detail: lower = finer near tiles, more tiles. |
| `thresholdGrowthPerLevel` | 1.2 | How fast detail thins towards the horizon. |
| `workerCount` / `maximumBuildsInFlight` | 2 / 4 | LOD worker pool size and parallel builds. LOD workers compete with the chunk workers for cores. |
| `memoryBudgetBytes` | 160 MB | Cached tile geometry plus packed surfaces (a 256-chunk view uses ~20 MB). |
| `realDataBudgetBytes` | 24 MB | Real surface pyramid (7 KB per node). |
| `fadeMilliseconds` | 350 | Level cross-fade; 0 disables fades. |
| `fogColor` | `0xbcd0e6` | sRGB colour the far terrain fades to (also `setFogColor`). |

## Profiler

Main thread: `main.lod.update` (with `main.lod.select`), `main.lod.createTileMesh`, `main.lod.render`,
`main.lod.summarizeChunk`, `main.lod.applyRealColumns`; gauges `game.lod.drawnTiles`, `game.lod.missingTiles`,
`queue.lod.waitingBuilds`, `memory.lod.tileCache`, `memory.lod.realData`; counter `game.lod.tilesBuilt`, bytes
`bytes.lod.tileGeometry`. Workers (pool `lod`, method `buildLodTile`): sections `lod.sampleWorldgen`
(`lod.sample.heights`, `lod.sample.materials`), `lod.downsampleChildren`, `lod.mesh`, `lod.pack`; counters
`lodCellsSampled`, `lodOverlayCells`, `lodLatticeColumns`, `lodDensityEvaluations`, `lodBiomeLookups`,
`lodSurfaceRuleEvaluations`, `lodTilesBuilt`, `lodVertices`, `lodPackedSurfaceBytes`. The sky now renders in the LOD
pass, so the profiler's sky pass is empty.

## Benchmark

```sh
bun src/applications/game/lod/benchmark/lod-benchmark.ts [--seed 1337] [--radius-chunks 256] [--workers 3] [--skip-accuracy]
```

Measured on an Apple Silicon laptop (Bun 1.3, seed 1337; times vary about 20% between runs):

| Level | Cell | Sample ms | Mesh + pack ms | Vertices | Geometry KB | Packed surface KB |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 1 | 14-22 | 0.7 | 1900 | 15 | 1.3 |
| 1 | 2 | 12-20 | 0.5 | 4000 | 32 | 1.4 |
| 2 | 4 | 25-40 | 0.4 | 5300 | 42 | 1.5 |
| 3 | 8 | 19-36 | 0.4 | 8600 | 67 | 1.6 |
| 4-8 | 16-256 | 19-33 | 0.5 | 10400-12600 | 81-99 | 1.7-2.6 |

| Radius | Workers | First horizon | Full detail | Tiles | Cache |
| --- | --- | --- | --- | --- | --- |
| 256 chunks (8192 blocks) | 3 | 0.2-0.32 s | 4.3-5.6 s | ~310 | 20 MB (65 KB per tile) |
| 512 chunks (16384 blocks) | 3 | 0.56 s | 6.1 s | ~350 | 24 MB |

Times include worker start-up; the benchmark has no real chunks, so it also builds the ~50 level-0 tiles the real
chunks would cover in the game. `update` costs 0.15-0.25 ms per frame on the main thread while walking (the plan is
reused while the camera rests). Real data: 7 KB per pyramid node, 24 MB budget.

Accuracy against the real generator's base terrain (aquifers, surface rules, carvers; no trees), 36 random cells per
level:

| Level | Height error at the sample point (mean / p90) | Error vs a random block in the cell (mean / p90) | Same top block |
| --- | --- | --- | --- |
| 0 | 0.6 / 2 | 0.6 / 2 | 89% |
| 1 | 0.1 / 0 | 0.4 / 1 | 97% |
| 2 | 0.0 / 0 | 0.3 / 1 | 97% |
| 3 | 0.2 / 0 | 1.8 / 3 | 96% |
| 4 | 3.4 / 0 | 4.8 / 4 | 94% |
| 5 | 0.0 / 0 | 4.2 / 10 | 100% |
| 6 | 3.8 / 0 | 7.7 / 14 | 92% |
| 7 | 2.5 / 0 | 16.6 / 44 | 85% |
| 8 | 0.0 / 0 | 13.9 / 24 | 100% |

At the sample point the LOD reproduces the noise fill (level-0 tiles in `worldgen-tile-sampler.test.ts` match it block
for block in 95%+ of cells); the remaining outliers are underwater carver canyons (the LOD keeps the sea floor) and
Terralith's floating rock shells more than ~24 blocks above an air gap, which a single column search can miss. The
"random block" column is the inherent cost of one sample per cell. Top block mismatches are mostly where the real
column has a carver or iceberg; snow and sea ice cover is excluded because the base terrain lacks the feature that
places it.

## Tests

`bun test src/applications/game/lod` (about 7 s, offline): colour table freshness, packing round trips, downsampling,
real chunk summaries and trust rules, the pyramid and its budget, sampler accuracy against the engine, climate
equality, determinism, mesher coverage and cracks between levels, the worker protocol, selection rings and balance,
render-set stand-ins, coverage masking, the cache budget, build order, fades, culling bounds and the manager end to end
(in-process builds, real chunks, unloads, budget).

Regenerate the colour table after changing block textures:
`bun src/applications/game/lod/colors/generate-block-colors.ts`.

## Limits and risks

- No trees or structures from noise; forests appear as ground until their chunks were loaded once (then the real
  surface, canopy included, stays in the pyramid within its budget).
- Thin floating shells and overhangs can be missed at a cell's sample point; underwater ravines are filled in.
- Up to two LOD workers decode the Terralith registries like the chunk workers do (memory per worker) and compete
  for cores with chunk generation while the horizon loads.
- Coverage assumes the loaded chunks form one region around the player; a meshed hole inside that region is drawn by
  the LOD but may be overdrawn by real chunks behind it until it loads.
- Draw calls: one or two per tile (about 300-600 at 256 chunks).
