# world

Pure, allocation-light streaming and memory infrastructure for the voxel game. No THREE, no workers, no DOM.

## chunk-key.ts

Chunk coordinates packed into one safe integer (x 21 bits, z 21 bits, y 10 bits, biased unsigned, 52 bits total). The column key is `floor(key / 1024)`; a neighbor key is `key + constant`.

```ts
const key = packChunkKey(cx, cy, cz);
const out = createChunkCoordinates();          // reuse one object
unpackChunkKey(key, out);                      // or chunkKeyX/Y/Z(key) for a single axis
const east = key + FACE_NEIGHBOR_KEY_DELTAS[0]; // +x, -x, +y, -y, +z, -z
const diagonal = offsetChunkKey(key, 1, -1, 1);
const column = columnKeyOfChunkKey(key);        // packColumnKey(cx, cz), chunkKeyInColumn(column, cy)
```

Neighbor math is exact while the neighbor stays inside `MIN/MAX_CHUNK_*` (about 1 million chunks in x and z, 512 in y).

## chunk-store.ts

`Map<number, T>` addressed by coordinates or key, plus `neighborsOf` (reused array, face order above) and `asKnownChunkKeys()` for the planner.

```ts
const store = new ChunkStore<ChunkRecord>();
store.set(cx, cy, cz, record);
const [east, west, up, down, south, north] = store.neighborsOf(cx, cy, cz); // read before the next call
```

## streaming-plan.ts

`ChunkStreamPlanner` decides what to request and drop. `load-order.ts` (re-exported) holds the cached nearest-first offsets (`buildLoadOrder`, also per-column offsets). `priority-scheduler.ts` (re-exported) feeds worker pools just in time.

```ts
const planner = new ChunkStreamPlanner({
  horizontalRadius: 16, verticalUp: 4, verticalDown: 4,   // ellipsoid; shape: "cylinder" keeps full height
  horizontalUnloadRadius: 18, verticalUnloadMargin: 1,    // hysteresis (defaults: +2 and 1)
  minChunkY: -2, maxChunkY: 10,
  surfaceChunkY: (cx, cz) => surfaceChunkYOrUndefined,    // optional hint
  skipAboveSurfaceMargin: 2, skipBelowSurfaceMargin: 3,   // optional, needs the hint
});
const plan = planner.update(playerChunk, camera.getWorldDirection(), store.asKnownChunkKeys());
for (let i = 0; i < plan.toLoad.length; i++) scheduler.schedule(plan.toLoad[i], job, plan.toLoadPriorities[i]);
for (const key of plan.toUnload) { scheduler.remove(key); store.deleteByKey(key); }
```

Rules the caller keeps:
- `plan` arrays are reused: consume them before the next `update`.
- Add every `toLoad` key to the known set (record, or a pending placeholder) before the next update; removals likewise. After anything else changes the known set (failed load, new surface hints) call `planner.invalidate()`.
- Standing still returns an empty plan (`playerChunkChanged === false`). After the camera turns, re-rank queued work with `scheduler.reprioritizeAll((key) => planner.priorityOfKey(key))`.
- The player's 3x3x3 neighborhood is never skipped by the surface rules. Skipped chunks are absent: treat them as air above and solid below.
- Cost of a small move is `planner.lastUpdateOperations`, proportional to the shell (radius 24, one chunk: about 800 checks against an 11k volume, under 0.1 ms). Teleports and the first call are one full pass.

```ts
const scheduler = new PriorityScheduler<number>({ maxInFlight: 8, isCancelled: (key) => !wanted.has(key) });
for (const key of scheduler.takeBatch(8)) pool.run(key).finally(() => { scheduler.completeDispatch(); pump(); });
scheduler.reprioritize(key, newPriority); scheduler.remove(key);
```

## chunk-compression.ts

Lossless memory compression of a 32768 byte chunk (block ids or light): uniform (shared singleton, 0 bytes), 1/2/4 bit palette, run-length, raw fallback. Never larger than raw plus 4 bytes.

```ts
const compressed = compress(chunkBlocks);        // copies, never aliases
decompressInto(compressed, scratchBuffer);       // reuse one 32768 byte buffer
readCell(compressed, index);                     // no full decompress
isUniform(compressed); uniformValue(compressed); byteSize(compressed);
```

Benchmark (real Terralith terrain, seed 2024, 6x6 columns x chunk y -2..10, cached in the OS temp dir, never in the repo):

```
bun src/applications/game/world/chunk-compression.benchmark.ts [columnsPerSide]
```

Light in the benchmark is a stand-in (`initializeChunkLight` top-down, full sky above, no horizontal spreading), so real propagated light compresses somewhat worse.

## chunk-pipeline.ts

`ChunkPipeline` streams, generates, lights and meshes the chunks around the player and applies block edits. All worker access goes through injected backends (`pipeline-backends.ts`; the game's are `worker-backends.ts`, tests use `pipeline-fakes.test-helper.ts`), and results reach the game through events.

```ts
const pipeline = new ChunkPipeline({
  renderSettings: { horizontalRadius: 8, verticalUp: 3, verticalDown: 3 }, // render-settings.ts
  ...createWorkerBackends(pools, seed),
  events: { onMeshReady, onChunkUnloaded, savedEditsFor, highestEditedChunkY, onStartAreaProgress, onStartAreaReady },
});
pipeline.update(camera.position, camera.getWorldDirection(forward)); // every 100 ms; cheap when nothing moved
const edit = pipeline.applyBlockEdits(sphereEdits(center, 8, BlockType.STONE, "fill"));
await Promise.all(edit.meshesApplied); // every rebuilt chunk is on screen
pipeline.getBlock(x, y, z); pipeline.getLight(x, y, z); pipeline.setRenderSettings({ horizontalRadius: 12 });
```

Per chunk:

1. **Stream.** The planner (`streaming-plan.ts`) asks for the loaded volume: the render settings plus one ring (`BORDER_RING_CHUNKS`) that is generated and lit but never meshed, so every drawn chunk has its neighbors' borders. Until the start area is on screen it loads as a disc (no view-direction bias). Chunks that leave the unload volume are dropped with their queued work; results that arrive for them are ignored.
2. **Generate a column.** One `generateChunkColumn` call per column returns all its wanted chunks (uniform chunks as a block id, no array) and the column's surface chunk. Columns are queued per generation worker (`affinity-queues.ts`, by `chunkColumnAffinityKey` tiles, so a worker's worldgen caches serve neighboring columns); a worker takes another worker's column when that one is much nearer. Chunks more than `SKIP_ABOVE_SURFACE_MARGIN` above the surface are dropped unless next to the player, and read as air.
3. **Light a column.** When no chunk of a column waits for generation, its new chunks are lit in one `lightRegionFromSlabs` call. Lit chunks around the region are sent as slabs (`workers/region-surroundings.ts`): 14 layers from the touching face (light crossing in holds at most 14 and drops a level per step), a whole chunk below the region (full sky falls through). The light merges back into neighbors with `mergeLightReportingFaces`, which says which faces changed. Columns next to each other (diagonals too) are never lit at the same time, and a result is thrown away and redone when an edit wrote any chunk it read.
4. **Mesh once** (`mesh-coordinator.ts`). A chunk is meshed when it is lit, inside the drawn volume, and every loaded chunk of its 3 x 3 x 3 neighborhood is lit. All-air chunks, and solid cube chunks whose six touching layers are solid cubes, draw nothing without a worker call. Later changes bump `meshVersion` and queue one rebuild per chunk (deduplicated) that reads the newest data at dispatch; a result built from an older version is dropped. At most `workers + 1` builds are in flight, and edit rebuilds (`EDIT_MESH_PRIORITY`) go first.

Edits (`applyBlockEdits`) write blocks and relight in place on the main thread (`edits/apply-block-edits.ts`), mark the touched chunks as edited (in-flight light for them is redone) and rebuild `chunksToRemesh` ahead of streaming. Uniform chunks share one read-only array per block (`chunk-record.ts`); they are copied before any write.

`window.__voxelWorld` (`world-api.ts`) exposes `applyBlockBatch`, `applySphere`, render settings, `stats()`, `getBlock` and camera control while the game is mounted.
