import { beforeAll, describe, expect, test } from "bun:test";
import {
  CHUNK_CELL_COUNT,
  COMPRESSED_HEADER_BYTES,
  byteSize,
  compress,
  decompressInto,
  isUniform,
  readCell,
  uniformValue,
  type CompressedChunk,
} from "./chunk-compression";
import { loadRealisticChunks, type RealisticChunk } from "./realistic-chunk-fixture";

const REALISTIC_COLUMNS_PER_SIDE = 3;
const CORNER_COORDINATES = [0, 31];
const FIXTURE_GENERATION_TIMEOUT_MS = 120_000;

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function cellIndexOf(x: number, y: number, z: number): number {
  return x * 1024 + y * 32 + z;
}

function expectIdenticalCells(actual: Uint8Array, expected: Uint8Array): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < expected.length; index++) {
    if (actual[index] !== expected[index]) {
      throw new Error(`cell ${index} differs: ${actual[index]} vs ${expected[index]}`);
    }
  }
}

function expectLosslessAndRandomAccess(cells: Uint8Array, random: () => number): CompressedChunk {
  const snapshot = cells.slice();
  const compressed = compress(cells);
  const target = new Uint8Array(CHUNK_CELL_COUNT);
  decompressInto(compressed, target);
  expectIdenticalCells(target, snapshot);
  for (let sample = 0; sample < 300; sample++) {
    const index = Math.floor(random() * CHUNK_CELL_COUNT);
    expect(readCell(compressed, index)).toBe(snapshot[index]!);
  }
  expect(readCell(compressed, 0)).toBe(snapshot[0]!);
  expect(readCell(compressed, CHUNK_CELL_COUNT - 1)).toBe(snapshot[CHUNK_CELL_COUNT - 1]!);
  expect(byteSize(compressed)).toBeLessThanOrEqual(CHUNK_CELL_COUNT + COMPRESSED_HEADER_BYTES);
  return compressed;
}

function fillWithDistinctValueCount(distinctValueCount: number, random: () => number): Uint8Array {
  const cells = new Uint8Array(CHUNK_CELL_COUNT);
  for (let index = 0; index < CHUNK_CELL_COUNT; index++) {
    cells[index] = index < distinctValueCount ? index * 3 + 1 : (Math.floor(random() * distinctValueCount)) * 3 + 1;
  }
  return cells;
}

describe("realistic generated terrain", () => {
  let realisticChunks: RealisticChunk[];
  beforeAll(() => {
    realisticChunks = loadRealisticChunks(REALISTIC_COLUMNS_PER_SIDE);
  }, FIXTURE_GENERATION_TIMEOUT_MS);

  test("blocks and light round trip exactly and answer random cell reads", () => {
    const random = createSeededRandom(5);
    expect(realisticChunks.length).toBe(REALISTIC_COLUMNS_PER_SIDE ** 2 * 13);
    for (const chunk of realisticChunks) {
      expectLosslessAndRandomAccess(chunk.blocks, random);
      expectLosslessAndRandomAccess(chunk.light, random);
    }
  });

  test("terrain compresses far below raw while still exercising both uniform and mixed chunks", () => {
    const compressedBlocks = realisticChunks.map((chunk) => compress(chunk.blocks));
    const compressedLight = realisticChunks.map((chunk) => compress(chunk.light));
    const uniformBlockCount = compressedBlocks.filter(isUniform).length;
    expect(uniformBlockCount).toBeGreaterThan(5);
    expect(compressedBlocks.length - uniformBlockCount).toBeGreaterThan(5);
    const averageBlockBytes = compressedBlocks.reduce((sum, chunk) => sum + byteSize(chunk), 0) / compressedBlocks.length;
    const averageLightBytes = compressedLight.reduce((sum, chunk) => sum + byteSize(chunk), 0) / compressedLight.length;
    expect(averageBlockBytes).toBeLessThan(CHUNK_CELL_COUNT / 4);
    expect(averageLightBytes).toBeLessThan(CHUNK_CELL_COUNT / 20);
  });

  test("a surface chunk with real terrain decodes into a reused buffer without leaking the previous chunk", () => {
    const target = new Uint8Array(CHUNK_CELL_COUNT);
    for (const chunk of realisticChunks.filter((_, chunkIndex) => chunkIndex % 5 === 0)) {
      decompressInto(compress(chunk.blocks), target);
      expectIdenticalCells(target, chunk.blocks);
    }
  });
});

describe("adversarial chunks", () => {
  const random = createSeededRandom(77);

  test("random noise falls back to raw and stays within raw plus the header", () => {
    const noise = new Uint8Array(CHUNK_CELL_COUNT);
    for (let index = 0; index < noise.length; index++) noise[index] = Math.floor(random() * 256);
    const compressed = expectLosslessAndRandomAccess(noise, random);
    expect(compressed.kind).toBe("raw");
    expect(byteSize(compressed)).toBe(CHUNK_CELL_COUNT + COMPRESSED_HEADER_BYTES);
  });

  test("a checkerboard of two values packs at one bit per cell", () => {
    const checkerboard = new Uint8Array(CHUNK_CELL_COUNT);
    for (let x = 0; x < 32; x++) {
      for (let y = 0; y < 32; y++) {
        for (let z = 0; z < 32; z++) checkerboard[cellIndexOf(x, y, z)] = (x + y + z) % 2 === 0 ? 7 : 200;
      }
    }
    const compressed = expectLosslessAndRandomAccess(checkerboard, random);
    expect(compressed.kind).toBe("palette");
    expect(compressed.kind === "palette" && compressed.bitsPerCell).toBe(1);
    expect(byteSize(compressed)).toBeLessThan(CHUNK_CELL_COUNT / 7);
  });

  test("a single differing cell is preserved at every corner and at both index extremes", () => {
    const positions = new Set<number>([0, 1, 31, 32, 1023, 1024, CHUNK_CELL_COUNT - 2, CHUNK_CELL_COUNT - 1]);
    for (const x of CORNER_COORDINATES) {
      for (const y of CORNER_COORDINATES) {
        for (const z of CORNER_COORDINATES) positions.add(cellIndexOf(x, y, z));
      }
    }
    for (const differingIndex of positions) {
      const cells = new Uint8Array(CHUNK_CELL_COUNT).fill(1);
      cells[differingIndex] = 250;
      const compressed = expectLosslessAndRandomAccess(cells, random);
      expect(isUniform(compressed)).toBe(false);
      expect(readCell(compressed, differingIndex)).toBe(250);
      if (differingIndex > 0) expect(readCell(compressed, differingIndex - 1)).toBe(1);
      if (differingIndex < CHUNK_CELL_COUNT - 1) expect(readCell(compressed, differingIndex + 1)).toBe(1);
    }
  });

  test("all 256 values present round trips and never exceeds raw plus the header", () => {
    const ramp = new Uint8Array(CHUNK_CELL_COUNT);
    for (let index = 0; index < ramp.length; index++) ramp[index] = index % 256;
    const compressed = expectLosslessAndRandomAccess(ramp, random);
    expect(compressed.kind).toBe("raw");

    const longRunsOfEveryValue = new Uint8Array(CHUNK_CELL_COUNT);
    for (let index = 0; index < longRunsOfEveryValue.length; index++) longRunsOfEveryValue[index] = Math.floor(index / 128);
    const runCompressed = expectLosslessAndRandomAccess(longRunsOfEveryValue, random);
    expect(runCompressed.kind).toBe("runs");
    expect(byteSize(runCompressed)).toBeLessThan(1000);
  });

  for (const [distinctValueCount, expectedBits] of [
    [2, 1],
    [3, 2],
    [4, 2],
    [5, 4],
    [16, 4],
  ] as const) {
    test(`${distinctValueCount} scattered values use a ${expectedBits}-bit palette`, () => {
      const cells = fillWithDistinctValueCount(distinctValueCount, random);
      const compressed = expectLosslessAndRandomAccess(cells, random);
      expect(compressed.kind).toBe("palette");
      expect(compressed.kind === "palette" && compressed.bitsPerCell).toBe(expectedBits);
      expect(compressed.kind === "palette" && compressed.palette.length).toBe(distinctValueCount);
    });
  }

  test("17 scattered values cannot palette and fall back to a lossless non-palette form", () => {
    const compressed = expectLosslessAndRandomAccess(fillWithDistinctValueCount(17, random), random);
    expect(compressed.kind).not.toBe("palette");
  });

  test("palette size boundaries pick the smaller of the 2-bit and 4-bit layouts", () => {
    const fourValues = expectLosslessAndRandomAccess(fillWithDistinctValueCount(4, random), random);
    const fiveValues = expectLosslessAndRandomAccess(fillWithDistinctValueCount(5, random), random);
    expect(byteSize(fourValues)).toBeLessThan(byteSize(fiveValues));
  });

  test("random mixtures of runs, noise and strata stay lossless and bounded", () => {
    for (let trial = 0; trial < 60; trial++) {
      const cells = new Uint8Array(CHUNK_CELL_COUNT);
      let index = 0;
      while (index < CHUNK_CELL_COUNT) {
        const runLength = 1 + Math.floor(random() ** 3 * 4000);
        const value = Math.floor(random() * (trial % 2 === 0 ? 6 : 256));
        cells.fill(value, index, Math.min(index + runLength, CHUNK_CELL_COUNT));
        index += runLength;
      }
      expectLosslessAndRandomAccess(cells, random);
    }
  });
});

describe("run-length chunks", () => {
  test("layered strata choose runs and read correctly at every run boundary", () => {
    const strata = new Uint8Array(CHUNK_CELL_COUNT);
    const layerBlocks = [1, 2, 2, 3, 4, 5, 5, 5, 6, 7];
    for (let x = 0; x < 32; x++) {
      for (let y = 0; y < 32; y++) {
        for (let z = 0; z < 32; z++) strata[cellIndexOf(x, y, z)] = layerBlocks[Math.floor(y / 3.3)]! + (x === 31 && z === 0 ? 40 : 0);
      }
    }
    const compressed = expectLosslessAndRandomAccess(strata, createSeededRandom(1));
    expect(compressed.kind).toBe("runs");
    if (compressed.kind !== "runs") return;
    for (const runStart of compressed.runStarts) {
      expect(readCell(compressed, runStart)).toBe(strata[runStart]!);
      if (runStart > 0) expect(readCell(compressed, runStart - 1)).toBe(strata[runStart - 1]!);
    }
    expect(byteSize(compressed)).toBeLessThan(CHUNK_CELL_COUNT / 8);
  });
});

describe("uniform chunks", () => {
  test("every value is detected, reported, free, and shared between chunks", () => {
    for (let value = 0; value < 256; value++) {
      const first = compress(new Uint8Array(CHUNK_CELL_COUNT).fill(value));
      const second = compress(new Uint8Array(CHUNK_CELL_COUNT).fill(value));
      expect(isUniform(first)).toBe(true);
      expect(uniformValue(first)).toBe(value);
      expect(byteSize(first)).toBe(0);
      expect(second).toBe(first);
      expect(readCell(first, 12345)).toBe(value);
    }
  });

  test("a non-uniform chunk reports no uniform value", () => {
    const cells = new Uint8Array(CHUNK_CELL_COUNT).fill(3);
    cells[CHUNK_CELL_COUNT - 1] = 4;
    const compressed = compress(cells);
    expect(isUniform(compressed)).toBe(false);
    expect(uniformValue(compressed)).toBeUndefined();
  });
});

describe("aliasing and validation", () => {
  test("mutating the source after compress never changes the compressed chunk, for every kind", () => {
    const random = createSeededRandom(3);
    const noise = new Uint8Array(CHUNK_CELL_COUNT).map(() => Math.floor(random() * 256));
    const palette = fillWithDistinctValueCount(4, random);
    const runs = new Uint8Array(CHUNK_CELL_COUNT);
    runs.fill(9, 100, 20000);
    runs.fill(8, 20000);
    for (const source of [noise, palette, runs, new Uint8Array(CHUNK_CELL_COUNT).fill(5)]) {
      const snapshot = source.slice();
      const compressed = compress(source);
      source.fill(77);
      const target = new Uint8Array(CHUNK_CELL_COUNT);
      decompressInto(compressed, target);
      expectIdenticalCells(target, snapshot);
    }
  });

  test("mutating a decompressed buffer does not change the chunk, and the buffer can be reused", () => {
    const original = new Uint8Array(CHUNK_CELL_COUNT);
    original.fill(2, 0, 5000);
    original.fill(6, 5000, 9000);
    const compressed = compress(original);
    const reusedBuffer = new Uint8Array(CHUNK_CELL_COUNT);
    decompressInto(compressed, reusedBuffer);
    reusedBuffer.fill(99);
    const secondBuffer = new Uint8Array(CHUNK_CELL_COUNT);
    decompressInto(compressed, secondBuffer);
    expectIdenticalCells(secondBuffer, original);
    decompressInto(compressed, reusedBuffer);
    expectIdenticalCells(reusedBuffer, original);
    expect(reusedBuffer.buffer).not.toBe(secondBuffer.buffer);
  });

  test("decompressInto overwrites stale content of a previously larger value set", () => {
    const busy = new Uint8Array(CHUNK_CELL_COUNT).map((_, index) => index % 7);
    const uniform = new Uint8Array(CHUNK_CELL_COUNT).fill(0);
    const target = new Uint8Array(CHUNK_CELL_COUNT);
    decompressInto(compress(busy), target);
    decompressInto(compress(uniform), target);
    expectIdenticalCells(target, uniform);
  });

  test("wrong sized arrays are rejected", () => {
    expect(() => compress(new Uint8Array(100))).toThrow();
    expect(() => decompressInto(compress(new Uint8Array(CHUNK_CELL_COUNT)), new Uint8Array(100))).toThrow();
  });
});
