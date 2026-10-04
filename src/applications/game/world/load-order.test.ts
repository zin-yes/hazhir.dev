import { describe, expect, test } from "bun:test";
import { buildLoadOrder, type LoadOrder } from "./load-order";

function collectOffsetKeys(loadOrder: LoadOrder): string[] {
  const keys: string[] = [];
  for (let index = 0; index < loadOrder.offsetCount; index++) {
    keys.push(`${loadOrder.offsetX[index]},${loadOrder.offsetY[index]},${loadOrder.offsetZ[index]}`);
  }
  return keys;
}

function expectedEllipsoidKeys(horizontalRadius: number, verticalUp: number, verticalDown: number): Set<string> {
  const expectedKeys = new Set<string>();
  const horizontalReach = horizontalRadius + 0.5;
  for (let offsetX = -horizontalRadius - 3; offsetX <= horizontalRadius + 3; offsetX++) {
    for (let offsetZ = -horizontalRadius - 3; offsetZ <= horizontalRadius + 3; offsetZ++) {
      for (let offsetY = -verticalDown - 3; offsetY <= verticalUp + 3; offsetY++) {
        const verticalReach = (offsetY >= 0 ? verticalUp : verticalDown) + 0.5;
        const normalizedDistance =
          (offsetX * offsetX + offsetZ * offsetZ) / (horizontalReach * horizontalReach) +
          (offsetY * offsetY) / (verticalReach * verticalReach);
        if (normalizedDistance <= 1) expectedKeys.add(`${offsetX},${offsetY},${offsetZ}`);
      }
    }
  }
  return expectedKeys;
}

describe("buildLoadOrder", () => {
  for (const [horizontalRadius, verticalUp, verticalDown] of [
    [0, 0, 0],
    [1, 1, 1],
    [6, 3, 2],
    [12, 4, 6],
    [24, 5, 5],
  ] as const) {
    test(`every ellipsoid offset appears exactly once for radius ${horizontalRadius} up ${verticalUp} down ${verticalDown}`, () => {
      const loadOrder = buildLoadOrder({ horizontalRadius, verticalUp, verticalDown });
      const actualKeys = collectOffsetKeys(loadOrder);
      const expectedKeys = expectedEllipsoidKeys(horizontalRadius, verticalUp, verticalDown);
      expect(actualKeys.length).toBe(new Set(actualKeys).size);
      expect(new Set(actualKeys)).toEqual(expectedKeys);
      expect(expectedKeys.size).toBeGreaterThan(0);
    });
  }

  test("offsets are sorted nearest first and the origin comes first", () => {
    const loadOrder = buildLoadOrder({ horizontalRadius: 10, verticalUp: 4, verticalDown: 3 });
    expect([loadOrder.offsetX[0], loadOrder.offsetY[0], loadOrder.offsetZ[0]]).toEqual([0, 0, 0]);
    for (let index = 1; index < loadOrder.offsetCount; index++) {
      expect(loadOrder.offsetDistanceSquared[index]!).toBeGreaterThanOrEqual(loadOrder.offsetDistanceSquared[index - 1]!);
      const recomputedDistanceSquared =
        loadOrder.offsetX[index]! ** 2 + loadOrder.offsetY[index]! ** 2 + loadOrder.offsetZ[index]! ** 2;
      expect(loadOrder.offsetDistanceSquared[index]).toBe(recomputedDistanceSquared);
    }
  });

  test("vertical reach is asymmetric when up and down differ", () => {
    const loadOrder = buildLoadOrder({ horizontalRadius: 5, verticalUp: 1, verticalDown: 4 });
    const verticalOffsets = new Set(Array.from(loadOrder.offsetY));
    expect(Math.max(...verticalOffsets)).toBe(1);
    expect(Math.min(...verticalOffsets)).toBe(-4);
  });

  test("column offsets form the sorted disc, each backed by at least one chunk offset", () => {
    const loadOrder = buildLoadOrder({ horizontalRadius: 9, verticalUp: 3, verticalDown: 3 });
    const columnKeys = new Set<string>();
    for (let index = 0; index < loadOrder.columnCount; index++) {
      const columnX = loadOrder.columnOffsetX[index]!;
      const columnZ = loadOrder.columnOffsetZ[index]!;
      columnKeys.add(`${columnX},${columnZ}`);
      expect(columnX * columnX + columnZ * columnZ).toBeLessThanOrEqual(9.5 * 9.5);
      if (index > 0) {
        expect(loadOrder.columnDistanceSquared[index]!).toBeGreaterThanOrEqual(loadOrder.columnDistanceSquared[index - 1]!);
      }
    }
    expect(columnKeys.size).toBe(loadOrder.columnCount);
    let expectedColumnCount = 0;
    for (let columnX = -10; columnX <= 10; columnX++) {
      for (let columnZ = -10; columnZ <= 10; columnZ++) {
        if (columnX * columnX + columnZ * columnZ <= 9.5 * 9.5) expectedColumnCount++;
      }
    }
    expect(loadOrder.columnCount).toBe(expectedColumnCount);
    const chunkColumnKeys = new Set<string>();
    for (let index = 0; index < loadOrder.offsetCount; index++) {
      chunkColumnKeys.add(`${loadOrder.offsetX[index]},${loadOrder.offsetZ[index]}`);
    }
    expect(chunkColumnKeys).toEqual(columnKeys);
  });

  test("cylinder keeps the full vertical range in every column", () => {
    const loadOrder = buildLoadOrder({ horizontalRadius: 7, verticalUp: 2, verticalDown: 3, shape: "cylinder" });
    expect(loadOrder.offsetCount).toBe(loadOrder.columnCount * (2 + 3 + 1));
    expect(loadOrder.contains(7, 2, 0)).toBe(true);
    const ellipsoid = buildLoadOrder({ horizontalRadius: 7, verticalUp: 2, verticalDown: 3 });
    expect(ellipsoid.contains(7, 2, 0)).toBe(false);
  });

  test("contains agrees with the listed offsets and rejects everything else nearby", () => {
    const loadOrder = buildLoadOrder({ horizontalRadius: 6, verticalUp: 2, verticalDown: 2 });
    const listedKeys = new Set(collectOffsetKeys(loadOrder));
    for (let offsetX = -9; offsetX <= 9; offsetX++) {
      for (let offsetY = -5; offsetY <= 5; offsetY++) {
        for (let offsetZ = -9; offsetZ <= 9; offsetZ++) {
          expect(loadOrder.contains(offsetX, offsetY, offsetZ)).toBe(listedKeys.has(`${offsetX},${offsetY},${offsetZ}`));
        }
      }
    }
  });

  test("the same configuration returns the cached instance", () => {
    expect(buildLoadOrder({ horizontalRadius: 4, verticalUp: 2, verticalDown: 2 })).toBe(
      buildLoadOrder({ horizontalRadius: 4, verticalUp: 2, verticalDown: 2 }),
    );
  });

  test("rejects negative and non-finite radii", () => {
    expect(() => buildLoadOrder({ horizontalRadius: -1, verticalUp: 1, verticalDown: 1 })).toThrow();
    expect(() => buildLoadOrder({ horizontalRadius: 4, verticalUp: Number.NaN, verticalDown: 1 })).toThrow();
  });
});
