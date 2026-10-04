// NoiseChunk against the real 1.20.6 classes (density/fixtures/DensityReference.java, Terralith, seed 1337): the
// cache_all_in_cell final density of whole chunks, evaluated in doFill order, must be bit-identical (SHA-256 of all
// 98304 doubles), and fillChunkColumn must turn it into blocks with the disabled-aquifer fluid rule.

import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { loadOverworldRouter, readReferenceVectors, TERRALITH_DATA_AVAILABLE } from "../density/terralith-test-data.node";
import { BLOCK_AIR, BLOCK_DEFAULT_BLOCK, BLOCK_DEFAULT_FLUID, BLOCK_LAVA, fillChunkColumn } from "./fill-chunk-column";
import { NoiseChunk } from "./noise-chunk";

interface ChunkReference {
  chunkX: number;
  chunkZ: number;
  finalDensitySha256: string;
  finalDensityEvery97th: number[];
}

const MIN_Y = -64;
const HEIGHT = 384;
const SEA_LEVEL = 63;
const suiteStart = performance.now();
const { chunks } = readReferenceVectors<{ chunks: ChunkReference[] }>(new URL("./fixtures/noise-chunk-reference-vectors.json.gz", import.meta.url));

/** Replays NoiseBasedChunkGenerator.doFill's loop order and records the cached final density of every block. */
function chunkFinalDensities(chunkX: number, chunkZ: number): Float64Array {
  const noiseChunk = new NoiseChunk(loadOverworldRouter(), {
    cellCountXZ: 4,
    firstBlockX: chunkX * 16,
    firstBlockZ: chunkZ * 16,
    minY: MIN_Y,
    height: HEIGHT,
  });
  const density = noiseChunk.finalDensityForFill;
  const densities = new Float64Array(HEIGHT * 256);
  noiseChunk.initializeForFirstCellX();
  for (let cellX = 0; cellX < 4; cellX++) {
    noiseChunk.advanceCellX(cellX);
    for (let cellZ = 0; cellZ < 4; cellZ++) {
      for (let cellY = HEIGHT / 4 - 1; cellY >= 0; cellY--) {
        noiseChunk.selectCellYZ(cellY, cellZ);
        for (let yInCell = 3; yInCell >= 0; yInCell--) {
          const blockY = (MIN_Y / 4 + cellY) * 4 + yInCell;
          noiseChunk.updateForY(blockY, yInCell / 4);
          for (let xInCell = 0; xInCell < 4; xInCell++) {
            const localX = cellX * 4 + xInCell;
            noiseChunk.updateForX(chunkX * 16 + localX, xInCell / 4);
            for (let zInCell = 0; zInCell < 4; zInCell++) {
              const localZ = cellZ * 4 + zInCell;
              noiseChunk.updateForZ(chunkZ * 16 + localZ, zInCell / 4);
              densities[(blockY - MIN_Y) * 256 + localZ * 16 + localX] = density.compute(noiseChunk);
            }
          }
        }
      }
    }
    noiseChunk.swapSlices();
  }
  noiseChunk.stopInterpolation();
  return densities;
}

function sha256OfLittleEndianDoubles(values: Float64Array): string {
  return createHash("sha256").update(new Uint8Array(values.buffer, values.byteOffset, values.byteLength)).digest("hex");
}

(TERRALITH_DATA_AVAILABLE ? describe : describe.skip)("NoiseChunk final density", () => {
  for (const reference of chunks) {
    test(`chunk ${reference.chunkX},${reference.chunkZ} is bit-identical to Java`, () => {
      const densities = chunkFinalDensities(reference.chunkX, reference.chunkZ);
      const sampled = reference.finalDensityEvery97th.map((_, sampleIndex) => densities[sampleIndex * 97]);
      expect(sampled).toEqual(reference.finalDensityEvery97th);
      expect(sha256OfLittleEndianDoubles(densities)).toBe(reference.finalDensitySha256);
    }, 30_000);
  }

  test("fillChunkColumn turns the density into stone, sea water below 63, lava below -54, and air", () => {
    const reference = chunks[0];
    const densities = chunkFinalDensities(reference.chunkX, reference.chunkZ);
    const blocks = fillChunkColumn({ router: loadOverworldRouter(), chunkX: reference.chunkX, chunkZ: reference.chunkZ, minY: MIN_Y, height: HEIGHT, seaLevel: SEA_LEVEL });
    const counts = new Map<number, number>();
    for (let index = 0; index < blocks.length; index++) {
      const blockY = Math.floor(index / 256) + MIN_Y;
      const expected =
        densities[index] > 0 ? BLOCK_DEFAULT_BLOCK : blockY < -54 ? BLOCK_LAVA : blockY < SEA_LEVEL ? BLOCK_DEFAULT_FLUID : BLOCK_AIR;
      if (blocks[index] !== expected) throw new Error(`block ${index} is ${blocks[index]}, expected ${expected}`);
      counts.set(blocks[index], (counts.get(blocks[index]) ?? 0) + 1);
    }
    expect(counts.get(BLOCK_DEFAULT_BLOCK) ?? 0).toBeGreaterThan(256 * 64);
    expect(counts.get(BLOCK_AIR) ?? 0).toBeGreaterThan(256 * 100);
  }, 30_000);
});

afterAll(() => {
  console.log(`noise-chunk.test.ts: ${(performance.now() - suiteStart).toFixed(0)} ms`);
});
