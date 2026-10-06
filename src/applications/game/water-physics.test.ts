import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { BlockType, getWaterLevel } from "./blocks";
import { profiler } from "./profiler";
import { DIMENSIONS } from "./profiler/dimensions";
import { updateWater } from "./water-physics";

function createWorld(initialBlocks: [string, BlockType][] = []) {
  const blocks = new Map<string, BlockType>(initialBlocks);
  const scheduled: string[] = [];
  const keyOf = (x: number, y: number, z: number) => `${x},${y},${z}`;
  return {
    blocks,
    scheduled,
    getBlock: (x: number, y: number, z: number) =>
      blocks.get(keyOf(x, y, z)) ?? (y < 0 ? BlockType.STONE : BlockType.AIR),
    setBlock: (x: number, y: number, z: number, block: BlockType) => void blocks.set(keyOf(x, y, z), block),
    scheduleUpdate: (x: number, y: number, z: number) => void scheduled.push(keyOf(x, y, z)),
  };
}

function counterTotal(name: string) {
  return profiler.snapshot().counters.find((counter) => counter.name === name)?.total ?? 0;
}

describe("water physics profiling", () => {
  beforeEach(() => {
    profiler.reset("water-test");
    profiler.setEnabled(true);
  });
  afterEach(() => profiler.setEnabled(false));

  test("a source on stone spreads to its four open sides and each spread is counted", () => {
    const world = createWorld([["0,0,0", BlockType.WATER]]);
    updateWater(0, 0, 0, world.getBlock, world.setBlock, world.scheduleUpdate);

    expect(counterTotal("game.water.cellsUpdated")).toBe(1);
    expect(counterTotal("game.water.sourceCellsUpdated")).toBe(1);
    expect(counterTotal("game.water.spreadSide")).toBe(4);
    expect(counterTotal("game.water.stateChanges")).toBe(0);
    expect(world.scheduled).toHaveLength(4);
  });

  test("an empty cell beside a source fills to level 7 and is attributed to that level", () => {
    const world = createWorld([["0,0,0", BlockType.WATER]]);
    updateWater(1, 0, 0, world.getBlock, world.setBlock, world.scheduleUpdate);

    expect(getWaterLevel(world.getBlock(1, 0, 0) as BlockType)).toBe(7);
    expect(counterTotal("game.water.stateChanges")).toBe(1);
    const levelEntries =
      profiler.snapshot().breakdowns.find((breakdown) => breakdown.dimension === DIMENSIONS.waterLevel)?.entries ?? [];
    expect(levelEntries.find((entry) => entry.key === "7")?.units).toBe(1);
  });

  test("a stone cell is skipped and counted as skipped", () => {
    const world = createWorld();
    updateWater(0, -1, 0, world.getBlock, world.setBlock, world.scheduleUpdate);

    expect(counterTotal("game.water.skippedSolid")).toBe(1);
    expect(counterTotal("game.water.stateChanges")).toBe(0);
    expect(world.scheduled).toHaveLength(0);
  });
});
