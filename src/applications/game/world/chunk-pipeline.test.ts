import { describe, expect, test } from "bun:test";
import { BlockType } from "../blocks";
import { ChunkPipeline } from "./chunk-pipeline";
import { createColumnCoordinates, packChunkKey, packColumnKey, unpackColumnKey } from "./chunk-key";
import type { ChunkRecord } from "./chunk-record";
import { EDIT_MESH_PRIORITY } from "./mesh-coordinator";
import {
  FakeGeneration,
  FakeLighting,
  FakeMeshing,
  GROUND_LEVEL,
  cellIndexOf,
  flushPromises,
  settle,
} from "./pipeline-fakes.test-helper";
import type { RenderSettings } from "./render-settings";

const FACING_POSITIVE_X = { x: 1, y: 0, z: 0 };
const SMALL_VIEW: Partial<RenderSettings> = { horizontalRadius: 2, verticalUp: 1, verticalDown: 1, shape: "cylinder" };
/** Standing on the ground of chunk y 1. */
const GROUND_POSITION = { x: 16, y: GROUND_LEVEL + 2, z: 16 };

function createPipeline(options: {
  generationWorkers?: number;
  lightingWorkers?: number;
  meshWorkers?: number;
  renderSettings?: Partial<RenderSettings>;
  savedEdits?: Map<number, Map<number, number>>;
} = {}) {
  const generation = new FakeGeneration(options.generationWorkers ?? 1);
  const lighting = new FakeLighting(options.lightingWorkers ?? 1);
  const meshing = new FakeMeshing(options.meshWorkers ?? 1);
  const meshReadyKeys: number[] = [];
  const unloadedKeys: number[] = [];
  let startAreaReadyCount = 0;
  const pipeline = new ChunkPipeline({
    renderSettings: options.renderSettings ?? SMALL_VIEW,
    generation,
    lighting,
    meshing,
    preferredGenerationWorker: (chunkX, chunkZ) => Math.abs(chunkX * 7 + chunkZ * 13),
    startAreaRadius: 1,
    events: {
      onMeshReady: (record) => meshReadyKeys.push(record.key),
      onChunkUnloaded: (record) => unloadedKeys.push(record.key),
      onStartAreaReady: () => startAreaReadyCount++,
      savedEditsFor: (chunkX, chunkY, chunkZ) => options.savedEdits?.get(packChunkKey(chunkX, chunkY, chunkZ)),
    },
  });
  return {
    pipeline,
    generation,
    lighting,
    meshing,
    meshReadyKeys,
    unloadedKeys,
    startAreaReady: () => startAreaReadyCount,
  };
}

const horizontalDistance = (chunkX: number, chunkZ: number) => Math.hypot(chunkX, chunkZ);

describe("ChunkPipeline streaming", () => {
  test("generates whole columns, nearest first, preferring the view direction among equals", async () => {
    const { pipeline, generation } = createPipeline();
    pipeline.update(GROUND_POSITION, FACING_POSITIVE_X);
    const order: [number, number][] = [];
    while (generation.calls.pending.length > 0) {
      const call = generation.calls.pending[0]!;
      order.push([call.request.chunkX, call.request.chunkZ]);
      call.release();
      await flushPromises();
    }
    expect(order.length).toBe(37);
    expect(order[0]).toEqual([0, 0]);
    const positionOf = (chunkX: number, chunkZ: number) =>
      order.findIndex(([orderX, orderZ]) => orderX === chunkX && orderZ === chunkZ);
    expect(positionOf(1, 0)).toBe(1);
    expect(positionOf(-1, 0)).toBeGreaterThan(positionOf(2, 0));
    const isNearestFirst = (columns: [number, number][]) =>
      columns.every(
        ([chunkX, chunkZ], index) =>
          index === 0 || horizontalDistance(chunkX, chunkZ) >= horizontalDistance(...columns[index - 1]!) - 1e-9,
      );
    expect(isNearestFirst(order.filter(([chunkX, chunkZ]) => chunkZ === 0 && chunkX > 0))).toBe(true);
    expect(isNearestFirst(order.filter(([chunkX, chunkZ]) => chunkZ === 0 && chunkX < 0))).toBe(true);
    expect(isNearestFirst(order.filter(([chunkX, chunkZ]) => chunkX === 0 && chunkZ > 0))).toBe(true);
    expect(generation.calls.history[0]!.chunkYs.slice().sort()).toEqual([-1, 0, 1, 2, 3]);
  });

  test("work for chunks that left the range is dropped before it reaches a worker, and late results are ignored", async () => {
    const { pipeline, generation, lighting, meshing, unloadedKeys } = createPipeline();
    pipeline.update(GROUND_POSITION, FACING_POSITIVE_X);
    expect(generation.calls.pending).toHaveLength(1);
    const inFlightNearSpawn = generation.calls.pending[0]!;

    const farAway = { x: GROUND_POSITION.x + 32 * 40, y: GROUND_POSITION.y, z: GROUND_POSITION.z };
    pipeline.update(farAway, FACING_POSITIVE_X);
    expect(unloadedKeys.length).toBeGreaterThan(0);
    inFlightNearSpawn.release();
    await settle(generation, lighting, meshing);

    const columnsGenerated = generation.calls.history.map((request) => request.chunkX);
    expect(columnsGenerated.filter((chunkX) => chunkX < 30)).toEqual([0]);
    expect(pipeline.store.get(0, 1, 0)).toBeUndefined();
    for (const request of lighting.calls.history) {
      for (const chunk of request.regionChunks) expect(chunk.chunkX).toBeGreaterThanOrEqual(37);
    }
    expect(pipeline.stats().loadedChunks).toBeGreaterThan(0);
  });

  test("a steady load meshes every drawn chunk exactly once, after its neighborhood is lit", async () => {
    const { pipeline, generation, lighting, meshing, meshReadyKeys, startAreaReady } = createPipeline({
      generationWorkers: 3,
      lightingWorkers: 2,
      meshWorkers: 2,
    });
    pipeline.update(GROUND_POSITION, FACING_POSITIVE_X);
    await settle(generation, lighting, meshing);

    for (const [, count] of meshing.buildCountByKey()) expect(count).toBe(1);
    expect(new Set(meshReadyKeys).size).toBe(meshReadyKeys.length);
    const drawnKeys: number[] = [];
    for (let chunkX = -2; chunkX <= 2; chunkX++) {
      for (let chunkZ = -2; chunkZ <= 2; chunkZ++) {
        if (chunkX * chunkX + chunkZ * chunkZ > 2.5 * 2.5) continue;
        for (let chunkY = 0; chunkY <= 2; chunkY++) drawnKeys.push(packChunkKey(chunkX, chunkY, chunkZ));
      }
    }
    expect(drawnKeys.every((key) => meshReadyKeys.includes(key))).toBe(true);
    const ringKey = packChunkKey(3, 1, 0);
    expect(pipeline.store.getByKey(ringKey)?.isLit).toBe(true);
    expect(meshReadyKeys).not.toContain(ringKey);
    expect(meshing.calls.history.map((request) => request.chunkY)).toEqual(new Array(drawnKeys.length / 3).fill(1));
    expect(startAreaReady()).toBe(1);
  });

  test("columns next to each other are never lit at the same time", async () => {
    const { pipeline, generation, lighting, meshing } = createPipeline({ generationWorkers: 4, lightingWorkers: 3 });
    pipeline.update(GROUND_POSITION, FACING_POSITIVE_X);
    await settle(generation, lighting, meshing);
    expect(lighting.inFlightColumnsAtEachStart.some((columns) => columns.length > 1)).toBe(true);
    for (const columns of lighting.inFlightColumnsAtEachStart) {
      const coordinates = columns.map((columnKey) => {
        const column = unpackColumnKey(columnKey, createColumnCoordinates());
        return [column.chunkX, column.chunkZ];
      });
      for (let first = 0; first < coordinates.length; first++) {
        for (let second = first + 1; second < coordinates.length; second++) {
          const [firstX, firstZ] = coordinates[first]!;
          const [secondX, secondZ] = coordinates[second]!;
          expect(Math.max(Math.abs(firstX - secondX), Math.abs(firstZ - secondZ))).toBeGreaterThan(1);
        }
      }
    }
  });

  test("unloading far chunks keeps the loaded set bounded, and coming back loads and draws them again", async () => {
    const { pipeline, generation, lighting, meshing, meshReadyKeys, unloadedKeys } = createPipeline();
    pipeline.update(GROUND_POSITION, FACING_POSITIVE_X);
    await settle(generation, lighting, meshing);
    const loadedAtSpawn = pipeline.stats().loadedChunks;

    for (let step = 1; step <= 12; step++) {
      pipeline.update({ ...GROUND_POSITION, x: GROUND_POSITION.x + step * 32 }, FACING_POSITIVE_X);
      await settle(generation, lighting, meshing);
      expect(pipeline.stats().loadedChunks).toBeLessThanOrEqual(loadedAtSpawn * 3);
    }
    expect(pipeline.store.get(0, 1, 0)).toBeUndefined();
    expect(unloadedKeys).toContain(packChunkKey(0, 1, 0));

    meshReadyKeys.length = 0;
    pipeline.update(GROUND_POSITION, FACING_POSITIVE_X);
    await settle(generation, lighting, meshing);
    expect(pipeline.store.get(0, 1, 0)?.isLit).toBe(true);
    expect(meshReadyKeys).toContain(packChunkKey(0, 1, 0));
    expect(pipeline.getBlock(5, GROUND_LEVEL - 1, 5)).toBe(BlockType.STONE);
    expect(pipeline.getBlock(5, GROUND_LEVEL, 5)).toBe(BlockType.AIR);
  });
});

describe("ChunkPipeline light and mesh updates", () => {
  test("light from a reloaded neighbor with a new lamp reaches a drawn chunk and rebuilds it exactly once", async () => {
    const savedEdits = new Map<number, Map<number, number>>();
    const { pipeline, generation, lighting, meshing } = createPipeline({ savedEdits });
    const tunnelY = GROUND_LEVEL - 8;
    generation.blockOverride = (x, y, z) => (y === tunnelY && z === 10 && x >= 20 && x <= 44 ? BlockType.AIR : undefined);
    pipeline.update(GROUND_POSITION, FACING_POSITIVE_X);
    await settle(generation, lighting, meshing);
    const drawnChunk = pipeline.store.get(0, 1, 0)!;
    expect(pipeline.getLight(31, tunnelY, 10)! & 0xf).toBe(0);
    const buildsBefore = meshing.buildsOf(0, 1, 0).length;

    pipeline.update({ ...GROUND_POSITION, x: GROUND_POSITION.x - 32 * 5 }, FACING_POSITIVE_X);
    await settle(generation, lighting, meshing);
    expect(pipeline.store.get(1, 1, 0)).toBeUndefined();
    expect(pipeline.store.get(0, 1, 0)).toBe(drawnChunk);
    savedEdits.set(packChunkKey(1, 1, 0), new Map([[cellIndexOf(34, tunnelY, 10), BlockType.GLOWSTONE]]));

    pipeline.update(GROUND_POSITION, FACING_POSITIVE_X);
    await settle(generation, lighting, meshing);
    expect(pipeline.getLight(31, tunnelY, 10)! & 0xf).toBe(12);
    expect(meshing.buildsOf(0, 1, 0).length - buildsBefore).toBe(1);
  });

  test("an edit rebuild jumps ahead of queued streaming meshes", async () => {
    const { pipeline, generation, lighting, meshing } = createPipeline({ meshWorkers: 1 });
    pipeline.update(GROUND_POSITION, FACING_POSITIVE_X);
    for (let round = 0; round < 200 && meshing.calls.pending.length === 0; round++) {
      generation.calls.releaseAll();
      lighting.calls.releaseAll();
      await flushPromises();
    }
    await settle(generation, lighting, new FakeMeshing(1));
    expect(meshing.calls.pending.length).toBe(2);
    expect(pipeline.stats().queuedMeshes).toBeGreaterThan(3);
    const editedChunk = pipeline.store.get(-1, 1, -1)!;
    const alreadyMeshing = meshing.calls.pending.some(
      ({ request }) => request.chunkX === -1 && request.chunkY === 1 && request.chunkZ === -1,
    );
    expect(alreadyMeshing).toBe(false);

    const edit = pipeline.applyBlockEdits([{ x: -20, y: GROUND_LEVEL, z: -20, block: BlockType.STONE }]);
    expect(edit.chunksToRemesh.map((chunk) => `${chunk.x},${chunk.y},${chunk.z}`)).toEqual(["-1,1,-1"]);
    meshing.calls.pending[0]!.release();
    await flushPromises();
    const nextRequest = meshing.calls.pending[meshing.calls.pending.length - 1]!.request;
    expect([nextRequest.chunkX, nextRequest.chunkY, nextRequest.chunkZ]).toEqual([-1, 1, -1]);
    expect(editedChunk.isMeshScheduled).toBe(false);
    expect(EDIT_MESH_PRIORITY).toBeLessThan(0);
  });

  test("a mesh built before an edit is dropped and the rebuild shows the edit", async () => {
    const { pipeline, generation, lighting, meshing, meshReadyKeys } = createPipeline();
    pipeline.update(GROUND_POSITION, FACING_POSITIVE_X);
    await settle(generation, lighting, meshing);
    const record = pipeline.store.get(0, 1, 0)!;
    const before = pipeline.applyBlockEdits([{ x: 15, y: GROUND_LEVEL, z: 16, block: BlockType.STONE }]);
    expect(meshing.calls.pending).toHaveLength(1);
    const staleBuild = meshing.calls.pending[0]!;

    const after = pipeline.applyBlockEdits([{ x: 16, y: GROUND_LEVEL, z: 16, block: BlockType.GLOWSTONE }]);
    meshReadyKeys.length = 0;
    staleBuild.release();
    await flushPromises();
    expect(meshReadyKeys).toEqual([]);
    expect(pipeline.meshCounters.staleDropped).toBe(1);

    await settle(generation, lighting, meshing);
    expect(meshReadyKeys).toEqual([record.key]);
    const rebuild = meshing.buildsOf(0, 1, 0).at(-1)!;
    expect(new Uint8Array(rebuild.blocks)[cellIndexOf(15, GROUND_LEVEL, 16)]).toBe(BlockType.STONE);
    expect(new Uint8Array(rebuild.blocks)[cellIndexOf(16, GROUND_LEVEL, 16)]).toBe(BlockType.GLOWSTONE);
    expect(new Uint8Array(rebuild.light)[cellIndexOf(17, GROUND_LEVEL, 16)]! & 0xf).toBe(14);
    await Promise.all([...before.meshesApplied, ...after.meshesApplied]);
  });

  test("light computed while an edit landed next to the region is thrown away and redone", async () => {
    const { pipeline, generation, lighting, meshing } = createPipeline();
    pipeline.update(GROUND_POSITION, FACING_POSITIVE_X);
    while (lighting.calls.pending.length === 0) {
      generation.calls.releaseAll();
      await flushPromises();
    }
    lighting.calls.releaseAll();
    await flushPromises();
    while (lighting.calls.pending.length === 0) {
      generation.calls.releaseAll();
      await flushPromises();
    }
    const pendingRegion = lighting.calls.pending[0]!.request.regionChunks[0]!;
    const regionColumn = packColumnKey(pendingRegion.chunkX, pendingRegion.chunkZ);
    expect(regionColumn).not.toBe(packColumnKey(0, 0));
    const litColumnCellX = 5;
    pipeline.applyBlockEdits([{ x: litColumnCellX, y: GROUND_LEVEL, z: 5, block: BlockType.GLOWSTONE }]);

    await settle(generation, lighting, meshing);
    const lightingsOfColumn = lighting.calls.history.filter(
      (request) => packColumnKey(request.regionChunks[0]!.chunkX, request.regionChunks[0]!.chunkZ) === regionColumn,
    );
    expect(lightingsOfColumn).toHaveLength(2);
    expect(pipeline.stats().regionLightingRetries).toBe(1);
  });

  test("an edit's meshesApplied resolve only once the rebuilt meshes are on screen", async () => {
    const { pipeline, generation, lighting, meshing, meshReadyKeys } = createPipeline();
    pipeline.update(GROUND_POSITION, FACING_POSITIVE_X);
    await settle(generation, lighting, meshing);
    meshReadyKeys.length = 0;
    const edit = pipeline.applyBlockEdits([{ x: 31, y: GROUND_LEVEL, z: 16, block: BlockType.GLOWSTONE }]);
    let settled = false;
    void Promise.all(edit.meshesApplied).then(() => (settled = true));
    await flushPromises();
    expect(settled).toBe(false);
    await settle(generation, lighting, meshing);
    expect(settled).toBe(true);
    expect(new Set(meshReadyKeys)).toEqual(new Set([packChunkKey(0, 1, 0), packChunkKey(1, 1, 0)]));
  });

  test("sky chunks above the surface are dropped, yet read as air", async () => {
    const { pipeline, generation, lighting, meshing } = createPipeline({
      renderSettings: { horizontalRadius: 2, verticalUp: 4, verticalDown: 1, shape: "cylinder" },
    });
    pipeline.update(GROUND_POSITION, FACING_POSITIVE_X);
    await settle(generation, lighting, meshing);
    const keptChunkYs = new Set<number>();
    pipeline.forEachChunk((record: ChunkRecord) => {
      if (Math.abs(record.chunkX) > 1 || Math.abs(record.chunkZ) > 1) keptChunkYs.add(record.chunkY);
    });
    expect(Math.max(...keptChunkYs)).toBe(3);
    expect(pipeline.stats().chunksSkippedAboveSurface).toBeGreaterThan(0);
    expect(pipeline.getBlock(2 * 32 + 5, 5 * 32, 5)).toBe(BlockType.AIR);
  });
});
