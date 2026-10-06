import { describe, expect, test } from "bun:test";
import { DIMENSIONS } from "../../profiler/dimensions";
import { beginWorkerTask, finishWorkerTask } from "../../profiler/worker-recorder";
import { childAddressesOf, parentAddressOf } from "../core/tile-address";
import { unpackTileSurface } from "../data/packed-tile-surface";
import { buildLodTile, type LodTileBuildResult } from "./lod-tile-builder";

const SEED = 20240611;

function bytesOf(view: ArrayBufferView | ArrayBuffer): Buffer {
  return view instanceof ArrayBuffer ? Buffer.from(view) : Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}

function expectIdentical(first: LodTileBuildResult, second: LodTileBuildResult) {
  expect(bytesOf(second.packedSurface).equals(bytesOf(first.packedSurface))).toBe(true);
  expect(bytesOf(second.vertices).equals(bytesOf(first.vertices))).toBe(true);
  expect(second.terrainQuadCount).toBe(first.terrainQuadCount);
  expect(second.waterQuadCount).toBe(first.waterQuadCount);
}

describe("LOD tile builder", () => {
  test("builds are byte-identical when repeated, with or without an ancestor hint", () => {
    const address = { level: 4, tileX: -2, tileZ: 5 };
    const first = buildLodTile({ seed: SEED, address });
    const second = buildLodTile({ seed: SEED, address });
    expectIdentical(first, second);
    console.log(`level-4 tile: sample ${first.sampleMilliseconds.toFixed(1)} ms, mesh ${first.meshMilliseconds.toFixed(1)} ms, ${first.vertices.length / 2} vertices`);
    expect(first.source).toBe("worldgen");
    expect(first.vertices.length).toBeGreaterThan(0);
    expect(first.vertices.length).toBe((first.terrainQuadCount + first.waterQuadCount) * 8);
  });

  test("a parent built from its four children is their exact downsample and needs no worldgen sampling", () => {
    const parent = { level: 3, tileX: 1, tileZ: -1 };
    const children = childAddressesOf(parent).map((address) => buildLodTile({ seed: SEED, address }));
    const fromChildren = buildLodTile({ seed: SEED, address: parent, children: children.map((child) => child.packedSurface) });
    expect(fromChildren.source).toBe("children");
    expect(fromChildren.sampling).toBeNull();
    const parentSurface = unpackTileSurface(fromChildren.packedSurface);
    const firstChild = unpackTileSurface(children[0]!.packedSurface);
    const meanOfFirstFour = Math.round((firstChild.heights[0]! + firstChild.heights[1]! + firstChild.heights[32]! + firstChild.heights[33]!) / 4);
    expect(parentSurface.heights[0]).toBe(meanOfFirstFour);
    const sampled = buildLodTile({ seed: SEED, address: parent });
    const sampledSurface = unpackTileSurface(sampled.packedSurface);
    let largeDifferences = 0;
    for (let index = 0; index < 1024; index++) if (Math.abs(sampledSurface.heights[index]! - parentSurface.heights[index]!) > 8) largeDifferences++;
    expect(largeDifferences).toBeLessThan(1024 * 0.1);
  });

  test("a missing child falls back to worldgen sampling seeded by the hint", () => {
    const address = { level: 2, tileX: 0, tileZ: 3 };
    const hintAddress = parentAddressOf(parentAddressOf(address));
    const hint = buildLodTile({ seed: SEED, address: hintAddress });
    const result = buildLodTile({
      seed: SEED,
      address,
      children: [null, null, null, null],
      hint: { address: hintAddress, packedSurface: hint.packedSurface },
    });
    expect(result.source).toBe("worldgen");
    expect(result.sampling!.sampledCells).toBe(1024);
  });
});

describe("LOD tile builder profiling", () => {
  test("worker counters add up to the built mesh and the build is attributed to its level", () => {
    const address = { level: 4, tileX: 3, tileZ: -2 };
    beginWorkerTask(true);
    const result = buildLodTile({ seed: SEED, address });
    const profile = finishWorkerTask()!;
    const { counters } = profile;

    expect(counters.lodVertices).toBe(result.vertices.length / 2);
    expect(counters.lodTerrainQuads! + counters.lodWaterQuads!).toBe(result.vertices.length / 8);
    expect(counters.lodMeshTopRectangles! + counters.lodMeshWallQuads! + counters.lodMeshSkirtQuads!).toBe(result.terrainQuadCount);
    expect(counters.lodTriangles).toBe(counters.lodVertices! / 2);
    expect(counters.lodPackedSurfaceBytes).toBe(result.packedSurface.byteLength);
    expect(counters.lodTilesFromWorldgen).toBe(1);
    expect(counters.lodColdRequests).toBe(1);
    expect(counters.lodCrossingSearches!).toBeGreaterThan(0);
    expect(counters.lodCrossingSearches).toBe(counters.lodBiomeLookups);
    expect(counters.lodDensityEvaluations!).toBeGreaterThan(counters.lodCrossingSearches!);

    const levelEntries = profile.breakdowns[DIMENSIONS.lodLevel]!;
    expect(levelEntries.find((entry) => entry.key === "L4")?.units).toBe(result.vertices.length / 2);
    const sectionPaths = profile.callTree.map((node) => node.path);
    expect(sectionPaths.some((path) => path.endsWith("lod.mesh>lod.mesh.tops"))).toBe(true);
    expect(sectionPaths.some((path) => path.endsWith("lod.sampleWorldgen>lod.sample.heights"))).toBe(true);
  });

  test("a build from four children reports the downsample and never touches worldgen", () => {
    const parent = { level: 3, tileX: 1, tileZ: -1 };
    const children = childAddressesOf(parent).map((childAddress) => buildLodTile({ seed: SEED, address: childAddress }).packedSurface);
    beginWorkerTask(true);
    buildLodTile({ seed: SEED, address: parent, children });
    const { counters, callTree } = finishWorkerTask()!;

    expect(counters.lodTilesFromChildren).toBe(1);
    expect(counters.lodRequestChildrenBytes).toBe(children.reduce((total, child) => total + child.byteLength, 0));
    expect(counters.lodUnpackedTiles).toBe(4);
    expect(counters.lodDensityEvaluations).toBeUndefined();
    expect(callTree.some((node) => node.path.endsWith("lod.downsampleChildren>lod.downsampleChild"))).toBe(true);
  });
});

describe("LOD worker", () => {
  test("answers the WorkerPool protocol with transferred buffers", async () => {
    const startedAt = performance.now();
    const worker = new Worker(new URL("./lod-worker.ts", import.meta.url).href);
    try {
      const reply = await new Promise<MessageEvent>((resolve, reject) => {
        worker.onmessage = resolve;
        worker.onerror = (event) => reject(event);
        worker.postMessage({ id: 7, method: "buildLodTile", params: [{ seed: SEED, address: { level: 5, tileX: 0, tileZ: 0 } }] });
      });
      expect(reply.data.id).toBe(7);
      expect(reply.data.error).toBeUndefined();
      const result = reply.data.result as LodTileBuildResult;
      expect(result.vertices).toBeInstanceOf(Uint32Array);
      expect(result.vertices.length).toBeGreaterThan(0);
      expect(unpackTileSurface(result.packedSurface).heights.length).toBe(1024);
      console.log(`worker round trip (cold): ${(performance.now() - startedAt).toFixed(1)} ms`);
    } finally {
      worker.terminate();
    }
  });
});
