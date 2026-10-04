import { CHUNK_HEIGHT, CHUNK_WIDTH } from "./config";
import { createSurfaceHeightSampler } from "./worldgen/surface-height";
import { findSpawnPoint, type SpawnPoint } from "./worldgen/spawn-point";

export function getSurfaceHeightFromSeed(
  seed: number,
  x: number,
  z: number
): number {
  return createSurfaceHeightSampler(seed)(x, z);
}

const spawnPointBySeed = new Map<number, SpawnPoint>();

export function getSpawnPointFromSeed(seed: number): SpawnPoint {
  let spawnPoint = spawnPointBySeed.get(seed);
  if (!spawnPoint) {
    spawnPoint = findSpawnPoint(seed);
    spawnPointBySeed.set(seed, spawnPoint);
  }
  return spawnPoint;
}

export function calculateOffset(x: number, y: number, z: number) {
  return (
    Math.abs(x) * CHUNK_WIDTH * CHUNK_HEIGHT +
    Math.abs(y) * CHUNK_HEIGHT +
    Math.abs(z)
  );
}
