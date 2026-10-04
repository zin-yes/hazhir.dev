import { describe, expect, test } from "bun:test";
import { BlockType } from "../../blocks";
import { cellIndexOf } from "../data/tile-surface";
import { createSyntheticChunk } from "../testing/synthetic-chunks.test-helper";
import { syntheticHeightAt } from "../testing/synthetic-terrain.test-helper";
import { RealDataTracker } from "./real-data-tracker";

const CHUNK_X = 9;
const CHUNK_Z = 9;

function blockIndex(localX: number, localY: number, localZ: number): number {
  return localX * 1024 + localY * 32 + localZ;
}

function loadedTracker() {
  const tracker = new RealDataTracker(16 * 1024 * 1024, 4);
  const chunks = new Map<number, Uint8Array>();
  for (let chunkY = 0; chunkY <= 7; chunkY++) {
    const blocks = createSyntheticChunk(CHUNK_X, chunkY, CHUNK_Z);
    chunks.set(chunkY, blocks);
    tracker.recordChunkBlocks(CHUNK_X, chunkY, CHUNK_Z, blocks);
  }
  tracker.applyPendingColumns(8);
  return { tracker, chunks };
}

describe("real data tracker", () => {
  test("a surface edit refreshes the column in the pyramid; digging underground changes nothing", () => {
    const startedAt = performance.now();
    const { tracker, chunks } = loadedTracker();
    const node = tracker.pyramid.nodeAt({ level: 0, tileX: CHUNK_X, tileZ: CHUNK_Z })!;
    const versionBefore = node.version;
    const localX = 5;
    const localZ = 7;
    const ground = syntheticHeightAt(CHUNK_X * 32 + localX, CHUNK_Z * 32 + localZ);
    expect(node.surface.heights[cellIndexOf(localX, localZ)]!).toBeGreaterThanOrEqual(ground);

    const deepChunkY = Math.floor((ground - 20) / 32);
    const deepBlocks = chunks.get(deepChunkY)!;
    deepBlocks[blockIndex(localX, (ground - 20) % 32, localZ)] = BlockType.AIR;
    tracker.recordChunkBlocks(CHUNK_X, deepChunkY, CHUNK_Z, deepBlocks);
    expect(tracker.pendingColumnCount).toBe(0);

    const towerTop = 200;
    const towerChunkY = Math.floor(towerTop / 32);
    const towerBlocks = chunks.get(towerChunkY)!;
    towerBlocks[blockIndex(localX, towerTop % 32, localZ)] = BlockType.COBBLESTONE;
    tracker.recordChunkBlocks(CHUNK_X, towerChunkY, CHUNK_Z, towerBlocks);
    expect(tracker.pendingColumnCount).toBe(1);
    const changed = tracker.applyPendingColumns(8);
    expect(changed.map((address) => address.level)).toEqual([0, 1, 2, 3, 4]);
    expect(node.surface.heights[cellIndexOf(localX, localZ)]).toBe(towerTop + 1);
    expect(node.surface.topBlocks[cellIndexOf(localX, localZ)]).toBe(BlockType.COBBLESTONE);
    expect(node.version).toBeGreaterThan(versionBefore);
    expect(tracker.overlayFor({ level: 0, tileX: CHUNK_X, tileZ: CHUNK_Z })!.surface.heights[cellIndexOf(localX, localZ)]).toBe(towerTop + 1);
    console.log(`tracker edit test: ${(performance.now() - startedAt).toFixed(1)} ms`);
  });

  test("forgetting chunks keeps what the pyramid learned but drops their summaries", () => {
    const { tracker } = loadedTracker();
    for (let chunkY = 0; chunkY <= 7; chunkY++) tracker.forgetChunk(CHUNK_X, chunkY, CHUNK_Z);
    expect(tracker.pyramid.nodeAt({ level: 0, tileX: CHUNK_X, tileZ: CHUNK_Z })).toBeDefined();
    tracker.recordChunkBlocks(CHUNK_X, 3, CHUNK_Z, createSyntheticChunk(CHUNK_X, 3, CHUNK_Z));
    expect(tracker.pendingColumnCount).toBe(1);
  });
});
