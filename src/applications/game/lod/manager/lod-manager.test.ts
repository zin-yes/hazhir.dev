import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { BlockType } from "../../blocks";
import { topColorOfBlock } from "../colors/block-color-table";
import { cellSizeOfLevel, tileSizeOfLevel } from "../core/lod-constants";
import { decodeLodVertex, LodFace } from "../meshing/lod-vertex-format";
import { createSyntheticChunk, isSyntheticTreeColumn } from "../testing/synthetic-chunks.test-helper";
import { syntheticBlocksAt, syntheticHeightAt } from "../testing/synthetic-terrain.test-helper";
import { createLodManager, type LodManager } from "./lod-manager";
import { createInProcessExecutor } from "./tile-build-executor";

const SEED = 77;
const RENDER_DISTANCE_CHUNKS = 8;

interface Harness {
  manager: LodManager;
  camera: THREE.PerspectiveCamera;
  advanceTime(milliseconds: number): void;
  settle(maximumUpdates?: number): Promise<number>;
}

function createHarness(memoryBudgetBytes?: number): Harness {
  let nowMilliseconds = 0;
  const manager = createLodManager({
    seed: SEED,
    executor: createInProcessExecutor(),
    renderDistanceChunks: RENDER_DISTANCE_CHUNKS,
    maximumBuildsInFlight: 4,
    fadeMilliseconds: 100,
    memoryBudgetBytes,
    now: () => nowMilliseconds,
  });
  const camera = new THREE.PerspectiveCamera(85, 16 / 9, 0.1, 10000);
  camera.position.set(100, 140, -60);
  camera.lookAt(100, 120, -400);
  const harness: Harness = {
    manager,
    camera,
    advanceTime(milliseconds) {
      nowMilliseconds += milliseconds;
    },
    async settle(maximumUpdates = 400) {
      for (let updateIndex = 0; updateIndex < maximumUpdates; updateIndex++) {
        manager.update(camera, 1080);
        const stats = manager.getStats();
        if (stats.missingTiles === 0 && stats.buildsInFlight === 0 && stats.queuedBuilds === 0 && stats.pendingRealColumns === 0) {
          for (let fadeStep = 0; fadeStep < 4; fadeStep++) {
            harness.advanceTime(50);
            manager.update(camera, 1080);
          }
          return updateIndex;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        harness.advanceTime(16);
      }
      throw new Error("LOD did not settle");
    },
  };
  return harness;
}

interface SceneTile {
  level: number;
  minX: number;
  minZ: number;
  size: number;
}

function sceneTiles(manager: LodManager): SceneTile[] {
  return manager.scene.children
    .filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)
    .map((mesh) => {
      const level = Math.log2(mesh.scale.x);
      return { level, minX: mesh.position.x + 0.5, minZ: mesh.position.z + 0.5, size: tileSizeOfLevel(level) };
    });
}

function tilesAt(tiles: SceneTile[], pointX: number, pointZ: number): SceneTile[] {
  return tiles.filter((tile) => pointX >= tile.minX && pointX < tile.minX + tile.size && pointZ >= tile.minZ && pointZ < tile.minZ + tile.size);
}

describe("LOD manager", () => {
  test("shows coarse roots first, then refines until every point in the radius is drawn by exactly one tile", async () => {
    const startedAt = performance.now();
    const harness = createHarness();
    const { manager, camera } = harness;
    let updatesUntilHorizon = 0;
    while (manager.getStats().firstHorizonMilliseconds === undefined && updatesUntilHorizon < 50) {
      manager.update(camera, 1080);
      await new Promise((resolve) => setTimeout(resolve, 0));
      updatesUntilHorizon++;
    }
    expect(manager.getStats().firstHorizonMilliseconds).toBeDefined();
    const buildsBeforeHorizon = manager.getStats().buildsByLevel;
    const rootBuilds = buildsBeforeHorizon[3]!.tiles;
    expect(rootBuilds).toBeGreaterThanOrEqual(4);
    expect(updatesUntilHorizon).toBeLessThanOrEqual(Math.ceil(rootBuilds / 4) + 2);

    const updates = await harness.settle();
    const stats = manager.getStats();
    console.log(
      `settled after ${updates} updates, ${stats.builtTiles} builds, ${stats.drawnTiles} tiles drawn, ${(performance.now() - startedAt).toFixed(0)} ms wall`,
    );
    expect(stats.fullDetailMilliseconds).toBeDefined();
    expect(stats.firstHorizonMilliseconds!).toBeLessThanOrEqual(stats.fullDetailMilliseconds!);
    const tiles = sceneTiles(manager);
    expect(tiles.length).toBe(stats.drawnTiles);
    expect(tiles.some((tile) => tile.level === 0)).toBe(true);
    const radius = RENDER_DISTANCE_CHUNKS * 32;
    let checkedPoints = 0;
    for (let offsetX = -radius + 3; offsetX < radius; offsetX += 13) {
      for (let offsetZ = -radius + 3; offsetZ < radius; offsetZ += 11) {
        if (Math.hypot(offsetX, offsetZ) > radius - 2) continue;
        expect(tilesAt(tiles, camera.position.x + offsetX, camera.position.z + offsetZ)).toHaveLength(1);
        checkedPoints++;
      }
    }
    expect(checkedPoints).toBeGreaterThan(1000);
    expect(stats.nearPlane).toBeLessThan(1);
    manager.dispose();
  });

  test("real chunks hide the LOD where they render, feed their surface into tiles, and give the area back on unload", async () => {
    const harness = createHarness();
    const { manager, camera } = harness;
    const playerChunkX = Math.floor(camera.position.x / 32);
    const playerChunkZ = Math.floor(camera.position.z / 32);
    for (let chunkX = playerChunkX - 2; chunkX <= playerChunkX + 2; chunkX++) {
      for (let chunkZ = playerChunkZ - 2; chunkZ <= playerChunkZ + 2; chunkZ++) {
        for (let chunkY = 1; chunkY <= 6; chunkY++) {
          manager.onRealChunkLoaded(chunkX, chunkY, chunkZ, createSyntheticChunk(chunkX, chunkY, chunkZ));
          manager.onRealChunkMeshed(chunkX, chunkY, chunkZ);
        }
      }
    }
    await harness.settle();
    let stats = manager.getStats();
    expect(stats.coveredColumns).toBe(25);
    expect(stats.realDataNodes).toBeGreaterThan(25);
    let tiles = sceneTiles(manager);
    const insideX = playerChunkX * 32 + 16;
    const insideZ = playerChunkZ * 32 + 16;
    for (const tile of tilesAt(tiles, insideX, insideZ)) expect(tile.level).toBeGreaterThan(0);
    expect(stats.nearPlane).toBeGreaterThan(10);

    manager.onRealChunkUnloaded(playerChunkX, 3, playerChunkZ);
    manager.onRealChunkUnloaded(playerChunkX, 4, playerChunkZ);
    await harness.settle();
    stats = manager.getStats();
    expect(stats.coveredColumns).toBe(24);
    tiles = sceneTiles(manager);
    expect(tilesAt(tiles, insideX, insideZ)).toHaveLength(1);
    expect(stats.nearPlane).toBeLessThan(1);
    manager.dispose();
  });

  test("tiles near the player carry the real surface, trees included", async () => {
    const harness = createHarness();
    const { manager, camera } = harness;
    const columnZ = Math.floor(camera.position.z / 32);
    const columnX = [1, 2, 3, -1, -2, -3]
      .map((offset) => Math.floor(camera.position.x / 32) + offset)
      .find((candidateX) => {
        let trees = 0;
        for (let localX = 0; localX < 32; localX++) {
          for (let localZ = 0; localZ < 32; localZ++) {
            const blockX = candidateX * 32 + localX;
            const blockZ = columnZ * 32 + localZ;
            const ground = syntheticHeightAt(blockX, blockZ);
            if (isSyntheticTreeColumn(blockX, blockZ) && syntheticBlocksAt(ground).top === BlockType.GRASS && ground >= 80) trees++;
          }
        }
        return trees >= 3;
      })!;
    expect(columnX).toBeDefined();
    for (let chunkY = 1; chunkY <= 7; chunkY++) manager.onRealChunkLoaded(columnX, chunkY, columnZ, createSyntheticChunk(columnX, chunkY, columnZ));
    await harness.settle();
    const levelZeroMesh = manager.scene.children.find(
      (child): child is THREE.Mesh =>
        child instanceof THREE.Mesh && child.scale.x === cellSizeOfLevel(0) && child.position.x === columnX * 32 - 0.5 && child.position.z === columnZ * 32 - 0.5,
    );
    expect(levelZeroMesh).toBeDefined();
    const words = levelZeroMesh!.geometry.getAttribute("packedVertex").array as Uint32Array;
    const leavesColor = topColorOfBlock(BlockType.LEAVES);
    let leafVertices = 0;
    for (let vertex = 0; vertex < words.length / 2; vertex++) {
      const decoded = decodeLodVertex(words[vertex * 2]!, words[vertex * 2 + 1]!);
      if (decoded.face === LodFace.Up && decoded.color === leavesColor) leafVertices++;
    }
    expect(leafVertices).toBeGreaterThanOrEqual(12);
    expect(manager.getStats().realDataNodes).toBeGreaterThanOrEqual(4);
    manager.dispose();
  });

  test("stays within its memory budget while the camera crosses the world", async () => {
    const budget = 6 * 1024 * 1024;
    const harness = createHarness(budget);
    const { manager, camera } = harness;
    await harness.settle();
    camera.position.x += 5000;
    camera.updateMatrixWorld();
    await harness.settle();
    const stats = manager.getStats();
    expect(stats.evictedTiles).toBeGreaterThan(0);
    expect(stats.cacheBytes).toBeLessThanOrEqual(budget);
    manager.dispose();
  });
});
