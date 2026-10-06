import { CHUNK_HEIGHT, CHUNK_WIDTH } from "./config";
import { profiler } from "./profiler";
import { createSurfaceHeightSampler } from "./worldgen/surface-height";
import { findSpawnPoint, type SpawnPoint } from "./worldgen/spawn-point";

export function getSurfaceHeightFromSeed(
  seed: number,
  x: number,
  z: number
): number {
  const scopeToken = profiler.begin("main.worldgen.surfaceHeightFromSeed");
  try {
    const createToken = profiler.begin("main.worldgen.surfaceHeightFromSeed.createSampler");
    const sampler = createSurfaceHeightSampler(seed);
    profiler.end(createToken);
    profiler.addCounter("game.worldgen.surfaceHeightSamplersCreated");
    return sampler(x, z);
  } finally {
    profiler.end(scopeToken);
  }
}

const spawnPointBySeed = new Map<number, SpawnPoint>();

export function getSpawnPointFromSeed(seed: number): SpawnPoint {
  let spawnPoint = spawnPointBySeed.get(seed);
  if (spawnPoint) {
    profiler.addCounter("game.worldgen.spawnPointCacheHits");
    return spawnPoint;
  }
  profiler.addCounter("game.worldgen.spawnPointCacheMisses");
  const searchToken = profiler.begin("main.worldgen.findSpawnPoint");
  try {
    spawnPoint = findSpawnPoint(seed);
  } finally {
    profiler.end(searchToken);
  }
  spawnPointBySeed.set(seed, spawnPoint);
  profiler.sampleGauge("game.worldgen.spawnPointsCached", spawnPointBySeed.size);
  return spawnPoint;
}

export function calculateOffset(x: number, y: number, z: number) {
  return (
    Math.abs(x) * CHUNK_WIDTH * CHUNK_HEIGHT +
    Math.abs(y) * CHUNK_HEIGHT +
    Math.abs(z)
  );
}
