// The iteration order of java.util.HashSet<BlockPos> against the real JDK: patch-shaped position sets large enough
// to resize repeatedly and to turn buckets into red-black trees (VegetationPatchFeature draws random numbers in
// this order, so one swapped pair changes every later block of the patch).

import { afterAll, describe, expect, test } from "bun:test";
import { loadGroundReference } from "../testing/ground-reference.node";
import { JavaBlockPosHashSet } from "./java-block-pos-hash-set";

const startedAt = performance.now();

function toTriples(flat: readonly number[]): string[] {
  const triples: string[] = [];
  for (let index = 0; index < flat.length; index += 3) triples.push(`${flat[index]},${flat[index + 1]},${flat[index + 2]}`);
  return triples;
}

describe("JavaBlockPosHashSet", () => {
  test("iterates in the order of the real HashSet for resized and treeified tables", () => {
    const { hashSetOrders } = loadGroundReference();
    expect(hashSetOrders.length).toBeGreaterThanOrEqual(5);
    let largestSet = 0;
    for (const { inserted, order } of hashSetOrders) {
      const set = new JavaBlockPosHashSet<null>();
      for (let index = 0; index < inserted.length; index += 3) set.add(inserted[index]!, inserted[index + 1]!, inserted[index + 2]!, null);
      expect(set.entries().map((entry) => `${entry.x},${entry.y},${entry.z}`)).toEqual(toTriples(order));
      largestSet = Math.max(largestSet, set.size);
    }
    expect(largestSet).toBeGreaterThan(500);
  });

  test("ignores a position that is already present", () => {
    const set = new JavaBlockPosHashSet<number>();
    expect(set.add(3, 64, -9, 1)).toBe(true);
    expect(set.add(3, 64, -9, 2)).toBe(false);
    expect(set.size).toBe(1);
    expect(set.entries()[0]!.value).toBe(1);
  });
});

afterAll(() => {
  console.log(`java block pos hash set test: ${(performance.now() - startedAt).toFixed(0)} ms`);
});
