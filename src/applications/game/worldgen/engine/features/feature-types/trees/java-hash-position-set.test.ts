// JavaHashPositionSet against real java.util.HashSet<BlockPos> iteration order after random add / remove sequences
// over dense position clouds (fixtures/trees-reference.json.gz, recorded by fixtures/TreesReference.java).

import { afterAll, describe, expect, test } from "bun:test";
import { JavaHashPositionSet, javaPositionHash } from "./java-hash-position-set";
import { loadTreesReference } from "./trees-reference.node";

const startedAt = performance.now();

describe("JavaHashPositionSet", () => {
  test("iteration order equals java.util.HashSet after adds, removals and re-adds", () => {
    const { hashSetScenarios } = loadTreesReference();
    expect(hashSetScenarios.length).toBeGreaterThanOrEqual(50);
    let checkedPositions = 0;
    const mismatches: string[] = [];
    hashSetScenarios.forEach((scenario, scenarioIndex) => {
      const set = new JavaHashPositionSet();
      let operationIndex = 0;
      for (const checkpoint of scenario.checkpoints) {
        for (; operationIndex < checkpoint.afterOps; operationIndex++) {
          const [kind, x, y, z] = scenario.ops.slice(operationIndex * 4, operationIndex * 4 + 4) as [number, number, number, number];
          if (kind === 0) set.add(x, y, z);
          else if (kind === 1) set.remove(x, y, z);
          else {
            const popped = set.pollFirst()!;
            expect([popped.x, popped.y, popped.z]).toEqual([x, y, z]);
          }
        }
        const actual = set.values().flatMap((position) => [position.x, position.y, position.z]);
        checkedPositions += actual.length / 3;
        if (actual.join(",") !== checkpoint.order.join(",")) mismatches.push(`scenario ${scenarioIndex} after ${checkpoint.afterOps} operations: ${actual.length / 3} vs ${checkpoint.order.length / 3} positions`);
        expect(set.size).toBe(checkpoint.order.length / 3);
      }
    });
    expect(mismatches).toEqual([]);
    expect(checkedPositions).toBeGreaterThan(5000);
  });

  test("first() is the first element of the iteration order, also after removing it repeatedly", () => {
    const set = new JavaHashPositionSet();
    for (let x = 0; x < 12; x++) for (let z = 0; z < 12; z++) set.add(100 + x, 70 + ((x * z) % 5), -50 + z);
    while (!set.isEmpty()) {
      const first = set.first()!;
      expect(first).toBe(set.values()[0]!);
      expect(set.remove(first.x, first.y, first.z)).toBe(true);
    }
    expect(set.first()).toBeUndefined();
  });

  test("hash matches Vec3i.hashCode spread for negative coordinates", () => {
    const hashCode = (-1 * 31 + -64) * 31 + -3;
    expect(javaPositionHash(-3, -64, -1)).toBe(hashCode ^ (hashCode >>> 16));
  });
});

afterAll(() => {
  console.log(`JavaHashPositionSet tests: ${(performance.now() - startedAt).toFixed(0)} ms`);
});
