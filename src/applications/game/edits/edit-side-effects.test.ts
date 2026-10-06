import { describe, expect, test } from "bun:test";
import { BlockType } from "../blocks";
import { calculateOffset } from "../utils";
import { counterTotal, withEnabledProfiler } from "../world/profiler-readings.test-helper";
import type { BlockChangeLog } from "./apply-block-edits";
import { sphereEdits } from "./block-edit-batch";
import { recordEditsOutsideLoadedChunks, recordSavedEdits, wakeWaterAroundChanges, type SavedEditTarget } from "./edit-side-effects";

function createTarget() {
  const chunks = new Map<string, Map<number, number>>();
  const target: SavedEditTarget = {
    editsOfChunk(chunkX, chunkY, chunkZ) {
      const name = `${chunkX},${chunkY},${chunkZ}`;
      let edits = chunks.get(name);
      if (!edits) chunks.set(name, (edits = new Map()));
      return edits;
    },
  };
  return { chunks, target };
}

function changeLogOf(cells: Array<[number, number, number, number, number]>): BlockChangeLog {
  return {
    count: cells.length,
    x: Int32Array.from(cells.map((cell) => cell[0])),
    y: Int32Array.from(cells.map((cell) => cell[1])),
    z: Int32Array.from(cells.map((cell) => cell[2])),
    oldBlock: Uint8Array.from(cells.map((cell) => cell[3])),
    newBlock: Uint8Array.from(cells.map((cell) => cell[4])),
  };
}

describe("edit side effects", () => {
  test("a sphere across chunk borders saves every block under its own chunk and cell, negative coordinates included", () => {
    const startedAt = performance.now();
    const { chunks, target } = createTarget();
    const sphere = sphereEdits({ x: -1, y: 31, z: 0 }, 5, BlockType.STONE, "fill");
    recordSavedEdits(target, sphere.length, sphere.xs, sphere.ys, sphere.zs, sphere.blocks);
    let saved = 0;
    chunks.forEach((edits) => (saved += edits.size));
    expect(saved).toBe(sphere.length);
    expect(chunks.size).toBe(8);
    expect(chunks.get("-1,0,-1")!.get(calculateOffset(31, 31, 31))).toBe(BlockType.STONE);
    expect(chunks.get("0,1,0")!.get(calculateOffset(0, 0, 0))).toBe(BlockType.STONE);
    console.log(`saved edits test: ${(performance.now() - startedAt).toFixed(1)} ms`);
  });

  test("only edits in chunks without blocks are saved ahead of loading", () => {
    const { chunks, target } = createTarget();
    const sphere = sphereEdits({ x: 0, y: 16, z: 16 }, 3, BlockType.DIRT, "fill");
    recordEditsOutsideLoadedChunks(target, sphere, (chunkX) => chunkX === 0);
    expect([...chunks.keys()]).toEqual(["-1,0,0"]);
    expect(chunks.get("-1,0,0")!.size).toBeGreaterThan(0);
  });

  test("changes touching water wake it and its neighbors; changes in dry chunks wake nothing", () => {
    const wetChunk = new Uint8Array(32768);
    wetChunk[calculateOffset(10, 5, 10)] = BlockType.WATER;
    const dryChunk = new Uint8Array(32768).fill(BlockType.STONE);
    const chunkBlocks = (chunkX: number) => (chunkX === 0 ? wetChunk : dryChunk);
    const woken = new Set<string>();
    const changes = changeLogOf([
      [11, 5, 10, BlockType.STONE, BlockType.AIR],
      [40, 5, 10, BlockType.STONE, BlockType.AIR],
      [31, 5, 10, BlockType.STONE, BlockType.AIR],
      [50, 6, 10, BlockType.WATER, BlockType.AIR],
    ]);
    wakeWaterAroundChanges(changes, chunkBlocks, (x, y, z) => woken.add(`${x},${y},${z}`));
    expect(woken.has("11,5,10")).toBe(true);
    expect(woken.has("10,5,10")).toBe(true);
    expect(woken.has("50,6,10")).toBe(true);
    expect(woken.has("40,5,10")).toBe(false);
    expect(woken.has("31,5,10")).toBe(false);
    expect(woken.size).toBe(14);
  });

  test("profiling counts saved edits per chunk lookup, skipped positions and the water scan work", () => {
    const wetChunk = new Uint8Array(32768);
    wetChunk[calculateOffset(10, 5, 10)] = BlockType.WATER;
    const dryChunk = new Uint8Array(32768).fill(BlockType.STONE);
    const changes = changeLogOf([
      [11, 5, 10, BlockType.STONE, BlockType.AIR],
      [40, 5, 10, BlockType.STONE, BlockType.AIR],
      [31, 5, 10, BlockType.STONE, BlockType.AIR],
      [50, 6, 10, BlockType.WATER, BlockType.AIR],
    ]);
    const { target } = createTarget();
    const sphere = sphereEdits({ x: 0, y: 16, z: 16 }, 3, BlockType.DIRT, "fill");
    withEnabledProfiler(() => {
      wakeWaterAroundChanges(changes, (chunkX) => (chunkX === 0 ? wetChunk : dryChunk), () => {});
      expect(counterTotal("game.edit.sideEffect.waterChangesExamined")).toBe(4);
      expect(counterTotal("game.edit.sideEffect.waterChangesTouchingWater")).toBe(2);
      expect(counterTotal("game.edit.sideEffect.waterUpdatesScheduled")).toBe(14);
      expect(counterTotal("game.edit.sideEffect.waterChunksScanned")).toBe(2);
      expect(counterTotal("game.edit.sideEffect.waterChunksWithWater")).toBe(1);
      const scanned = counterTotal("game.edit.sideEffect.waterCellsScanned");
      expect(scanned).toBeGreaterThan(32768);
      expect(scanned).toBeLessThan(2 * 32768);

      recordEditsOutsideLoadedChunks(target, sphere, (chunkX) => chunkX === 0);
      const savedOutside = counterTotal("game.edit.sideEffect.outsideLoadedPositionsSaved");
      expect(savedOutside).toBeGreaterThan(0);
      expect(savedOutside).toBeLessThan(sphere.length);
      expect(counterTotal("game.edit.sideEffect.savedEditsRecorded")).toBe(savedOutside);
      expect(counterTotal("game.edit.sideEffect.savedEditsSkipped")).toBe(sphere.length - savedOutside);
    });
  });
});
