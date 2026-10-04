import { describe, expect, test } from "bun:test";
import { tileKeyOf, type TileAddress } from "../core/tile-address";
import { packTileSurface } from "../data/packed-tile-surface";
import { heightRangeOf } from "../data/tile-surface";
import { meshTileSurface } from "../meshing/heightfield-mesher";
import { createSyntheticTileSurface } from "../testing/synthetic-terrain.test-helper";
import { BuildQueue, BuildUrgency } from "./build-queue";
import { LodTileCache } from "./tile-cache";

function builtEntry(address: TileAddress) {
  const surface = createSyntheticTileSurface(address);
  const mesh = meshTileSurface(surface);
  return {
    address,
    packedSurface: packTileSurface(surface),
    heightRange: heightRangeOf(surface),
    geometryBytes: mesh.vertices.byteLength + mesh.indices.byteLength,
    payload: `mesh ${address.level}/${address.tileX}/${address.tileZ}`,
    realDataVersion: 0,
  };
}

const keyOf = (address: TileAddress) => tileKeyOf(address.level, address.tileX, address.tileZ);

describe("LOD tile cache", () => {
  test("evicts least recently used unpinned tiles until the byte budget holds, releasing their meshes", () => {
    const startedAt = performance.now();
    const addresses = Array.from({ length: 24 }, (_, index) => ({ level: 2, tileX: index, tileZ: -index }));
    const entries = addresses.map(builtEntry);
    const averageBytes = entries.reduce((sum, entry) => sum + entry.packedSurface.byteLength + entry.geometryBytes, 0) / entries.length;
    const released: string[] = [];
    const cache = new LodTileCache<string>(averageBytes * 10, (tile) => released.push(tile.payload));
    for (const entry of entries) cache.set(entry);
    expect(cache.totalBytes).toBeGreaterThan(cache.budgetBytes);

    cache.touch(addresses[0]!);
    const pinned = new Set([keyOf(addresses[1]!), keyOf(addresses[2]!)]);
    const evicted = cache.enforceBudget(pinned);

    expect(cache.totalBytes).toBeLessThanOrEqual(cache.budgetBytes);
    expect(evicted).toBe(released.length);
    expect(evicted).toBeGreaterThan(10);
    expect(cache.has(addresses[0]!)).toBe(true);
    expect(cache.has(addresses[1]!)).toBe(true);
    expect(cache.has(addresses[2]!)).toBe(true);
    expect(cache.has(addresses[3]!)).toBe(false);
    expect(cache.has(addresses[23]!)).toBe(true);
    expect(released).toContain("mesh 2/3/-3");
    console.log(`cache budget test: ${(performance.now() - startedAt).toFixed(1)} ms, ${averageBytes.toFixed(0)} bytes per tile`);
  });

  test("replacing a tile releases the old mesh and does not double count its bytes", () => {
    const released: string[] = [];
    const cache = new LodTileCache<string>(1e9, (tile) => released.push(tile.payload));
    const entry = builtEntry({ level: 1, tileX: 3, tileZ: 3 });
    cache.set(entry);
    const bytesAfterFirst = cache.totalBytes;
    cache.set({ ...entry, payload: "rebuilt", realDataVersion: 4 });
    expect(cache.totalBytes).toBe(bytesAfterFirst);
    expect(released).toEqual(["mesh 1/3/3"]);
    expect(cache.get(entry.address)!.realDataVersion).toBe(4);
  });

  test("pinned tiles stay even when they alone exceed the budget", () => {
    const cache = new LodTileCache<string>(10, () => {});
    const address = { level: 0, tileX: 0, tileZ: 0 };
    cache.set(builtEntry(address));
    expect(cache.enforceBudget(new Set([keyOf(address)]))).toBe(0);
    expect(cache.size).toBe(1);
  });
});

describe("LOD build queue", () => {
  test("uncovered areas first, then in-frustum tiles, nearest first, never a tile already in flight", () => {
    const queue = new BuildQueue();
    const nearOutside = { address: { level: 1, tileX: 0, tileZ: 0 }, urgency: BuildUrgency.Refine, inFrustum: false, distance: 50 };
    const farInside = { address: { level: 3, tileX: 4, tileZ: 0 }, urgency: BuildUrgency.Refine, inFrustum: true, distance: 900 };
    const nearInside = { address: { level: 2, tileX: 1, tileZ: 0 }, urgency: BuildUrgency.Refine, inFrustum: true, distance: 200 };
    const uncoveredRoot = { address: { level: 8, tileX: -1, tileZ: 0 }, urgency: BuildUrgency.Uncovered, inFrustum: false, distance: 4000 };
    const stale = { address: { level: 2, tileX: 9, tileZ: 9 }, urgency: BuildUrgency.Refresh, inFrustum: true, distance: 10 };
    queue.replaceCandidates([stale, nearOutside, farInside, nearInside, uncoveredRoot]);
    expect(queue.takeNext()).toBe(uncoveredRoot);
    expect(queue.takeNext()).toBe(nearInside);
    queue.replaceCandidates([stale, nearOutside, farInside, nearInside, uncoveredRoot, { ...nearOutside, urgency: BuildUrgency.Uncovered }]);
    expect(queue.waitingCount).toBe(3);
    expect(queue.takeNext()!.address).toEqual(nearOutside.address);
    expect(queue.takeNext()).toBe(farInside);
    expect(queue.takeNext()).toBe(stale);
    expect(queue.takeNext()).toBeUndefined();
    expect(queue.inFlightCount).toBe(5);
    queue.markFinished(uncoveredRoot.address);
    expect(queue.isInFlight(uncoveredRoot.address)).toBe(false);
  });
});
