import { describe, expect, test } from "bun:test";
import { BlockType } from "../blocks";
import { CELLS_PER_CHUNK } from "../edits/chunk-cluster";
import { calculateOffset } from "../utils";
import { initializeChunkLight } from "./lighting";
import {
  createSurroundingsSource,
  lightChunkRegion,
  listRegionTransferables,
} from "./region-lighting";

const SEA_LEVEL_CHUNK_Y = 3;

function chunkWith(blocks: Array<[number, number, number, BlockType]>) {
  const chunk = new Uint8Array(CELLS_PER_CHUNK);
  for (const [x, y, z, block] of blocks) chunk[calculateOffset(x, y, z)] = block;
  return chunk;
}

const blockLightAt = (light: Uint8Array, x: number, y: number, z: number) =>
  light[calculateOffset(x, y, z)] & 0xf;
const skyAt = (light: Uint8Array, x: number, y: number, z: number) =>
  light[calculateOffset(x, y, z)] >> 4;

describe("lightChunkRegion", () => {
  test("lights each chunk of a column from the one above and spreads across the chunk border", () => {
    const lowerChunk = chunkWith([[31, 5, 8, BlockType.GLOWSTONE]]);
    for (let x = 0; x < 32; x++)
      for (let z = 0; z < 32; z++) lowerChunk[calculateOffset(x, 0, z)] = BlockType.STONE;
    const upperChunk = chunkWith([]);
    const eastChunk = chunkWith([]);
    const blocksBefore = [lowerChunk, upperChunk, eastChunk].map((blocks) => blocks.slice());

    const { chunkLights, surroundingUpdates } = lightChunkRegion([
      { chunkX: 0, chunkY: SEA_LEVEL_CHUNK_Y, chunkZ: 0, blocks: lowerChunk },
      { chunkX: 0, chunkY: SEA_LEVEL_CHUNK_Y + 1, chunkZ: 0, blocks: upperChunk },
      { chunkX: 1, chunkY: SEA_LEVEL_CHUNK_Y, chunkZ: 0, blocks: eastChunk },
    ]);

    expect(chunkLights.map((entry) => [entry.chunkX, entry.chunkY, entry.chunkZ])).toEqual([
      [0, SEA_LEVEL_CHUNK_Y, 0],
      [0, SEA_LEVEL_CHUNK_Y + 1, 0],
      [1, SEA_LEVEL_CHUNK_Y, 0],
    ]);
    expect(surroundingUpdates).toEqual([]);
    const [lowerLight, upperLight, eastLight] = chunkLights.map((entry) => entry.light);
    expect(skyAt(upperLight, 5, 20, 5)).toBe(15);
    expect(skyAt(lowerLight, 5, 20, 5)).toBe(15);
    expect(blockLightAt(lowerLight, 31, 5, 8)).toBe(15);
    expect(blockLightAt(eastLight, 0, 5, 8)).toBe(14);
    expect(blockLightAt(eastLight, 5, 5, 8)).toBe(9);
    [lowerChunk, upperChunk, eastChunk].forEach((blocks, position) =>
      expect(blocks).toEqual(blocksBefore[position]),
    );
  });

  test("a lit chunk beside the region lights into it, and light from the region comes back as an update", () => {
    const litNeighborBlocks = chunkWith([[31, 5, 8, BlockType.GLOWSTONE]]);
    const litNeighbor = initializeChunkLight(
      litNeighborBlocks,
      0,
      -1,
      SEA_LEVEL_CHUNK_Y,
      0,
    );
    const neighborLightBefore = litNeighbor.light.slice();
    const regionBlocks = chunkWith([[0, 20, 20, BlockType.GLOWSTONE]]);
    const surroundings = createSurroundingsSource([
      {
        chunkX: -1,
        chunkY: SEA_LEVEL_CHUNK_Y,
        chunkZ: 0,
        blocks: litNeighborBlocks,
        light: litNeighbor.light,
      },
    ]);

    const { chunkLights, surroundingUpdates } = lightChunkRegion(
      [{ chunkX: 0, chunkY: SEA_LEVEL_CHUNK_Y, chunkZ: 0, blocks: regionBlocks }],
      surroundings,
    );

    expect(blockLightAt(chunkLights[0].light, 0, 5, 8)).toBe(14);
    expect(blockLightAt(chunkLights[0].light, 3, 5, 8)).toBe(11);
    expect(surroundingUpdates).toHaveLength(1);
    expect([surroundingUpdates[0].chunkX, surroundingUpdates[0].chunkY]).toEqual([-1, SEA_LEVEL_CHUNK_Y]);
    expect(blockLightAt(surroundingUpdates[0].light, 31, 20, 20)).toBe(14);
    expect(blockLightAt(surroundingUpdates[0].light, 31, 5, 8)).toBe(15);
    expect(litNeighbor.light).toEqual(neighborLightBefore);
  });

  test("hands back one distinct transferable buffer per light array", () => {
    const result = lightChunkRegion([
      { chunkX: 0, chunkY: SEA_LEVEL_CHUNK_Y, chunkZ: 0, blocks: chunkWith([]) },
      { chunkX: 1, chunkY: SEA_LEVEL_CHUNK_Y, chunkZ: 0, blocks: chunkWith([[0, 4, 4, BlockType.GLOWSTONE]]) },
    ]);
    const buffers = listRegionTransferables(result);
    expect(buffers).toHaveLength(2);
    expect(new Set(buffers).size).toBe(2);
    buffers.forEach((buffer) => expect((buffer as ArrayBuffer).byteLength).toBe(CELLS_PER_CHUNK));
  });
});
