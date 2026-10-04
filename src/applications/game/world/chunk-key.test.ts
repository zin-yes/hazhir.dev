import { describe, expect, test } from "bun:test";
import {
  FACE_NEIGHBOR_KEY_DELTAS,
  FACE_NEIGHBOR_OFFSETS,
  MAX_CHUNK_X,
  MAX_CHUNK_Y,
  MAX_CHUNK_Z,
  MIN_CHUNK_X,
  MIN_CHUNK_Y,
  MIN_CHUNK_Z,
  chunkKeyInColumn,
  chunkKeyX,
  chunkKeyY,
  chunkKeyZ,
  columnKeyOfChunkKey,
  createChunkCoordinates,
  createColumnCoordinates,
  isChunkCoordinateInRange,
  offsetChunkKey,
  offsetColumnKey,
  packChunkKey,
  packColumnKey,
  unpackChunkKey,
  unpackColumnKey,
} from "./chunk-key";

function randomIntegerInclusive(minimum: number, maximum: number): number {
  return minimum + Math.floor(Math.random() * (maximum - minimum + 1));
}

describe("chunk keys", () => {
  test("keys are safe integers even at the extreme corners", () => {
    for (const chunkX of [MIN_CHUNK_X, MAX_CHUNK_X]) {
      for (const chunkY of [MIN_CHUNK_Y, MAX_CHUNK_Y]) {
        for (const chunkZ of [MIN_CHUNK_Z, MAX_CHUNK_Z]) {
          expect(Number.isSafeInteger(packChunkKey(chunkX, chunkY, chunkZ))).toBe(true);
        }
      }
    }
  });

  test("round trips negative, zero, positive and extreme coordinates", () => {
    const out = createChunkCoordinates();
    const xs = [MIN_CHUNK_X, -1_000_000, -33, -1, 0, 1, 33, 1_000_000, MAX_CHUNK_X];
    const ys = [MIN_CHUNK_Y, -2, -1, 0, 1, 10, MAX_CHUNK_Y];
    const zs = [MIN_CHUNK_Z, -999_999, -1, 0, 1, 77, MAX_CHUNK_Z];
    for (const chunkX of xs) {
      for (const chunkY of ys) {
        for (const chunkZ of zs) {
          const key = packChunkKey(chunkX, chunkY, chunkZ);
          unpackChunkKey(key, out);
          expect([out.chunkX, out.chunkY, out.chunkZ]).toEqual([chunkX, chunkY, chunkZ]);
          expect(chunkKeyX(key)).toBe(chunkX);
          expect(chunkKeyY(key)).toBe(chunkY);
          expect(chunkKeyZ(key)).toBe(chunkZ);
        }
      }
    }
  });

  test("unpack reuses and returns the provided object", () => {
    const out = createChunkCoordinates();
    expect(unpackChunkKey(packChunkKey(3, -4, 5), out)).toBe(out);
  });

  test("1e6 random coordinates round trip and never collide", () => {
    const seenKeys = new Set<number>();
    const seenCoordinates = new Set<string>();
    const out = createChunkCoordinates();
    for (let sampleIndex = 0; sampleIndex < 1_000_000; sampleIndex++) {
      const chunkX = randomIntegerInclusive(MIN_CHUNK_X, MAX_CHUNK_X);
      const chunkY = randomIntegerInclusive(MIN_CHUNK_Y, MAX_CHUNK_Y);
      const chunkZ = randomIntegerInclusive(MIN_CHUNK_Z, MAX_CHUNK_Z);
      const key = packChunkKey(chunkX, chunkY, chunkZ);
      unpackChunkKey(key, out);
      if (out.chunkX !== chunkX || out.chunkY !== chunkY || out.chunkZ !== chunkZ) {
        throw new Error(`round trip failed for ${chunkX},${chunkY},${chunkZ}`);
      }
      seenKeys.add(key);
      seenCoordinates.add(`${chunkX},${chunkY},${chunkZ}`);
    }
    expect(seenKeys.size).toBe(seenCoordinates.size);
  });

  test("every coordinate in a dense box around the origin gets a distinct key", () => {
    const seenKeys = new Set<number>();
    let expectedCount = 0;
    for (let chunkX = -20; chunkX <= 20; chunkX++) {
      for (let chunkY = -3; chunkY <= 11; chunkY++) {
        for (let chunkZ = -20; chunkZ <= 20; chunkZ++) {
          seenKeys.add(packChunkKey(chunkX, chunkY, chunkZ));
          expectedCount++;
        }
      }
    }
    expect(seenKeys.size).toBe(expectedCount);
  });

  test("neighbor key math equals packing the neighbor coordinates, across sign changes", () => {
    for (const [chunkX, chunkY, chunkZ] of [
      [0, 0, 0],
      [-1, -1, -1],
      [0, -2, 5],
      [-32768, 9, 32767],
      [MIN_CHUNK_X + 1, MIN_CHUNK_Y + 1, MIN_CHUNK_Z + 1],
      [MAX_CHUNK_X - 1, MAX_CHUNK_Y - 1, MAX_CHUNK_Z - 1],
    ] as const) {
      const key = packChunkKey(chunkX, chunkY, chunkZ);
      FACE_NEIGHBOR_OFFSETS.forEach(([deltaX, deltaY, deltaZ], faceIndex) => {
        const expectedKey = packChunkKey(chunkX + deltaX, chunkY + deltaY, chunkZ + deltaZ);
        expect(key + FACE_NEIGHBOR_KEY_DELTAS[faceIndex]!).toBe(expectedKey);
        expect(offsetChunkKey(key, deltaX, deltaY, deltaZ)).toBe(expectedKey);
      });
      expect(offsetChunkKey(key, 1, -1, 1)).toBe(packChunkKey(chunkX + 1, chunkY - 1, chunkZ + 1));
    }
  });

  test("column key ignores y and matches the chunk key's column", () => {
    const out = createColumnCoordinates();
    for (const [chunkX, chunkZ] of [
      [0, 0],
      [-7, 12],
      [5, -9],
      [MIN_CHUNK_X, MAX_CHUNK_Z],
      [MAX_CHUNK_X, MIN_CHUNK_Z],
    ] as const) {
      const columnKey = packColumnKey(chunkX, chunkZ);
      unpackColumnKey(columnKey, out);
      expect([out.chunkX, out.chunkZ]).toEqual([chunkX, chunkZ]);
      for (const chunkY of [MIN_CHUNK_Y, -2, 0, 10, MAX_CHUNK_Y]) {
        const chunkKey = packChunkKey(chunkX, chunkY, chunkZ);
        expect(columnKeyOfChunkKey(chunkKey)).toBe(columnKey);
        expect(chunkKeyInColumn(columnKey, chunkY)).toBe(chunkKey);
      }
    }
  });

  test("column neighbor math equals packing the neighbor column", () => {
    const columnKey = packColumnKey(-1, 0);
    expect(offsetColumnKey(columnKey, 1, -1)).toBe(packColumnKey(0, -1));
    expect(offsetColumnKey(columnKey, -3, 4)).toBe(packColumnKey(-4, 4));
  });

  test("range check rejects out-of-range and fractional coordinates", () => {
    expect(isChunkCoordinateInRange(MAX_CHUNK_X, MAX_CHUNK_Y, MAX_CHUNK_Z)).toBe(true);
    expect(isChunkCoordinateInRange(MAX_CHUNK_X + 1, 0, 0)).toBe(false);
    expect(isChunkCoordinateInRange(0, MIN_CHUNK_Y - 1, 0)).toBe(false);
    expect(isChunkCoordinateInRange(0, 0, 0.5)).toBe(false);
  });
});
