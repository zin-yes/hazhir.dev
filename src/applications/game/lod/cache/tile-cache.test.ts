import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { tileKeyOf, type TileAddress } from "../core/tile-address";
import { packTileSurface } from "../data/packed-tile-surface";
import { heightRangeOf } from "../data/tile-surface";
import { meshTileSurface } from "../meshing/heightfield-mesher";
import { counterTotal, gaugeLast, startLodProfiling, stopLodProfiling, timerCalls } from "../testing/profiler-readout.test-helper";
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
    geometryBytes: mesh.vertices.byteLength,
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

describe("LOD cache and queue profiling", () => {
  beforeEach(startLodProfiling);
  afterEach(stopLodProfiling);

  test("the cache reports lookups, evictions and its size per level", () => {
    const addresses = Array.from({ length: 12 }, (_, index) => ({ level: index < 8 ? 2 : 5, tileX: index, tileZ: 0 }));
    const entries = addresses.map(builtEntry);
    const cache = new LodTileCache<string>(entries.reduce((sum, entry) => sum + entry.packedSurface.byteLength + entry.geometryBytes, 0) / 2, () => {});
    for (const entry of entries) cache.set(entry);
    expect(cache.get(addresses[0]!)).toBeDefined();
    expect(cache.get(addresses[9]!)).toBeDefined();
    expect(cache.has({ level: 2, tileX: 99, tileZ: 99 })).toBe(false);
    expect(cache.has({ level: 5, tileX: 99, tileZ: 99 })).toBe(false);
    expect(cache.has({ level: 5, tileX: 99, tileZ: 98 })).toBe(false);

    const evicted = cache.enforceBudget(new Set());
    cache.reportToProfiler();

    expect(evicted).toBeGreaterThan(3);
    expect(counterTotal("game.lod.cache.inserts")).toBe(12);
    expect(counterTotal("game.lod.cache.getHits")).toBe(2);
    expect(counterTotal("game.lod.cache.hasMisses")).toBe(3);
    expect(counterTotal("game.lod.cache.misses.L2")).toBe(1);
    expect(counterTotal("game.lod.cache.misses.L5")).toBe(2);
    expect(counterTotal("game.lod.cache.evictions")).toBe(evicted);
    expect(counterTotal("game.lod.cache.evictions.L2") + counterTotal("game.lod.cache.evictions.L5")).toBe(evicted);
    expect(gaugeLast("game.lod.cache.entries")).toBe(12 - evicted);
    expect(gaugeLast("memory.lod.tileCache.L2")! + gaugeLast("memory.lod.tileCache.L5")!).toBe(cache.totalBytes);
    expect(timerCalls("main.lod.cache.enforceBudget")).toBe(1);

    cache.reportToProfiler();
    expect(counterTotal("game.lod.cache.getHits")).toBe(2);
  });

  test("the queue reports carried-over and dropped candidates and the wait and round trip of a dispatched build", () => {
    const queue = new BuildQueue();
    const candidate = (tileX: number, urgency = BuildUrgency.Refine) => ({ address: { level: 2, tileX, tileZ: 0 }, urgency, inFrustum: true, distance: tileX });
    queue.replaceCandidates([candidate(1), candidate(2), candidate(3, BuildUrgency.Refresh)]);
    queue.replaceCandidates([candidate(2), candidate(4), candidate(4)]);

    expect(counterTotal("game.lod.queue.candidatesOffered")).toBe(6);
    expect(counterTotal("game.lod.queue.carriedOver")).toBe(1);
    expect(counterTotal("game.lod.queue.droppedBeforeDispatch")).toBe(2);
    expect(counterTotal("game.lod.queue.duplicatesMerged")).toBe(1);
    expect(counterTotal("game.lod.queue.urgency.refresh")).toBe(1);

    const dispatched = queue.takeNext()!;
    expect(dispatched.address.tileX).toBe(2);
    expect(timerCalls("latency.lod.buildQueueWait")).toBe(1);
    expect(timerCalls("latency.lod.buildRoundTrip")).toBe(0);
    queue.markFinished(dispatched.address);
    expect(timerCalls("latency.lod.buildRoundTrip")).toBe(1);
    expect(timerCalls("latency.lod.buildQueueToDone.L2")).toBe(1);
    expect(counterTotal("game.lod.queue.dispatched.L2")).toBe(1);
  });
});
