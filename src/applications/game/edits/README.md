# Bulk block edits and light

Pure, typed-array code (no DOM, no main-thread profiler) that changes many
blocks at once and relights them with one batched update. It also holds the
flood-fill core that chunk lighting in `workers/lighting.ts` runs on.

## Using it

```ts
import { applyBlockEdits } from "./edits/apply-block-edits";
import { sphereEdits } from "./edits/block-edit-batch";

const result = applyBlockEdits(
  lightChunkSource, // { getBlocks(cx, cy, cz), getLight(cx, cy, cz) } over the live chunk arrays
  sphereEdits({ x, y, z }, 8, BlockType.STONE, "fill"),
);
result.chunksToRemesh.forEach(requestRemesh); // nearest to the edit first
```

- `applyBlockEdits(source, edits, { recordChanges?, onPhase? })` writes the
  blocks into the chunk arrays, relights in place, and returns:
  - `changedChunks`: chunks whose block or light data was written.
  - `chunksToRemesh`: the minimal remesh set. A chunk is listed when one of its
    blocks or light values changed, and its face neighbor is listed when a cell
    on the layer touching it changed (meshes read that layer as border data).
    Only loaded, lit chunks are listed. Sorted nearest to the edit first.
  - `changes`: every changed block as parallel typed arrays (world x, y, z, old
    and new block), for saved edits, water scheduling and networking.
    `recordChanges: false` skips building it.
  - `stats`: counts and per-phase milliseconds.
- `edits` is a `BlockEditBatch` (typed arrays, no per-edit objects) or a plain
  `{ x, y, z, block }[]`.
- Brushes: `sphereEdits(center, radius, block, mode)` and
  `boxEdits(cornerA, cornerB, block, mode)`. Modes: `fill` (overwrite),
  `erase` (solid to air), `fillAirOnly` (paint air, never overwrite) and
  `replaceNonAirOnly` (repaint solid blocks only).
- `relightAfterBlocksWritten(source, [{ x, y, z, oldBlock }])` relights blocks
  the caller already wrote; `light-engine.ts`'s `relightAfterBlockChange` is
  the single block case of it (same API as before).
- `onPhase(phase, hasStarted)` lets a main-thread profiler wrap each phase.
  Inside a worker the phases are also recorded as `worker-recorder` sections
  (`writeBlocks`, `seedLightChanges`, `removeSkyLight`, `removeBlockLight`,
  `refillLight`, `collectChunks`) with counters.

## How it stays exact

Light is `(sky << 4) | block` per cell, the closure of a flood fill: one level
lost per step, except sky 15 which falls straight down undimmed. A batch is:
write every block, zero the light that flowed through or from each changed cell
and let the removal waves (one queue per channel) eat everything that depended
on it, then one refill flood from the lit cells left around the holes and from
new glowing blocks. The result equals a from-scratch flood of the final world.

Rules worth knowing:

- Chunks that are not loaded (or have blocks but no light yet) are never read
  or written for light. Edits inside a chunk with no blocks are skipped and
  counted in `stats.editsInUnloadedChunks`.
- With no loaded chunk above a chunk, the sky above it is assumed open: a cell
  that becomes transparent in the top layer gets sky 15. This is the same rule
  initial lighting uses at the top of a column.
- Glowing blocks that a removal wave zeroes (a torch inside a lamp's light) are
  restored before the refill.
- The same cell edited twice in one batch ends as its last write.

## Chunk lighting pieces

- `workers/lighting.ts`: `initializeChunkLight` no longer samples terrain. Sky
  enters a column when the chunk above says so (its light, else its blocks).
  With nothing above, from sea level up the sky is assumed open and below sea
  level only water columns are lit. Differences from the old terrain sampling
  show up only as extra light: carved openings below the sampled ground height,
  caves open in the top layer above sea level, and water-filled caves below it.
  `propagateChunkLight` is the same flood as before on typed ring queues
  (results are bit identical to the previous version on generated terrain).
- `workers/region-lighting.ts`: `lightChunkRegion(chunks, surroundings?)` lights
  a whole set of fresh chunks (init top-down, spread, merge) in one worker
  call; worker method `lightChunkRegion` takes `[chunks, surroundingChunks?]`
  and transfers every returned light buffer.
- `edits/merge-light.ts`: `mergeLightInPlace(target, update)` and
  `mergeLightUpdatesInPlace(target, updates)` raise light to the per-channel
  max, four cells per step. Use these instead of a per-byte `Math.max` loop (a
  whole-byte max lets a high sky level overwrite a higher block level).

## Benchmark

```
bun run src/applications/game/edits/bulk-edit.bench.ts [--radii=4,8,16,32] [--repeats=15]
```

Generates terrain around the spawn point (about 6 s the first time), lights it,
then times sphere place (touching ground), place floating (long sky shadow) and
erase (dig) for each radius, restoring the world between runs. CPU time only;
the remesh happens elsewhere.

## Tests

- `apply-block-edits.test.ts` compares every kind of edit (spheres, cubes,
  scatter with duplicates, tunnels, lamps, column tops, unloaded chunks) with a
  from-scratch flood written independently in `light-test-world.test-helper.ts`
  and checks that `chunksToRemesh` covers every chunk whose mesh inputs changed.
- `workers/lighting.differential.test.ts` compares the load pass with the same
  flood on generated terrain.

## Sphere brush (`brush/`)

`B` toggles the brush while playing; `[` / `]` or Shift + mouse wheel set the radius (1..64, default 6). Left mouse
erases a sphere centered on the targeted block, right mouse paints the selected hotbar block centered on the cell in
front of the hit face (24 block reach; without a hit, 24 blocks in front of the camera). Ctrl while painting only
repaints solid blocks, Alt only fills air. Holding a button keeps drawing, at most one sphere per frame and only after
the center moved a quarter radius. A wireframe sphere (`brush-preview.ts`, one mesh for the session) shows the target.

A brush sphere is split into one piece per chunk (`edit-slicing.ts`), nearest to the center first, and the pieces
run through the bulk edit path under an 8 ms budget per frame (one piece always runs), so a big sphere spreads over a
few frames instead of stalling one; `applySphere` from scripts still applies a sphere in one batch. Saved edits and water
wakeups run through `edit-side-effects.ts`, peers get one `BLOCK_BATCH` packet of y runs
(`network/block-batch-codec.ts`, about 190 KB for a radius 64 sphere). `window.__voxelWorld.setBrush` / `getBrush`
drive it from scripts; `getBrush().lastEdit` holds the last sphere's `onScreenMilliseconds`.

Measured (Apple M5, real radius 8, click to all rebuilt chunks on screen, worst frame interval): radius 8 7-24 ms
(19 ms), 16 12-19 ms (18 ms), 32 about 100 ms (25 ms; one unsliced batch stalled a frame about 60 ms); `applySphere`
radius 64 (one million blocks) 0.5-0.6 s.
