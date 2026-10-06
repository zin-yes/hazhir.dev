import { describe, expect, test } from "bun:test";
import { extractBorderSlab } from "./chunk-borders";
import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "./config";
import { DIMENSIONS } from "./profiler/dimensions";
import { calculateOffset } from "./utils";
import { breakdownUnits, byteTotal, counterTotal, withEnabledProfiler } from "./world/profiler-readings.test-helper";

// Every block holds a value that identifies its coordinates, so a slab read from
// the wrong layer or in the wrong layout cannot match by accident.
function labeledChunk() {
  const chunk = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH);
  for (let x = 0; x < CHUNK_WIDTH; x++)
    for (let y = 0; y < CHUNK_HEIGHT; y++)
      for (let z = 0; z < CHUNK_LENGTH; z++) {
        chunk[calculateOffset(x, y, z)] = (x * 7 + y * 13 + z * 31) % 251;
      }
  return chunk;
}

const label = (x: number, y: number, z: number) =>
  (x * 7 + y * 13 + z * 31) % 251;

describe("extractBorderSlab", () => {
  const chunk = labeledChunk();

  test("top takes the lowest layer as [x * length + z]", () => {
    const slab = new Uint8Array(extractBorderSlab(chunk, "top"));
    expect(slab.length).toBe(CHUNK_WIDTH * CHUNK_LENGTH);
    expect(slab[5 * CHUNK_LENGTH + 9]).toBe(label(5, 0, 9));
    expect(slab[31 * CHUNK_LENGTH + 31]).toBe(label(31, 0, 31));
  });

  test("bottom takes the highest layer as [x * length + z]", () => {
    const slab = new Uint8Array(extractBorderSlab(chunk, "bottom"));
    expect(slab[5 * CHUNK_LENGTH + 9]).toBe(label(5, CHUNK_HEIGHT - 1, 9));
    expect(slab[0]).toBe(label(0, CHUNK_HEIGHT - 1, 0));
  });

  test("right takes x = 0 and left takes the highest x, both as [y * length + z]", () => {
    const right = new Uint8Array(extractBorderSlab(chunk, "right"));
    const left = new Uint8Array(extractBorderSlab(chunk, "left"));
    expect(right[12 * CHUNK_LENGTH + 3]).toBe(label(0, 12, 3));
    expect(left[12 * CHUNK_LENGTH + 3]).toBe(label(CHUNK_WIDTH - 1, 12, 3));
    expect(left.length).toBe(CHUNK_HEIGHT * CHUNK_LENGTH);
  });

  test("front takes z = 0 and back takes the highest z, both as [x * height + y]", () => {
    const front = new Uint8Array(extractBorderSlab(chunk, "front"));
    const back = new Uint8Array(extractBorderSlab(chunk, "back"));
    expect(front[20 * CHUNK_HEIGHT + 4]).toBe(label(20, 4, 0));
    expect(back[20 * CHUNK_HEIGHT + 4]).toBe(label(20, 4, CHUNK_LENGTH - 1));
  });

  test("slabs are copies, so transferring one never detaches the chunk", () => {
    extractBorderSlab(chunk, "right");
    expect(chunk.buffer.byteLength).toBeGreaterThan(0);
    expect(new Uint8Array(extractBorderSlab(chunk, "right")).buffer).not.toBe(
      chunk.buffer,
    );
  });
});

describe("extractBorderSlab profiling", () => {
  test("counts every face by copy strategy and the bytes copied, with the strided faces called out", () => {
    const chunk = labeledChunk();
    withEnabledProfiler(() => {
      for (const face of ["top", "bottom", "left", "right", "front", "back"] as const) extractBorderSlab(chunk, face);
      extractBorderSlab(chunk, "front");
      const slabBytes = CHUNK_WIDTH * CHUNK_LENGTH;
      expect(counterTotal("game.border.slabsExtracted")).toBe(7);
      expect(counterTotal("game.border.slabsBySlice")).toBe(2);
      expect(counterTotal("game.border.slabsByRows")).toBe(2);
      expect(counterTotal("game.border.slabsByStridedCopy")).toBe(3);
      expect(counterTotal("game.border.stridedBytesCopied")).toBe(3 * slabBytes);
      expect(byteTotal("bytes.border.front")).toBe(2 * slabBytes);
      expect(breakdownUnits(DIMENSIONS.borderFace, "front")).toBe(2 * slabBytes);
      expect(breakdownUnits(DIMENSIONS.borderFace, "left")).toBe(slabBytes);
    });
  });
});
