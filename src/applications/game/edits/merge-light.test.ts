import { describe, expect, test } from "bun:test";
import { NEGATIVE_X, NEGATIVE_Y, POSITIVE_X, POSITIVE_Y, POSITIVE_Z } from "./chunk-cluster";
import {
  LIGHT_MERGE_CHANGED,
  drainLightMergeStats,
  mergeLightInPlace,
  mergeLightReportingFaces,
  mergeLightUpdatesInPlace,
} from "./merge-light";
import { createSeededRandom } from "./light-test-world.test-helper";

const CHUNK_CELLS = 32 * 32 * 32;

function randomLight(seed: number, length = CHUNK_CELLS): Uint8Array {
  const random = createSeededRandom(seed);
  const light = new Uint8Array(length);
  for (let index = 0; index < length; index++) {
    light[index] = Math.floor(random() * 256);
  }
  return light;
}

function nibbleWiseMax(first: Uint8Array, second: Uint8Array): Uint8Array {
  return first.map((value, index) => {
    const sky = Math.max(value >> 4, second[index] >> 4);
    const block = Math.max(value & 0xf, second[index] & 0xf);
    return (sky << 4) | block;
  });
}

describe("mergeLightInPlace", () => {
  test("keeps the brighter sky and the brighter block level separately", () => {
    const target = new Uint8Array([0xf3, 0x2c, 0x00, 0xff]);
    const update = new Uint8Array([0x3f, 0xc2, 0x00, 0x00]);
    mergeLightInPlace(target, update);
    expect(Array.from(target)).toEqual([0xff, 0xcc, 0x00, 0xff]);
  });

  test("matches a cell by cell reference on a full chunk of random light", () => {
    const target = randomLight(1);
    const update = randomLight(2);
    const expected = nibbleWiseMax(target, update);
    mergeLightInPlace(target, update);
    expect(target).toEqual(expected);
  });

  test("handles arrays that are not word aligned or not a whole number of words", () => {
    const backing = randomLight(3, CHUNK_CELLS + 8);
    const otherBacking = randomLight(4, CHUNK_CELLS + 8);
    const target = backing.subarray(1, 1 + 1003);
    const update = otherBacking.subarray(2, 2 + 1003);
    const expected = nibbleWiseMax(target, update);
    mergeLightInPlace(target, update);
    expect(target).toEqual(expected);
  });

  test("merges many updates into the first array without touching the updates", () => {
    const target = randomLight(5);
    const updates = [randomLight(6), randomLight(7), randomLight(8)];
    const untouchedCopies = updates.map((update) => new Uint8Array(update));
    const expected = updates.reduce(
      (merged, update) => nibbleWiseMax(merged, update),
      new Uint8Array(target),
    );
    expect(mergeLightUpdatesInPlace(target, updates)).toBe(target);
    expect(target).toEqual(expected);
    updates.forEach((update, position) => expect(update).toEqual(untouchedCopies[position]));
  });

  test("refuses arrays of different sizes", () => {
    expect(() => mergeLightInPlace(new Uint8Array(8), new Uint8Array(4))).toThrow();
  });
});

describe("mergeLightReportingFaces", () => {
  const cellAt = (x: number, y: number, z: number) => (x << 10) | (y << 5) | z;

  test("merges like mergeLightInPlace and names exactly the faces whose cells got brighter", () => {
    const target = randomLight(11);
    const update = new Uint8Array(CHUNK_CELLS);
    update[cellAt(0, 7, 9)] = 0xff;
    update[cellAt(12, 31, 3)] = 0xff;
    update[cellAt(5, 5, 5)] = 0xff;
    target[cellAt(0, 7, 9)] = 0x11;
    target[cellAt(12, 31, 3)] = 0x22;
    target[cellAt(5, 5, 5)] = 0x33;
    const expected = nibbleWiseMax(target, update);

    const changes = mergeLightReportingFaces(target, update);

    expect(Array.from(target)).toEqual(Array.from(expected));
    expect(changes).toBe(LIGHT_MERGE_CHANGED | (1 << NEGATIVE_X) | (1 << POSITIVE_Y));
  });

  test("reports nothing when the update is no brighter anywhere, even if its bytes differ", () => {
    const target = new Uint8Array(CHUNK_CELLS).fill(0xf5);
    const update = new Uint8Array(CHUNK_CELLS).fill(0x52);
    expect(mergeLightReportingFaces(target, update)).toBe(0);
    expect(target.every((value) => value === 0xf5)).toBe(true);
  });

  test("a brighter block channel on a corner cell names all three faces of the corner", () => {
    const target = new Uint8Array(CHUNK_CELLS).fill(0xf0);
    const update = new Uint8Array(CHUNK_CELLS);
    update[cellAt(31, 0, 31)] = 0x0a;
    const changes = mergeLightReportingFaces(target, update);
    expect(changes).toBe(LIGHT_MERGE_CHANGED | (1 << POSITIVE_X) | (1 << NEGATIVE_Y) | (1 << POSITIVE_Z));
    expect(target[cellAt(31, 0, 31)]).toBe(0xfa);
  });
});

describe("light merge stats", () => {
  const cellAt = (x: number, y: number, z: number) => (x << 10) | (y << 5) | z;

  test("count the words compared, the cells brightened and the faces reported, then reset when drained", () => {
    drainLightMergeStats();
    const target = new Uint8Array(CHUNK_CELLS).fill(0xf0);
    const update = new Uint8Array(CHUNK_CELLS);
    update[cellAt(31, 0, 31)] = 0x0a;
    update[cellAt(31, 0, 30)] = 0x0b;
    update[cellAt(10, 10, 10)] = 0x05;
    mergeLightReportingFaces(target, update);
    mergeLightReportingFaces(target, update);

    const stats = drainLightMergeStats();
    expect(stats.reportingMerges).toBe(2);
    expect(stats.reportingMergesChanged).toBe(1);
    expect(stats.wordsCompared).toBe(2 * (CHUNK_CELLS / 4));
    expect(stats.wordsBrightened).toBe(2);
    expect(stats.cellsBrightened).toBe(3);
    expect(stats.faceBitsReported).toBe(3);
    expect(drainLightMergeStats().reportingMerges).toBe(0);
  });
});
