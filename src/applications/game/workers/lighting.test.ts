import { describe, expect, test } from "bun:test";
import { BlockType } from "@/applications/game/blocks";
import {
  CHUNK_HEIGHT,
  CHUNK_LENGTH,
  CHUNK_WIDTH,
} from "@/applications/game/config";
import { calculateOffset } from "../utils";
import { initializeChunkLight, propagateChunkLight } from "./lighting";

const BLOCKS = CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH;
const SKY_ABOVE = new Uint8Array(BLOCKS).fill(0xf0);
const AIR_ABOVE = new Uint8Array(BLOCKS);

function chunkWith(blocks: Array<[number, number, number, BlockType]>) {
  const chunk = new Uint8Array(BLOCKS);
  for (const [x, y, z, block] of blocks)
    chunk[calculateOffset(x, y, z)] = block;
  return chunk;
}

function lightChunk(chunk: Uint8Array) {
  const { light, queue, isFullySunlit } = initializeChunkLight(
    chunk,
    0,
    0,
    10,
    0,
    AIR_ABOVE,
    SKY_ABOVE,
  );
  const result = propagateChunkLight(chunk, light, {}, {}, queue);
  return { light: result.centerLight, queue, isFullySunlit };
}

const skyAt = (light: Uint8Array, x: number, y: number, z: number) =>
  light[calculateOffset(x, y, z)] >> 4;
const blockLightAt = (light: Uint8Array, x: number, y: number, z: number) =>
  light[calculateOffset(x, y, z)] & 0xf;

// A roof over a side corridor: sky light enters at the open end and fades along it.
function roofedCorridor() {
  const blocks: Array<[number, number, number, BlockType]> = [];
  for (let x = 0; x < CHUNK_WIDTH; x++)
    for (let z = 0; z < CHUNK_LENGTH; z++)
      blocks.push([x, 0, z, BlockType.STONE]);
  for (let x = 10; x < CHUNK_WIDTH; x++)
    for (let z = 0; z < CHUNK_LENGTH; z++)
      blocks.push([x, 6, z, BlockType.STONE]);
  return chunkWith(blocks);
}

describe("initializeChunkLight", () => {
  test("open sky is full light and needs no spreading", () => {
    const chunk = chunkWith([[3, 0, 3, BlockType.STONE]]);
    const { light, isFullySunlit } = initializeChunkLight(
      chunk,
      0,
      0,
      10,
      0,
      AIR_ABOVE,
      SKY_ABOVE,
    );
    expect(skyAt(light, 5, 20, 5)).toBe(15);
    expect(isFullySunlit).toBe(true);
  });

  test("a roof, a light source or a missing sun all mean light still has to spread", () => {
    expect(
      initializeChunkLight(roofedCorridor(), 0, 0, 10, 0, AIR_ABOVE, SKY_ABOVE)
        .isFullySunlit,
    ).toBe(false);
    const withGlowstone = chunkWith([[4, 4, 4, BlockType.GLOWSTONE]]);
    expect(
      initializeChunkLight(withGlowstone, 0, 0, 10, 0, AIR_ABOVE, SKY_ABOVE)
        .isFullySunlit,
    ).toBe(false);
    expect(
      initializeChunkLight(
        chunkWith([]),
        0,
        0,
        10,
        0,
        AIR_ABOVE,
        new Uint8Array(BLOCKS),
      ).isFullySunlit,
    ).toBe(false);
  });

  test("queues the edge of the lit region but not the open sky deep inside it", () => {
    const { queue } = initializeChunkLight(
      roofedCorridor(),
      0,
      0,
      10,
      0,
      AIR_ABOVE,
      SKY_ABOVE,
    );
    const queued = new Set(queue);
    expect(queued.has(calculateOffset(9, 3, 16))).toBe(true);
    expect(queued.has(calculateOffset(5, 20, 16))).toBe(false);
  });
});

describe("initializeChunkLight frontier", () => {
  const SHADED_NEIGHBOR_DIRECTIONS: [string, number, number][] = [
    ["positive x", 1, 0],
    ["negative x", -1, 0],
    ["positive z", 0, 1],
    ["negative z", 0, -1],
  ];

  for (const [direction, stepX, stepZ] of SHADED_NEIGHBOR_DIRECTIONS) {
    test(`a sky-lit cell beside a shaded open cell in the ${direction} direction is queued`, () => {
      const litX = 16;
      const litZ = 16;
      const chunk = chunkWith([
        [litX + stepX, CHUNK_HEIGHT - 1, litZ + stepZ, BlockType.STONE],
      ]);
      const { queue } = initializeChunkLight(
        chunk,
        0,
        0,
        10,
        0,
        AIR_ABOVE,
        SKY_ABOVE,
      );
      const queued = new Set(queue);
      expect(queued.has(calculateOffset(litX, 12, litZ))).toBe(true);
      expect(queued.has(calculateOffset(litX - stepX * 4, 12, litZ - stepZ * 4))).toBe(false);
    });
  }
});

describe("propagateChunkLight", () => {
  test("light slides under a roof one level dimmer per block", () => {
    const { light } = lightChunk(roofedCorridor());
    expect(skyAt(light, 9, 3, 16)).toBe(15);
    expect(skyAt(light, 10, 3, 16)).toBe(14);
    expect(skyAt(light, 13, 3, 16)).toBe(11);
    expect(skyAt(light, 25, 3, 16)).toBe(0);
  });

  test("a light source glows through open cells and stops at walls", () => {
    const chunk = chunkWith([
      [8, 4, 8, BlockType.GLOWSTONE],
      [10, 4, 8, BlockType.STONE],
    ]);
    const { light } = lightChunk(chunk);
    expect(blockLightAt(light, 8, 4, 8)).toBe(15);
    expect(blockLightAt(light, 9, 4, 8)).toBe(14);
    expect(blockLightAt(light, 10, 4, 8)).toBe(0);
    expect(blockLightAt(light, 8, 4, 10)).toBe(13);
  });

  test("light crosses into a loaded neighbor and the neighbor's own copy is left alone", () => {
    const chunk = chunkWith([[CHUNK_WIDTH - 1, 4, 8, BlockType.GLOWSTONE]]);
    const { light, queue } = initializeChunkLight(
      chunk,
      0,
      0,
      10,
      0,
      AIR_ABOVE,
      SKY_ABOVE,
    );
    const neighborLight = new Uint8Array(BLOCKS);
    const result = propagateChunkLight(
      chunk,
      light,
      { "1,0,0": new Uint8Array(BLOCKS) },
      { "1,0,0": neighborLight },
      queue,
    );
    expect(blockLightAt(result.neighborLightUpdates["1,0,0"], 0, 4, 8)).toBe(
      14,
    );
    expect(blockLightAt(result.neighborLightUpdates["1,0,0"], 3, 4, 8)).toBe(
      11,
    );
    expect(blockLightAt(neighborLight, 0, 4, 8)).toBe(0);
  });

  test("light is pulled in from a bright neighbor", () => {
    const chunk = chunkWith([]);
    const { light, queue } = initializeChunkLight(
      chunk,
      0,
      0,
      10,
      0,
      AIR_ABOVE,
      new Uint8Array(BLOCKS),
    );
    const neighborLight = new Uint8Array(BLOCKS);
    neighborLight[calculateOffset(CHUNK_WIDTH - 1, 5, 5)] = 0x0f;
    const result = propagateChunkLight(
      chunk,
      light,
      { "-1,0,0": new Uint8Array(BLOCKS) },
      { "-1,0,0": neighborLight },
      queue,
    );
    expect(blockLightAt(result.centerLight, 0, 5, 5)).toBe(14);
    expect(blockLightAt(result.centerLight, 2, 5, 5)).toBe(12);
  });

  test("a neighbor that has blocks but no light yet receives nothing and does not stall", () => {
    const chunk = chunkWith([[CHUNK_WIDTH - 1, 4, 8, BlockType.GLOWSTONE]]);
    const { light, queue } = initializeChunkLight(
      chunk,
      0,
      0,
      10,
      0,
      AIR_ABOVE,
      SKY_ABOVE,
    );
    const result = propagateChunkLight(
      chunk,
      light,
      { "1,0,0": new Uint8Array(BLOCKS) },
      {},
      queue,
    );
    expect(result.neighborLightUpdates).toEqual({});
    expect(blockLightAt(result.centerLight, CHUNK_WIDTH - 2, 4, 8)).toBe(14);
  });

  test("full sky light from the chunk above enters undimmed and falls through the whole chunk", () => {
    const chunk = chunkWith([]);
    const { light, queue } = initializeChunkLight(
      chunk,
      0,
      0,
      10,
      0,
      AIR_ABOVE,
      new Uint8Array(BLOCKS),
    );
    expect(skyAt(light, 5, 20, 5)).toBe(0);
    const result = propagateChunkLight(
      chunk,
      light,
      { "0,1,0": new Uint8Array(BLOCKS) },
      { "0,1,0": new Uint8Array(BLOCKS).fill(0xf0) },
      queue,
    );
    expect(skyAt(result.centerLight, 5, CHUNK_HEIGHT - 1, 5)).toBe(15);
    expect(skyAt(result.centerLight, 5, 0, 5)).toBe(15);
  });

  test("light reaching a neighbor through several cells is not truncated at the chunk border", () => {
    const chunk = chunkWith([[CHUNK_WIDTH - 1, 4, 8, BlockType.GLOWSTONE]]);
    const { light, queue } = initializeChunkLight(
      chunk,
      0,
      0,
      10,
      0,
      AIR_ABOVE,
      SKY_ABOVE,
    );
    const result = propagateChunkLight(
      chunk,
      light,
      { "1,0,0": new Uint8Array(BLOCKS) },
      { "1,0,0": new Uint8Array(BLOCKS) },
      queue,
    );
    const neighborLight = result.neighborLightUpdates["1,0,0"];
    expect(blockLightAt(neighborLight, 14, 4, 8)).toBe(0);
    expect(blockLightAt(neighborLight, 13, 4, 8)).toBe(1);
    expect(blockLightAt(neighborLight, 0, 12, 8)).toBe(6);
  });
});

describe("initializeChunkLight when nothing is known above the chunk", () => {
  const SEA_LEVEL_CHUNK_Y = 3;
  const BELOW_SEA_LEVEL_CHUNK_Y = 1;

  test("open air at or above sea level is lit from the sky", () => {
    const chunk = chunkWith([[3, 0, 3, BlockType.STONE]]);
    const { light } = initializeChunkLight(chunk, 0, 0, SEA_LEVEL_CHUNK_Y, 0);
    expect(skyAt(light, 5, 20, 5)).toBe(15);
    expect(skyAt(light, 3, 1, 3)).toBe(15);
    expect(skyAt(light, 3, 0, 3)).toBe(0);
  });

  test("a column of ground is lit only above its first solid block", () => {
    const chunk = chunkWith([[7, 12, 9, BlockType.STONE]]);
    const { light } = initializeChunkLight(chunk, 0, 0, SEA_LEVEL_CHUNK_Y, 0);
    expect(skyAt(light, 7, 13, 9)).toBe(15);
    expect(skyAt(light, 7, 12, 9)).toBe(0);
    expect(skyAt(light, 7, 11, 9)).toBe(0);
  });

  test("below sea level a cave open in the top layer stays dark but an ocean column is lit", () => {
    const chunk = chunkWith([]);
    for (let y = 0; y < CHUNK_HEIGHT; y++)
      chunk[calculateOffset(4, y, 4)] = BlockType.WATER;
    for (let x = 8; x < CHUNK_WIDTH; x++)
      for (let z = 0; z < CHUNK_LENGTH; z++)
        for (let y = 0; y < CHUNK_HEIGHT; y++)
          chunk[calculateOffset(x, y, z)] = BlockType.STONE;
    const { light } = initializeChunkLight(
      chunk,
      0,
      0,
      BELOW_SEA_LEVEL_CHUNK_Y,
      0,
    );
    expect(skyAt(light, 4, 20, 4)).toBe(15);
    expect(skyAt(light, 4, 0, 4)).toBe(15);
    expect(skyAt(light, 1, 20, 1)).toBe(0);
  });

  test("information from above wins over the sea level rule", () => {
    const chunk = chunkWith([]);
    const { light } = initializeChunkLight(
      chunk,
      0,
      0,
      BELOW_SEA_LEVEL_CHUNK_Y,
      0,
      AIR_ABOVE,
      SKY_ABOVE,
    );
    expect(skyAt(light, 1, 20, 1)).toBe(15);
  });
});

describe("initializeChunkLight on uniform chunks", () => {
  test("solid rock has no light and nothing to spread", () => {
    const { light, queue, isFullySunlit } = initializeChunkLight(
      new Uint8Array(BLOCKS).fill(BlockType.STONE),
      0,
      0,
      10,
      0,
      AIR_ABOVE,
      SKY_ABOVE,
    );
    expect(light.every((value) => value === 0)).toBe(true);
    expect(queue.length).toBe(0);
    expect(isFullySunlit).toBe(true);
  });

  test("open air under open sky is full sky light and queues exactly the edge shell", () => {
    const { light, queue, isFullySunlit } = initializeChunkLight(
      new Uint8Array(BLOCKS),
      0,
      0,
      10,
      0,
      AIR_ABOVE,
      SKY_ABOVE,
    );
    expect(light.every((value) => value === 0xf0)).toBe(true);
    expect(isFullySunlit).toBe(true);
    const interior = (CHUNK_WIDTH - 2) * (CHUNK_LENGTH - 2) * (CHUNK_HEIGHT - 1);
    expect(queue.length).toBe(BLOCKS - interior);
    expect(new Set(queue).size).toBe(queue.length);
  });

  test("a chunk of glowing blocks still glows and queues every source", () => {
    const { light, queue, isFullySunlit } = initializeChunkLight(
      new Uint8Array(BLOCKS).fill(BlockType.GLOWSTONE),
      0,
      0,
      10,
      0,
      AIR_ABOVE,
      SKY_ABOVE,
    );
    expect(light.every((value) => value === 0x0f)).toBe(true);
    expect(queue.length).toBe(BLOCKS);
    expect(isFullySunlit).toBe(false);
  });

  test("open sky over a chunk whose columns are walled off only lights the open columns", () => {
    const blocks = new Uint8Array(BLOCKS);
    const skyAbove = new Uint8Array(BLOCKS).fill(0xf0);
    for (let y = 0; y < CHUNK_HEIGHT; y++)
      skyAbove[calculateOffset(2, y, 2)] = 0;
    const { light, isFullySunlit } = initializeChunkLight(
      blocks,
      0,
      0,
      10,
      0,
      AIR_ABOVE,
      skyAbove,
    );
    expect(skyAt(light, 2, 10, 2)).toBe(0);
    expect(skyAt(light, 3, 10, 2)).toBe(15);
    expect(isFullySunlit).toBe(false);
  });
});
