import { describe, expect, test } from "bun:test";
import { BlockType } from "./blocks";
import { profiler } from "./profiler";
import { DIMENSIONS } from "./profiler/dimensions";
import { TickableBlockIndex, pickTickedBlocks } from "./random-tick";

describe("TickableBlockIndex", () => {
  const isTickable = (block: number) => block === 7 || block === 9;

  test("lists exactly the reacting blocks", () => {
    const chunk = new Uint8Array(100);
    chunk[3] = 7;
    chunk[40] = 9;
    chunk[41] = 1;
    const indices = new TickableBlockIndex().indicesFor(chunk, 0, isTickable);
    expect(Array.from(indices)).toEqual([3, 40]);
  });

  test("rescans after the chunk version changes but not before", () => {
    const index = new TickableBlockIndex();
    const chunk = new Uint8Array(100);
    chunk[3] = 7;
    expect(Array.from(index.indicesFor(chunk, 0, isTickable))).toEqual([3]);

    chunk[50] = 9;
    expect(Array.from(index.indicesFor(chunk, 0, isTickable))).toEqual([3]);
    expect(Array.from(index.indicesFor(chunk, 1, isTickable))).toEqual([3, 50]);
  });
});

describe("pickTickedBlocks", () => {
  test("only ever returns reacting blocks", () => {
    const tickable = Uint32Array.from([5, 900, 31000]);
    const hits = pickTickedBlocks(tickable, 32768, 100000);
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(tickable).toContain(hit);
  });

  test("hits as often as uniform picks over the whole chunk would", () => {
    const tickable = Uint32Array.from(
      { length: 1000 },
      (_, index) => index * 3,
    );
    const picks = 200000;
    const hits = pickTickedBlocks(tickable, 32768, picks);
    const expected = picks * (1000 / 32768);
    expect(hits.length).toBeGreaterThan(expected * 0.9);
    expect(hits.length).toBeLessThan(expected * 1.1);
  });

  test("a chunk with nothing to tick costs no picks", () => {
    expect(pickTickedBlocks(new Uint32Array(0), 32768, 100)).toEqual([]);
  });
});

describe("random tick profiling", () => {
  test("a rescan credits the tickable population per block type and separates first scans from stale ones", () => {
    profiler.reset("random-tick-test");
    profiler.setEnabled(true);
    try {
      const chunk = new Uint8Array(32768).fill(BlockType.STONE);
      for (const index of [10, 500, 9000]) chunk[index] = BlockType.SAPLING;
      for (const index of [1, 2, 3, 4, 5]) chunk[index] = BlockType.GRASS;
      const reactsToTicks = (block: number) => block === BlockType.SAPLING || block === BlockType.GRASS;
      const tickableIndex = new TickableBlockIndex();

      tickableIndex.indicesFor(chunk, 0, reactsToTicks);
      tickableIndex.indicesFor(chunk, 0, reactsToTicks);
      chunk[20000] = BlockType.GRASS;
      tickableIndex.indicesFor(chunk, 1, reactsToTicks);

      const snapshot = profiler.snapshot();
      const counterTotal = (name: string) => snapshot.counters.find((counter) => counter.name === name)?.total;
      expect(counterTotal("game.randomTick.indexRescansFirstSeen")).toBe(1);
      expect(counterTotal("game.randomTick.indexRescansStale")).toBe(1);
      expect(counterTotal("game.randomTick.indexCacheHits")).toBe(1);
      expect(counterTotal("game.randomTick.tickableBlocksFound")).toBe(8 + 9);
      const entries =
        snapshot.breakdowns.find((breakdown) => breakdown.dimension === DIMENSIONS.randomTickBlock)?.entries ?? [];
      expect(entries.find((entry) => entry.key === "SAPLING")?.units).toBe(6);
      expect(entries.find((entry) => entry.key === "GRASS")?.units).toBe(5 + 6);
    } finally {
      profiler.setEnabled(false);
    }
  });
});
