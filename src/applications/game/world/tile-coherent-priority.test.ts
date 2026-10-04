import { describe, expect, test } from "bun:test";
import { AFFINITY_TILE_SIZE_IN_CHUNKS } from "../worker-pool";
import { tileCoherentPriority } from "./chunk-pipeline";

describe("tile coherent generation order", () => {
  test("columns of a tile run back to back as a chain of neighbors, nearer tiles first", () => {
    const startedAt = performance.now();
    const distance = (chunkX: number, chunkZ: number) => Math.hypot(chunkX - 1, chunkZ - 1);
    const columns: Array<{ chunkX: number; chunkZ: number; priority: number }> = [];
    for (let chunkX = -6; chunkX <= 8; chunkX++) {
      for (let chunkZ = -6; chunkZ <= 8; chunkZ++) columns.push({ chunkX, chunkZ, priority: tileCoherentPriority(chunkX, chunkZ, distance) });
    }
    columns.sort((first, second) => first.priority - second.priority);
    const tileOf = (column: { chunkX: number; chunkZ: number }) =>
      `${Math.floor(column.chunkX / AFFINITY_TILE_SIZE_IN_CHUNKS)},${Math.floor(column.chunkZ / AFFINITY_TILE_SIZE_IN_CHUNKS)}`;
    let tileChanges = 0;
    for (let index = 1; index < columns.length; index++) {
      const previous = columns[index - 1]!;
      const current = columns[index]!;
      if (tileOf(previous) !== tileOf(current)) {
        tileChanges++;
        continue;
      }
      expect(Math.abs(previous.chunkX - current.chunkX) + Math.abs(previous.chunkZ - current.chunkZ)).toBe(1);
    }
    const tileCount = new Set(columns.map(tileOf)).size;
    expect(tileChanges).toBe(tileCount - 1);
    expect(tileOf(columns[0]!)).toBe("0,0");
    console.log(`tile order test: ${(performance.now() - startedAt).toFixed(1)} ms`);
  });
});
