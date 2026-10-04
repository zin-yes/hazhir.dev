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
