import { describe, expect, test } from "bun:test";
import { BlockType } from "../blocks";
import { DIMENSIONS } from "../profiler/dimensions";
import { breakdownUnits, byteTotal, counterTotal, withEnabledProfiler } from "../world/profiler-readings.test-helper";
import { BlockEditBatch, boxEdits, sphereEdits } from "./block-edit-batch";

function cellsOf(batch: BlockEditBatch): Set<string> {
  const cells = new Set<string>();
  for (let position = 0; position < batch.length; position++) {
    cells.add(`${batch.xs[position]},${batch.ys[position]},${batch.zs[position]}`);
  }
  return cells;
}

describe("sphereEdits", () => {
  test("covers exactly the blocks within the radius, each once", () => {
    const center = { x: -5, y: 70, z: 33 };
    const radius = 9.5;
    const batch = sphereEdits(center, radius, BlockType.STONE, "fill");

    const expected = new Set<string>();
    for (let x = -12; x <= 12; x++)
      for (let y = -12; y <= 12; y++)
        for (let z = -12; z <= 12; z++)
          if (x * x + y * y + z * z <= radius * radius)
            expected.add(`${center.x + x},${center.y + y},${center.z + z}`);

    expect(batch.length).toBe(expected.size);
    expect(cellsOf(batch)).toEqual(expected);
  });

  test("grows past its first estimate for a large radius without losing cells", () => {
    const batch = sphereEdits({ x: 0, y: 0, z: 0 }, 40, BlockType.STONE, "fill");
    expect(batch.length).toBeGreaterThan(260000);
    expect(batch.length).toBeLessThan(280000);
    expect(cellsOf(batch).size).toBe(batch.length);
  });

  test("a zero radius is the center block alone", () => {
    const batch = sphereEdits({ x: 3, y: 4, z: 5 }, 0, BlockType.GLASS, "fill");
    expect(batch.length).toBe(1);
    expect([batch.xs[0], batch.ys[0], batch.zs[0], batch.blocks[0]]).toEqual([3, 4, 5, BlockType.GLASS]);
  });

  test("erase paints air and each mode carries the replace rule that matches it", () => {
    const center = { x: 0, y: 0, z: 0 };
    const erase = sphereEdits(center, 3, BlockType.STONE, "erase");
    expect(erase.blocks.subarray(0, erase.length).every((block) => block === BlockType.AIR)).toBe(true);
    expect(erase.replaceRule).toBe("nonAirOnly");
    expect(sphereEdits(center, 3, BlockType.STONE, "fill").replaceRule).toBe("any");
    expect(sphereEdits(center, 3, BlockType.STONE, "fillAirOnly").replaceRule).toBe("airOnly");
    expect(sphereEdits(center, 3, BlockType.STONE, "replaceNonAirOnly").replaceRule).toBe("nonAirOnly");
  });
});

describe("boxEdits", () => {
  test("covers the inclusive box whichever way round the corners are given", () => {
    const batch = boxEdits({ x: 5, y: -2, z: 9 }, { x: 2, y: 0, z: 10 }, BlockType.PLANKS, "fill");
    expect(batch.length).toBe(4 * 3 * 2);
    const cells = cellsOf(batch);
    expect(cells.has("2,-2,9")).toBe(true);
    expect(cells.has("5,0,10")).toBe(true);
    expect(cells.size).toBe(batch.length);
  });
});

describe("BlockEditBatch", () => {
  test("converts to and from plain edit objects", () => {
    const edits = [
      { x: 1, y: 2, z: 3, block: BlockType.STONE },
      { x: -4, y: 5, z: -6, block: BlockType.AIR },
    ];
    const batch = BlockEditBatch.fromEdits(edits);
    expect(batch.toEdits()).toEqual(edits);
  });

  test("keeps every edit when it grows well past its initial capacity", () => {
    const batch = new BlockEditBatch("any", 2);
    for (let position = 0; position < 5000; position++) batch.push(position, -position, position * 2, position % 200);
    expect(batch.length).toBe(5000);
    expect(batch.xs[4999]).toBe(4999);
    expect(batch.ys[4999]).toBe(-4999);
    expect(batch.zs[4999]).toBe(9998);
    expect(batch.blocks[4999]).toBe(4999 % 200);
  });
});

describe("block edit batch profiling", () => {
  test("counts generated cells per brush mode, batch memory and the objects converted to and from a batch", () => {
    withEnabledProfiler(() => {
      const filled = sphereEdits({ x: 0, y: 70, z: 0 }, 6, BlockType.STONE, "fill");
      const erased = sphereEdits({ x: 40, y: 70, z: 0 }, 4, BlockType.STONE, "erase");
      const box = boxEdits({ x: 0, y: 0, z: 0 }, { x: 4, y: 2, z: 3 }, BlockType.DIRT, "fillAirOnly");
      expect(counterTotal("game.edit.spheresBuilt")).toBe(2);
      expect(counterTotal("game.edit.boxesBuilt")).toBe(1);
      expect(counterTotal("game.edit.cellsGenerated")).toBe(filled.length + erased.length + box.length);
      expect(box.length).toBe(5 * 3 * 4);
      expect(breakdownUnits(DIMENSIONS.editMode, "fill")).toBe(filled.length);
      expect(breakdownUnits(DIMENSIONS.editMode, "erase")).toBe(erased.length);
      expect(byteTotal("bytes.edit.batch")).toBe(filled.allocatedBytes + erased.allocatedBytes + box.allocatedBytes);

      const objects = BlockEditBatch.fromEdits(box.toEdits());
      expect(objects.length).toBe(box.length);
      expect(counterTotal("game.edit.objectEditsConverted")).toBe(box.length);
      expect(counterTotal("game.edit.objectEditsAllocated")).toBe(box.length);
    });
  });
});
