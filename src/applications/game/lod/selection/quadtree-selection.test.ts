import { describe, expect, test } from "bun:test";
import { tileBoundsOf, tileKeyOf, type TileAddress } from "../core/tile-address";
import { computeRenderSet } from "./render-set";
import { horizontalDistanceToBounds, projectionScaleOf, selectTiles, type SelectionParameters } from "./quadtree-selection";

const baseParameters: SelectionParameters = {
  cameraX: 1037,
  cameraY: 118,
  cameraZ: -493,
  projectionScale: projectionScaleOf(85, 1080),
  maximumCellPixels: 8,
  thresholdGrowthPerLevel: 1.2,
  radiusBlocks: 8192,
  minimumLevel: 0,
  maximumLevel: 8,
};

function leavesContaining(leaves: TileAddress[], pointX: number, pointZ: number): TileAddress[] {
  return leaves.filter((leaf) => {
    const bounds = tileBoundsOf(leaf);
    return pointX >= bounds.minX && pointX < bounds.maxX && pointZ >= bounds.minZ && pointZ < bounds.maxZ;
  });
}

function timedSelect(parameters: SelectionParameters) {
  const startedAt = performance.now();
  const result = selectTiles(parameters);
  return { ...result, elapsedMs: performance.now() - startedAt };
}

describe("quadtree selection", () => {
  test("covers every point within the radius exactly once, in rings that coarsen with distance", () => {
    const { leaves, elapsedMs } = timedSelect(baseParameters);
    console.log(`selection: ${leaves.length} tiles in ${elapsedMs.toFixed(2)} ms`);
    let checkedPoints = 0;
    for (let offsetX = -8100; offsetX <= 8100; offsetX += 97) {
      for (let offsetZ = -8100; offsetZ <= 8100; offsetZ += 89) {
        if (Math.hypot(offsetX, offsetZ) > baseParameters.radiusBlocks) continue;
        expect(leavesContaining(leaves, baseParameters.cameraX + offsetX, baseParameters.cameraZ + offsetZ)).toHaveLength(1);
        checkedPoints++;
      }
    }
    expect(checkedPoints).toBeGreaterThan(20000);
    expect(leavesContaining(leaves, baseParameters.cameraX, baseParameters.cameraZ)[0]!.level).toBe(0);
    const farLeaf = leavesContaining(leaves, baseParameters.cameraX + 8000, baseParameters.cameraZ)[0]!;
    expect(farLeaf.level).toBeGreaterThanOrEqual(5);
    const levelsByDistance = leaves
      .map((leaf) => ({ level: leaf.level, distance: horizontalDistanceToBounds(tileBoundsOf(leaf), baseParameters.cameraX, baseParameters.cameraZ) }))
      .sort((first, second) => first.distance - second.distance);
    for (let index = 1; index < levelsByDistance.length; index++) {
      const nearer = levelsByDistance.filter((entry) => entry.distance < levelsByDistance[index]!.distance / 4);
      for (const entry of nearer) expect(entry.level).toBeLessThanOrEqual(levelsByDistance[index]!.level);
    }
    expect(leaves.length).toBeLessThan(400);
  });

  test("edge-adjacent tiles differ by at most one level", () => {
    const { leaves } = timedSelect(baseParameters);
    const keyed = new Map(leaves.map((leaf) => [tileKeyOf(leaf.level, leaf.tileX, leaf.tileZ), leaf]));
    let comparedPairs = 0;
    for (const leaf of leaves) {
      const bounds = tileBoundsOf(leaf);
      const probes = [
        [bounds.maxX + 0.5, (bounds.minZ + bounds.maxZ) / 2],
        [(bounds.minX + bounds.maxX) / 2, bounds.maxZ + 0.5],
      ];
      for (const [probeX, probeZ] of probes) {
        const neighbor = leavesContaining(leaves, probeX!, probeZ!)[0];
        if (neighbor === undefined) continue;
        expect(keyed.has(tileKeyOf(neighbor.level, neighbor.tileX, neighbor.tileZ))).toBe(true);
        expect(Math.abs(neighbor.level - leaf.level)).toBeLessThanOrEqual(1);
        comparedPairs++;
      }
    }
    expect(comparedPairs).toBeGreaterThan(leaves.length);
  });

  test("merge hysteresis keeps ring boundaries stable when the camera moves a little", () => {
    const first = selectTiles(baseParameters);
    const movedParameters = { ...baseParameters, cameraX: baseParameters.cameraX + 37, cameraZ: baseParameters.cameraZ - 21 };
    const withoutHysteresis = selectTiles(movedParameters);
    const withHysteresis = selectTiles({ ...movedParameters, previouslySplit: first.split });
    const keysOf = (leaves: TileAddress[]) => new Set(leaves.map((leaf) => tileKeyOf(leaf.level, leaf.tileX, leaf.tileZ)));
    const firstKeys = keysOf(first.leaves);
    const changedWithout = [...keysOf(withoutHysteresis.leaves)].filter((key) => !firstKeys.has(key)).length;
    const changedWith = [...keysOf(withHysteresis.leaves)].filter((key) => !firstKeys.has(key)).length;
    expect(changedWithout).toBeGreaterThan(0);
    expect(changedWith).toBeLessThan(changedWithout);
  });

  test("flying high selects coarser tiles than standing on the ground", () => {
    const ground = selectTiles(baseParameters);
    const high = selectTiles({ ...baseParameters, cameraY: 2000 });
    expect(high.leaves.length).toBeLessThan(ground.leaves.length);
  });
});

describe("render set", () => {
  const smallParameters: SelectionParameters = { ...baseParameters, radiusBlocks: 1500, maximumLevel: 6 };
  const selection = selectTiles(smallParameters);
  const leafKey = (address: TileAddress) => tileKeyOf(address.level, address.tileX, address.tileZ);

  function expectSingleCover(drawn: TileAddress[]) {
    for (let offsetX = -1400; offsetX <= 1400; offsetX += 61) {
      for (let offsetZ = -1400; offsetZ <= 1400; offsetZ += 53) {
        if (Math.hypot(offsetX, offsetZ) > 1450) continue;
        expect(leavesContaining(drawn, smallParameters.cameraX + offsetX, smallParameters.cameraZ + offsetZ)).toHaveLength(1);
      }
    }
  }

  test("draws exactly the leaves when every mesh is ready", () => {
    const renderSet = computeRenderSet(selection, smallParameters, () => true);
    expect(new Set(renderSet.drawn.map(leafKey))).toEqual(new Set(selection.leaves.map(leafKey)));
    expect(renderSet.missingLeaves).toHaveLength(0);
  });

  test("falls back to a ready ancestor without drawing its ready descendants twice", () => {
    const missing = selection.leaves.find((leaf) => leaf.level === 1)!;
    const ancestorKeys = new Set<number>();
    for (let level = missing.level + 1; level <= smallParameters.maximumLevel; level++) {
      const divisor = 2 ** (level - missing.level);
      ancestorKeys.add(tileKeyOf(level, Math.floor(missing.tileX / divisor), Math.floor(missing.tileZ / divisor)));
    }
    const grandparentKey = tileKeyOf(missing.level + 2, Math.floor(missing.tileX / 4), Math.floor(missing.tileZ / 4));
    const isInsideMissing = (address: TileAddress) =>
      address.level <= missing.level &&
      Math.floor(address.tileX / 2 ** (missing.level - address.level)) === missing.tileX &&
      Math.floor(address.tileZ / 2 ** (missing.level - address.level)) === missing.tileZ;
    const renderSet = computeRenderSet(selection, smallParameters, (address) => {
      const key = leafKey(address);
      if (isInsideMissing(address)) return false;
      if (ancestorKeys.has(key)) return key === grandparentKey;
      return true;
    });
    expect(renderSet.drawn.map(leafKey)).toContain(grandparentKey);
    expect(renderSet.missingLeaves.map(leafKey)).toEqual([leafKey(missing)]);
    expectSingleCover(renderSet.drawn);
  });

  test("uses the four finer tiles kept from before a merge while the merged tile builds", () => {
    const missing = selection.leaves.find((leaf) => leaf.level === 3)!;
    const renderSet = computeRenderSet(selection, smallParameters, (address) => leafKey(address) !== leafKey(missing));
    const fineTiles = renderSet.drawn.filter((tile) => tile.level === 2 && Math.floor(tile.tileX / 2) === missing.tileX && Math.floor(tile.tileZ / 2) === missing.tileZ);
    expect(fineTiles).toHaveLength(4);
    expectSingleCover(renderSet.drawn);
  });

  test("leaves an area empty and reports its leaves when nothing covering it is ready", () => {
    const renderSet = computeRenderSet(selection, smallParameters, () => false);
    expect(renderSet.drawn).toHaveLength(0);
    expect(renderSet.missingLeaves).toHaveLength(selection.leaves.length);
  });
});
