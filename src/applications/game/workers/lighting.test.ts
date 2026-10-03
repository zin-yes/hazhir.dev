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
});
