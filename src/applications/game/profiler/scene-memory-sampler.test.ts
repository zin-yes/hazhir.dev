import { describe, expect, test } from "bun:test";
import { computeSceneMemoryGauges } from "./scene-memory-sampler";

describe("computeSceneMemoryGauges", () => {
  test("sums chunk, light and per-attribute geometry bytes across populated chunks", () => {
    const gauges = computeSceneMemoryGauges({
      chunkByteLengths: [32768, 32768, 32768],
      lightByteLengths: [32768, 32768],
      meshAttributeByteLengths: [
        [1200, 1200, 800, 400, 400, 400, 600],
        [24, 24, 16, 8, 8, 8, 12],
      ],
      modifiedBlockCounts: [3, 0, 5],
      textureArrayBytes: 16 * 16 * 4 * 90,
    });

    expect(gauges["memory.chunkDataBytes"].value).toBe(3 * 32768);
    expect(gauges["memory.lightDataBytes"].value).toBe(2 * 32768);
    expect(gauges["memory.geometryBytes"].value).toBe(5000 + 100);
    expect(gauges["memory.chunkCount"].value).toBe(3);
    expect(gauges["memory.meshObjects"].value).toBe(2);
    expect(gauges["memory.modifiedBlocks"].value).toBe(8);
    expect(gauges["memory.textureArrayBytes"].value).toBe(92160);
  });
});
