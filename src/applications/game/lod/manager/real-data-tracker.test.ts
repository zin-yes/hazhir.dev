import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { BlockType } from "../../blocks";
import { cellIndexOf } from "../data/tile-surface";
import { createSyntheticChunk } from "../testing/synthetic-chunks.test-helper";
import { counterTotal, gaugeLast, startLodProfiling, stopLodProfiling, timerCalls } from "../testing/profiler-readout.test-helper";
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

describe("real data tracker profiling", () => {
  beforeEach(startLodProfiling);
  afterEach(stopLodProfiling);

  test("loading a column counts every chunk, the cells trusted and the pyramid levels refreshed", () => {
    const { tracker } = loadedTracker();
    tracker.reportToProfiler();

    expect(counterTotal("game.lod.real.chunksSummarized")).toBe(8);
    expect(counterTotal("game.lod.summary.chunks")).toBe(8);
    expect(counterTotal("game.lod.summary.blocksScanned")).toBeGreaterThan(8 * 1024);
    expect(counterTotal("game.lod.summary.solidColumns")).toBeGreaterThan(1024);
    expect(counterTotal("game.lod.real.columnsDirtied")).toBe(1);
    expect(counterTotal("game.lod.real.columnsApplied")).toBe(1);
    const node = tracker.pyramid.nodeAt({ level: 0, tileX: CHUNK_X, tileZ: CHUNK_Z })!;
    expect(counterTotal("game.lod.real.coveredCellsApplied")).toBe(node.coveredCellCount);
    expect(counterTotal("game.lod.assemble.cellsTrusted")).toBe(node.coveredCellCount);
    const assembledCells =
      counterTotal("game.lod.assemble.cellsTrusted") +
      counterTotal("game.lod.assemble.cellsBrokenByMissingChunk") +
      counterTotal("game.lod.assemble.cellsRejectedForUnloadedAbove") +
      counterTotal("game.lod.assemble.cellsWithoutSolid");
    expect(assembledCells).toBe(1024);
    expect(counterTotal("game.lod.pyramid.ancestorsRefreshed")).toBe(4);
    expect(counterTotal("game.lod.pyramid.nodesCreated")).toBe(5);
    expect(gaugeLast("game.lod.pyramid.nodes")).toBe(5);
    expect(gaugeLast("game.lod.real.summaries")).toBe(8);
    expect(timerCalls("main.lod.applyRealColumns.pyramid")).toBe(1);
  });

  test("an edit below the surface is a counted no-op while a surface edit dirties the column again", () => {
    const { tracker, chunks } = loadedTracker();
    const deepBlocks = chunks.get(1)!;
    deepBlocks[blockIndex(5, 3, 7)] = BlockType.AIR;
    tracker.recordChunkBlocks(CHUNK_X, 1, CHUNK_Z, deepBlocks);
    expect(counterTotal("game.lod.real.summariesUnchanged")).toBe(1);
    expect(counterTotal("game.lod.real.columnsDirtied")).toBe(1);

    const towerBlocks = chunks.get(6)!;
    towerBlocks[blockIndex(5, 8, 7)] = BlockType.COBBLESTONE;
    tracker.recordChunkBlocks(CHUNK_X, 6, CHUNK_Z, towerBlocks);
    expect(counterTotal("game.lod.real.summariesChanged")).toBe(1);
    expect(counterTotal("game.lod.real.columnsDirtied")).toBe(2);

    const overlay = tracker.overlayFor({ level: 0, tileX: CHUNK_X, tileZ: CHUNK_Z });
    expect(overlay).toBeDefined();
    expect(tracker.overlayFor({ level: 0, tileX: CHUNK_X + 40, tileZ: CHUNK_Z })).toBeUndefined();
    expect(counterTotal("game.lod.overlay.requests")).toBe(2);
    expect(counterTotal("game.lod.overlay.hits")).toBe(1);
    expect(counterTotal("game.lod.overlay.misses")).toBe(1);
    expect(counterTotal("game.lod.overlay.coveredCells")).toBe(tracker.pyramid.nodeAt({ level: 0, tileX: CHUNK_X, tileZ: CHUNK_Z })!.coveredCellCount);
  });
});
