import { describe, expect, test } from "bun:test";
import { BlockType } from "@/applications/game/blocks";
import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "@/applications/game/config";
import { generateChunkBlocks } from "./chunk-generator";
import { findSpawnPoint } from "./spawn-point";
import { getTerrainModel } from "./column-grid";
import { SEA_LEVEL } from "./constants";

const SEED = 2024;
const KNOWN_BLOCK_IDS = new Set(Object.values(BlockType).filter((value) => typeof value === "number"));
const Y_STRIDE = CHUNK_LENGTH;
const X_STRIDE = CHUNK_HEIGHT * CHUNK_LENGTH;

function findChunkColumnWithRiverAndLand(): { chunkX: number; chunkZ: number } {
  const model = getTerrainModel(SEED);
  for (let chunkX = -60; chunkX < 60; chunkX++) {
    for (let chunkZ = -60; chunkZ < 60; chunkZ++) {
      const sample = model.sample(chunkX * CHUNK_WIDTH + 16, chunkZ * CHUNK_LENGTH + 16);
      if (sample.riverChannelWeight > 0.6 && sample.height < SEA_LEVEL + 20) return { chunkX, chunkZ };
    }
  }
  throw new Error("no river found near origin");
}

describe("chunk generation", () => {
  const { chunkX, chunkZ } = findChunkColumnWithRiverAndLand();
  const chunkYs = [0, 1, 2];

  test("generating twice gives identical blocks, regardless of cache state", () => {
    const first = generateChunkBlocks(SEED, chunkX, 1, chunkZ);
    generateChunkBlocks(SEED + 7, chunkX + 3, 1, chunkZ - 2);
    const second = generateChunkBlocks(SEED, chunkX, 1, chunkZ);
    expect(second).toEqual(first);
  });

  test("only emits real block ids, and a mix of solid, water and air", () => {
    const kinds = new Set<number>();
    for (const chunkY of chunkYs) {
      for (const block of generateChunkBlocks(SEED, chunkX, chunkY, chunkZ)) kinds.add(block);
    }
    for (const block of kinds) expect(KNOWN_BLOCK_IDS.has(block)).toBe(true);
    expect(kinds.has(BlockType.AIR)).toBe(true);
    expect(kinds.has(BlockType.WATER)).toBe(true);
    expect(kinds.size).toBeGreaterThan(5);
  });

  test("water never hangs above air", () => {
    for (const chunkY of chunkYs) {
      const blocks = generateChunkBlocks(SEED, chunkX, chunkY, chunkZ);
      for (let localX = 0; localX < CHUNK_WIDTH; localX++) {
        for (let localZ = 0; localZ < CHUNK_LENGTH; localZ++) {
          for (let localY = 1; localY < CHUNK_HEIGHT; localY++) {
            const index = localX * X_STRIDE + localY * Y_STRIDE + localZ;
            if (blocks[index] === BlockType.WATER) {
              expect(blocks[index - Y_STRIDE]).not.toBe(BlockType.AIR);
            }
          }
        }
      }
    }
  });
});

describe("spawn point", () => {
  test("starts the player on dry land above the sea", () => {
    const spawn = findSpawnPoint(SEED);
    const ground = getTerrainModel(SEED).sample(spawn.x, spawn.z);
    expect(ground.height).toBeGreaterThan(SEA_LEVEL + 3);
    expect(ground.waterLevel).toBeLessThanOrEqual(ground.height);
    expect(spawn.y).toBeGreaterThan(ground.height);
  });
});
