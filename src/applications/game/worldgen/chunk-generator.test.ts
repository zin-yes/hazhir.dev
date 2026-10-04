import { afterAll, describe, expect, test } from "bun:test";
import { BlockType } from "@/applications/game/blocks";
import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "@/applications/game/config";
import { generateChunkBlocks } from "./chunk-generator";
import { GAME_Y_OFFSET, SEA_LEVEL } from "./constants";
import { findSpawnPoint } from "./spawn-point";
import { createSurfaceHeightSampler } from "./surface-height";

const SEED = 2024;
const OTHER_SEED = 777;
const MINECRAFT_MIN_Y = -64;
const X_STRIDE = CHUNK_HEIGHT * CHUNK_LENGTH;
const Y_STRIDE = CHUNK_LENGTH;
const KNOWN_BLOCK_IDS = new Set(Object.values(BlockType).filter((value) => typeof value === "number"));
const testStartedAtMs = performance.now();

function blockAt(seed: number, gameX: number, gameY: number, gameZ: number): number {
  const chunkX = Math.floor(gameX / CHUNK_WIDTH);
  const chunkY = Math.floor(gameY / CHUNK_HEIGHT);
  const chunkZ = Math.floor(gameZ / CHUNK_LENGTH);
  const blocks = generateChunkBlocks(seed, chunkX, chunkY, chunkZ);
  return blocks[(gameX - chunkX * CHUNK_WIDTH) * X_STRIDE + (gameY - chunkY * CHUNK_HEIGHT) * Y_STRIDE + (gameZ - chunkZ * CHUNK_LENGTH)]!;
}

function isSolidGround(block: number): boolean {
  return block !== BlockType.AIR && block !== BlockType.WATER;
}

describe("engine-backed chunk generation", () => {
  const spawn = findSpawnPoint(SEED);
  const spawnChunkX = Math.floor(spawn.x / CHUNK_WIDTH);
  const spawnChunkZ = Math.floor(spawn.z / CHUNK_LENGTH);

  test("generating twice gives identical blocks, regardless of cache state", () => {
    const first = generateChunkBlocks(SEED, spawnChunkX, 1, spawnChunkZ);
    generateChunkBlocks(OTHER_SEED, spawnChunkX + 3, 1, spawnChunkZ - 2);
    generateChunkBlocks(SEED, spawnChunkX + 40, 1, spawnChunkZ + 40);
    expect(generateChunkBlocks(SEED, spawnChunkX, 1, spawnChunkZ)).toEqual(first);
  });

  test("returns an independent buffer per call, since callers transfer it away", () => {
    const first = generateChunkBlocks(SEED, spawnChunkX, 1, spawnChunkZ);
    const solidBefore = first.filter((block) => block !== BlockType.AIR).length;
    expect(solidBlocksIn(first)).toBeGreaterThan(0);
    first.fill(BlockType.AIR);
    expect(solidBlocksIn(generateChunkBlocks(SEED, spawnChunkX, 1, spawnChunkZ))).toBe(solidBefore);
  });

  test("a column spans bedrock, ground with water or air above, and empty sky, using real block ids", () => {
    const bedrockChunkY = Math.floor((MINECRAFT_MIN_Y + GAME_Y_OFFSET) / CHUNK_HEIGHT);
    const bedrockChunk = generateChunkBlocks(SEED, spawnChunkX, bedrockChunkY, spawnChunkZ);
    const lowestLocalY = MINECRAFT_MIN_Y + GAME_Y_OFFSET - bedrockChunkY * CHUNK_HEIGHT;
    const kindsInColumn = new Set<number>();
    for (let localX = 0; localX < CHUNK_WIDTH; localX++) {
      for (let localZ = 0; localZ < CHUNK_LENGTH; localZ++) {
        for (let localY = 0; localY < lowestLocalY; localY++) {
          expect(bedrockChunk[localX * X_STRIDE + localY * Y_STRIDE + localZ]).toBe(BlockType.AIR);
        }
        kindsInColumn.add(bedrockChunk[localX * X_STRIDE + lowestLocalY * Y_STRIDE + localZ]!);
      }
    }
    expect(kindsInColumn.has(BlockType.BEDROCK)).toBe(true);

    for (let chunkY = bedrockChunkY; chunkY <= 4; chunkY++) {
      for (const block of generateChunkBlocks(SEED, spawnChunkX, chunkY, spawnChunkZ)) {
        expect(KNOWN_BLOCK_IDS.has(block)).toBe(true);
        kindsInColumn.add(block);
      }
    }
    expect(kindsInColumn.size).toBeGreaterThanOrEqual(3);
    expect(solidBlocksIn(generateChunkBlocks(SEED, spawnChunkX, 6, spawnChunkZ))).toBe(0);
    expect(solidBlocksIn(generateChunkBlocks(SEED, spawnChunkX, bedrockChunkY - 1, spawnChunkZ))).toBe(0);
  });

  test("a neighbouring game column is generated from the other Minecraft columns, not mirrored", () => {
    const here = generateChunkBlocks(SEED, spawnChunkX, 1, spawnChunkZ);
    const east = generateChunkBlocks(SEED, spawnChunkX + 1, 1, spawnChunkZ);
    expect(east).not.toEqual(here);
  });

  test("the surface sampler agrees with the generated blocks and sea level maps to the game's", () => {
    const sampleHeight = createSurfaceHeightSampler(SEED);
    let landColumns = 0;
    for (let offsetX = 0; offsetX < CHUNK_WIDTH; offsetX += 5) {
      for (let offsetZ = 0; offsetZ < CHUNK_LENGTH; offsetZ += 5) {
        const gameX = spawnChunkX * CHUNK_WIDTH + offsetX;
        const gameZ = spawnChunkZ * CHUNK_LENGTH + offsetZ;
        const groundY = sampleHeight(gameX, gameZ);
        expect(isSolidGround(blockAt(SEED, gameX, groundY, gameZ))).toBe(true);
        for (let aboveY = groundY + 1; aboveY <= groundY + 3; aboveY++) {
          expect(isSolidGround(blockAt(SEED, gameX, aboveY, gameZ))).toBe(false);
        }
        if (groundY > SEA_LEVEL) landColumns++;
      }
    }
    expect(landColumns).toBeGreaterThan(0);
  });

  test("spawn is on dry land with open air above and deterministic", () => {
    expect(findSpawnPoint(SEED)).toEqual(spawn);
    const feetBlock = blockAt(SEED, Math.floor(spawn.x), spawn.y, Math.floor(spawn.z));
    const headBlock = blockAt(SEED, Math.floor(spawn.x), spawn.y + 1, Math.floor(spawn.z));
    const groundBlock = blockAt(SEED, Math.floor(spawn.x), spawn.y - 2, Math.floor(spawn.z));
    expect(isSolidGround(groundBlock)).toBe(true);
    expect(feetBlock).toBe(BlockType.AIR);
    expect(headBlock).toBe(BlockType.AIR);
    expect(spawn.y).toBeGreaterThan(SEA_LEVEL);
  });
});

function solidBlocksIn(blocks: Uint8Array): number {
  let solid = 0;
  for (const block of blocks) if (block !== BlockType.AIR) solid++;
  return solid;
}

afterAll(() => {
  console.log(`chunk-generator.test.ts took ${(performance.now() - testStartedAtMs).toFixed(0)} ms`);
});
