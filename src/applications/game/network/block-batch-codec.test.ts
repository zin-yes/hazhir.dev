import { describe, expect, test } from "bun:test";
import { sphereEdits } from "../edits/block-edit-batch";
import { profiler } from "../profiler";
import { decodeBlockRuns, encodeBlockRuns } from "./block-batch-codec";

function editKeys(xs: ArrayLike<number>, ys: ArrayLike<number>, zs: ArrayLike<number>, blocks: ArrayLike<number>, count: number) {
  const keys: string[] = [];
  for (let position = 0; position < count; position++) keys.push(`${xs[position]},${ys[position]},${zs[position]}:${blocks[position]}`);
  return keys;
}

describe("block batch codec", () => {
  test("a radius 64 sphere round trips exactly and packs into runs well under 300 KB", () => {
    const startedAt = performance.now();
    const sphere = sphereEdits({ x: -1000, y: 120, z: 37 }, 64, 11, "fill");
    const encoded = encodeBlockRuns(sphere.length, sphere.xs, sphere.ys, sphere.zs, sphere.blocks, 1);
    const decoded = decodeBlockRuns(encoded);
    expect(sphere.length).toBeGreaterThan(1_000_000);
    expect(encoded.byteLength).toBeLessThan(300_000);
    expect(decoded.length).toBe(sphere.length);
    expect(editKeys(decoded.xs, decoded.ys, decoded.zs, decoded.blocks, decoded.length)).toEqual(
      editKeys(sphere.xs, sphere.ys, sphere.zs, sphere.blocks, sphere.length),
    );
    console.log(`sphere codec: ${encoded.byteLength} bytes, ${(performance.now() - startedAt).toFixed(0)} ms`);
  });

  test("scattered changes with mixed blocks and negative coordinates keep every block and its order", () => {
    const xs = [5, 5, 5, -33, -33, 7, 7, 7];
    const ys = [10, 11, 12, -1, 0, 64, 65, 67];
    const zs = [3, 3, 3, -2, -2, 9, 9, 9];
    const blocks = [1, 1, 2, 16, 16, 54, 54, 54];
    const decoded = decodeBlockRuns(encodeBlockRuns(xs.length, xs, ys, zs, blocks, 1));
    expect(editKeys(decoded.xs, decoded.ys, decoded.zs, decoded.blocks, decoded.length)).toEqual(
      editKeys(xs, ys, zs, blocks, xs.length),
    );
  });

  test("runs longer than the 16 bit length limit split instead of wrapping", () => {
    const count = 70_000;
    const xs = new Int32Array(count).fill(3);
    const ys = new Int32Array(count).fill(-4);
    const zs = Int32Array.from({ length: count }, (_, index) => index - 500);
    const blocks = new Uint8Array(count).fill(12);
    const decoded = decodeBlockRuns(encodeBlockRuns(count, xs, ys, zs, blocks, 2));
    expect(decoded.length).toBe(count);
    expect(decoded.zs[count - 1]).toBe(count - 501);
    expect(decoded.zs[65_535]).toBe(65_035);
  });

  test("profiling records the real edit, run and byte counts of both directions", () => {
    profiler.reset("codec-test");
    profiler.setEnabled(true);
    try {
      const xs = [5, 5, 5, -33, -33, 7, 7, 7];
      const ys = [10, 11, 12, -1, 0, 64, 65, 67];
      const zs = [3, 3, 3, -2, -2, 9, 9, 9];
      const blocks = [1, 1, 2, 16, 16, 54, 54, 54];
      const encoded = encodeBlockRuns(xs.length, xs, ys, zs, blocks, 1);
      decodeBlockRuns(encoded);

      const snapshot = profiler.snapshot();
      const counterTotal = (name: string) => snapshot.counters.find((counter) => counter.name === name)?.total;
      expect(counterTotal("game.network.blockBatch.encodedEdits")).toBe(8);
      expect(counterTotal("game.network.blockBatch.encodedRuns")).toBe(5);
      expect(counterTotal("game.network.blockBatch.decodedEdits")).toBe(8);
      expect(counterTotal("game.network.blockBatch.decodedRuns")).toBe(5);
      const encodedBytes = snapshot.bytes.find((meter) => meter.name === "bytes.network.blockBatch.encoded");
      expect(encodedBytes?.total).toBe(encoded.byteLength);
      const editsPerRun = snapshot.gauges.find((gauge) => gauge.name === "game.network.blockBatch.encodedEditsPerRun");
      expect(editsPerRun?.last).toBeCloseTo(8 / 5, 5);
    } finally {
      profiler.setEnabled(false);
    }
  });
});
