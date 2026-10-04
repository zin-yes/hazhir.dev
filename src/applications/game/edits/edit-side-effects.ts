// What happens around a block edit besides the blocks and light themselves: remembering the changed blocks for saving
// (and for chunks that load later) and waking the water next to them. Written for brushes that change a hundred
// thousand blocks at once: consecutive changes mostly share a chunk, so per-chunk lookups are cached, and water is only
// searched in chunks that hold any.

import { BlockType, isWater } from "../blocks";
import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "../config";
import { calculateOffset } from "../utils";
import type { BlockChangeLog } from "./apply-block-edits";
import type { BlockEditBatch } from "./block-edit-batch";

const IS_WATER_BLOCK = (() => {
  const table = new Uint8Array(256);
  for (let block = 0; block < 256; block++) table[block] = isWater(block as BlockType) ? 1 : 0;
  return table;
})();

/** Saved edits per chunk ("x,y,z" -> chunk cell offset -> block), the game's save format. */
export interface SavedEditTarget {
  editsOfChunk(chunkX: number, chunkY: number, chunkZ: number): Map<number, number>;
}

/** Records every block in `xs/ys/zs/blocks[0..count)` as a saved edit. */
export function recordSavedEdits(
  target: SavedEditTarget,
  count: number,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  zs: ArrayLike<number>,
  blocks: ArrayLike<number>,
  shouldRecord: (position: number, chunkX: number, chunkY: number, chunkZ: number) => boolean = () => true,
): void {
  let cachedChunkX = Number.NaN;
  let cachedChunkY = Number.NaN;
  let cachedChunkZ = Number.NaN;
  let cachedEdits: Map<number, number> | null = null;
  for (let position = 0; position < count; position++) {
    const x = xs[position];
    const y = ys[position];
    const z = zs[position];
    const chunkX = Math.floor(x / CHUNK_WIDTH);
    const chunkY = Math.floor(y / CHUNK_HEIGHT);
    const chunkZ = Math.floor(z / CHUNK_LENGTH);
    if (!shouldRecord(position, chunkX, chunkY, chunkZ)) continue;
    if (cachedEdits === null || chunkX !== cachedChunkX || chunkY !== cachedChunkY || chunkZ !== cachedChunkZ) {
      cachedEdits = target.editsOfChunk(chunkX, chunkY, chunkZ);
      cachedChunkX = chunkX;
      cachedChunkY = chunkY;
      cachedChunkZ = chunkZ;
    }
    cachedEdits.set(
      calculateOffset(x - chunkX * CHUNK_WIDTH, y - chunkY * CHUNK_HEIGHT, z - chunkZ * CHUNK_LENGTH),
      blocks[position],
    );
  }
}

/** Saves the edits of a batch that land in chunks without blocks, so they apply when the chunk loads. */
export function recordEditsOutsideLoadedChunks(
  target: SavedEditTarget,
  batch: BlockEditBatch,
  hasChunkBlocks: (chunkX: number, chunkY: number, chunkZ: number) => boolean,
): void {
  let cachedKey = "";
  let cachedHasBlocks = false;
  recordSavedEdits(target, batch.length, batch.xs, batch.ys, batch.zs, batch.blocks, (_position, chunkX, chunkY, chunkZ) => {
    const key = `${chunkX},${chunkY},${chunkZ}`;
    if (key !== cachedKey) {
      cachedKey = key;
      cachedHasBlocks = hasChunkBlocks(chunkX, chunkY, chunkZ);
    }
    return !cachedHasBlocks;
  });
}

const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/**
 * Wakes the water touching changed blocks: a change whose old block was water, or that has water at or next to it,
 * schedules itself and its six neighbors. Chunks without water are skipped after one scan each.
 */
export function wakeWaterAroundChanges(
  changes: BlockChangeLog,
  chunkBlocks: (chunkX: number, chunkY: number, chunkZ: number) => Uint8Array | null | undefined,
  scheduleWaterUpdate: (x: number, y: number, z: number) => void,
): void {
  const waterByChunk = new Map<string, Uint8Array | null>();
  const waterCellsOf = (chunkX: number, chunkY: number, chunkZ: number) => {
    const key = `${chunkX},${chunkY},${chunkZ}`;
    let blocks = waterByChunk.get(key);
    if (blocks === undefined) {
      const candidate = chunkBlocks(chunkX, chunkY, chunkZ);
      blocks = null;
      if (candidate) {
        for (let index = 0; index < candidate.length; index++) {
          if (IS_WATER_BLOCK[candidate[index]] === 1) {
            blocks = candidate;
            break;
          }
        }
      }
      waterByChunk.set(key, blocks);
    }
    return blocks;
  };
  let lastChunkX = Number.NaN;
  let lastChunkY = Number.NaN;
  let lastChunkZ = Number.NaN;
  let lastBlocks: Uint8Array | null = null;
  const isWaterAt = (x: number, y: number, z: number) => {
    const chunkX = Math.floor(x / CHUNK_WIDTH);
    const chunkY = Math.floor(y / CHUNK_HEIGHT);
    const chunkZ = Math.floor(z / CHUNK_LENGTH);
    if (chunkX !== lastChunkX || chunkY !== lastChunkY || chunkZ !== lastChunkZ) {
      lastBlocks = waterCellsOf(chunkX, chunkY, chunkZ);
      lastChunkX = chunkX;
      lastChunkY = chunkY;
      lastChunkZ = chunkZ;
    }
    const blocks = lastBlocks;
    if (!blocks) return false;
    return (
      IS_WATER_BLOCK[
        blocks[calculateOffset(x - chunkX * CHUNK_WIDTH, y - chunkY * CHUNK_HEIGHT, z - chunkZ * CHUNK_LENGTH)]
      ] === 1
    );
  };

  for (let position = 0; position < changes.count; position++) {
    const x = changes.x[position];
    const y = changes.y[position];
    const z = changes.z[position];
    let touchesWater = IS_WATER_BLOCK[changes.oldBlock[position]] === 1;
    for (let neighbor = 0; !touchesWater && neighbor < NEIGHBOR_OFFSETS.length; neighbor++) {
      const [offsetX, offsetY, offsetZ] = NEIGHBOR_OFFSETS[neighbor];
      touchesWater = isWaterAt(x + offsetX, y + offsetY, z + offsetZ);
    }
    if (!touchesWater) continue;
    for (const [offsetX, offsetY, offsetZ] of NEIGHBOR_OFFSETS) scheduleWaterUpdate(x + offsetX, y + offsetY, z + offsetZ);
  }
}
