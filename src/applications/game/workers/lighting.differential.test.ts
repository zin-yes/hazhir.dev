import { describe, expect, test } from "bun:test";
import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "@/applications/game/config";
import { mergeLightUpdatesInPlace } from "../edits/merge-light";
import {
  LightTestWorld,
  chunkName,
  floodLightFromScratch,
} from "../edits/light-test-world.test-helper";
import { findSpawnPoint } from "../worldgen/spawn-point";
import { generateChunkBlocks } from "../worldgen/chunk-generator";
import { initializeChunkLight, propagateChunkLight } from "./lighting";

const TERRAIN_SEED = 2024;
const BLOCKS = CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH;

const NEIGHBOR_OFFSETS: { key: string; dx: number; dy: number; dz: number }[] = [
  { key: "1,0,0", dx: 1, dy: 0, dz: 0 },
  { key: "-1,0,0", dx: -1, dy: 0, dz: 0 },
  { key: "0,1,0", dx: 0, dy: 1, dz: 0 },
  { key: "0,-1,0", dx: 0, dy: -1, dz: 0 },
  { key: "0,0,1", dx: 0, dy: 0, dz: 1 },
  { key: "0,0,-1", dx: 0, dy: 0, dz: -1 },
];

const generatedChunks = new Map<string, Uint8Array>();
function terrainChunk(chunkX: number, chunkY: number, chunkZ: number): Uint8Array {
  const name = chunkName(chunkX, chunkY, chunkZ);
  let blocks = generatedChunks.get(name);
  if (!blocks) {
    blocks = generateChunkBlocks(TERRAIN_SEED, chunkX, chunkY, chunkZ);
    generatedChunks.set(name, blocks);
  }
  return blocks;
}

/**
 * Lights the chunks the way the game's load pass does: each column top-down
 * with the chunk above as input, then every chunk spread into and out of its
 * face neighbors, and all updates merged per chunk.
 */
function lightLikeTheGame(world: LightTestWorld): Map<string, Uint8Array> {
  const names = Array.from(world.blocks.keys());
  const coordinates = names.map((name) => name.split(",").map(Number) as [number, number, number]);
  const lights = new Map<string, Uint8Array>();
  const queues = new Map<string, Uint32Array>();

  const topDown = [...coordinates].sort((first, second) => second[1] - first[1]);
  for (const [chunkX, chunkY, chunkZ] of topDown) {
    const topName = chunkName(chunkX, chunkY + 1, chunkZ);
    const { light, queue } = initializeChunkLight(
      world.blocks.get(chunkName(chunkX, chunkY, chunkZ))!,
      TERRAIN_SEED,
      chunkX,
      chunkY,
      chunkZ,
      world.blocks.get(topName),
      lights.get(topName),
    );
    lights.set(chunkName(chunkX, chunkY, chunkZ), light);
    queues.set(chunkName(chunkX, chunkY, chunkZ), queue);
  }

  const updates = new Map<string, Uint8Array[]>();
  for (const [chunkX, chunkY, chunkZ] of coordinates) {
    const name = chunkName(chunkX, chunkY, chunkZ);
    const neighborBlocks: { [key: string]: Uint8Array } = {};
    const neighborLights: { [key: string]: Uint8Array } = {};
    for (const { key, dx, dy, dz } of NEIGHBOR_OFFSETS) {
      const neighborName = chunkName(chunkX + dx, chunkY + dy, chunkZ + dz);
      if (!world.blocks.has(neighborName)) continue;
      neighborBlocks[key] = world.blocks.get(neighborName)!.slice();
      neighborLights[key] = lights.get(neighborName)!.slice();
    }
    const { centerLight, neighborLightUpdates } = propagateChunkLight(
      world.blocks.get(name)!,
      lights.get(name)!.slice(),
      neighborBlocks,
      neighborLights,
      queues.get(name)!,
    );
    updates.set(name, [...(updates.get(name) ?? []), centerLight]);
    for (const { key, dx, dy, dz } of NEIGHBOR_OFFSETS) {
      const update = neighborLightUpdates[key];
      if (!update) continue;
      const neighborName = chunkName(chunkX + dx, chunkY + dy, chunkZ + dz);
      updates.set(neighborName, [...(updates.get(neighborName) ?? []), update]);
    }
  }

  const merged = new Map<string, Uint8Array>();
  for (const [name, chunkUpdates] of updates) {
    merged.set(name, mergeLightUpdatesInPlace(chunkUpdates[0], chunkUpdates.slice(1)));
  }
  return merged;
}

/** A chunk with its six face neighbors, loaded as real generated terrain. */
function terrainNeighborhood(centerX: number, centerY: number, centerZ: number): LightTestWorld {
  const world = new LightTestWorld();
  const coordinates = [
    [centerX, centerY, centerZ],
    ...NEIGHBOR_OFFSETS.map(({ dx, dy, dz }) => [centerX + dx, centerY + dy, centerZ + dz]),
  ];
  for (const [chunkX, chunkY, chunkZ] of coordinates) {
    world.blocks.set(chunkName(chunkX, chunkY, chunkZ), terrainChunk(chunkX, chunkY, chunkZ).slice());
  }
  return world;
}

function countCellsDifferent(first: Uint8Array, second: Uint8Array): number {
  let different = 0;
  for (let index = 0; index < first.length; index++) {
    if (first[index] !== second[index]) different++;
  }
  return different;
}

describe("game lighting against a naive global flood on generated terrain", () => {
  const spawn = findSpawnPoint(TERRAIN_SEED);
  const spawnChunkX = Math.floor(spawn.x / CHUNK_WIDTH);
  const spawnChunkZ = Math.floor(spawn.z / CHUNK_LENGTH);
  const surfaceChunkY = Math.floor(spawn.y / CHUNK_HEIGHT);

  test(
    "the chunk at the surface matches exactly, with sky, shade and carved caves present",
    { timeout: 120000 },
    () => {
      const world = terrainNeighborhood(spawnChunkX, surfaceChunkY, spawnChunkZ);
      const centerName = chunkName(spawnChunkX, surfaceChunkY, spawnChunkZ);
      const center = world.blocks.get(centerName)!;
      const solidCells = center.filter((block) => block !== 0).length;
      expect(solidCells).toBeGreaterThan(BLOCKS * 0.2);
      expect(solidCells).toBeLessThan(BLOCKS * 0.95);

      const pipelineLight = lightLikeTheGame(world).get(centerName)!;
      const exactLight = floodLightFromScratch(world).get(centerName)!;

      const litCells = exactLight.filter((value) => value >> 4 === 15).length;
      const dimCells = exactLight.filter((value) => (value >> 4) > 0 && (value >> 4) < 15).length;
      expect(litCells).toBeGreaterThan(1000);
      expect(dimCells).toBeGreaterThan(100);
      expect(countCellsDifferent(pipelineLight, exactLight)).toBe(0);
    },
  );

  test(
    "the chunk next to it matches exactly, so the result is not a one-chunk accident",
    { timeout: 120000 },
    () => {
      const world = terrainNeighborhood(spawnChunkX + 1, surfaceChunkY, spawnChunkZ);
      const centerName = chunkName(spawnChunkX + 1, surfaceChunkY, spawnChunkZ);
      const pipelineLight = lightLikeTheGame(world).get(centerName)!;
      const exactLight = floodLightFromScratch(world).get(centerName)!;
      expect(exactLight.filter((value) => value >> 4 === 15).length).toBeGreaterThan(1000);
      expect(countCellsDifferent(pipelineLight, exactLight)).toBe(0);
    },
  );
});
