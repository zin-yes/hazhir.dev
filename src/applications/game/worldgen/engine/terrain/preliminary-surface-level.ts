// Mirrors NoiseChunk.preliminarySurfaceLevel: the first y (scanning cells from the top) where the initial density
// without jaggedness exceeds 0.390625, on the quart-aligned column. Java keeps the cache per NoiseChunk; the value
// only depends on the router and the column, so one cache per router serves every chunk (aquifers read columns up
// to three chunks away).

import {
  addWorkerCounter,
  endWorkerSection,
  isWorkerProfiling,
  startWorkerSection,
} from "@/applications/game/profiler/worker-recorder";
import type { NoiseRouter } from "../density/router-wiring";

const INITIAL_DENSITY_SURFACE_THRESHOLD = 0.390625;
const MAX_CACHED_COLUMNS = 400_000;
const NO_SURFACE_LEVEL = 2147483647;
const QUART_COLUMN_KEY_STRIDE = 67108864;

export class PreliminarySurfaceLevelCache {
  private readonly levelsByColumn = new Map<number, number>();

  constructor(
    private readonly router: NoiseRouter,
    private readonly minY: number,
    private readonly height: number,
    private readonly cellHeight: number,
  ) {}

  get(blockX: number, blockZ: number): number {
    const quartX = blockX >> 2;
    const quartZ = blockZ >> 2;
    const key = quartX * QUART_COLUMN_KEY_STRIDE + quartZ;
    const cached = this.levelsByColumn.get(key);
    const isProfiling = isWorkerProfiling();
    if (cached !== undefined) {
      if (isProfiling) addWorkerCounter("preliminarySurfaceCacheHits", 1);
      return cached;
    }
    const alignedX = quartX << 2;
    const alignedZ = quartZ << 2;
    let level = NO_SURFACE_LEVEL;
    let densityProbes = 0;
    if (isProfiling) startWorkerSection("terrain.preliminarySurfaceLevel");
    for (let blockY = this.minY + this.height; blockY >= this.minY; blockY -= this.cellHeight) {
      densityProbes++;
      if (this.router.initialDensityWithoutJaggedness.compute({ blockX: alignedX, blockY, blockZ: alignedZ }) > INITIAL_DENSITY_SURFACE_THRESHOLD) {
        level = blockY;
        break;
      }
    }
    if (isProfiling) {
      endWorkerSection();
      addWorkerCounter("preliminarySurfaceCacheMisses", 1);
      addWorkerCounter("preliminarySurfaceDensityProbes", densityProbes);
    }
    if (this.levelsByColumn.size >= MAX_CACHED_COLUMNS) this.levelsByColumn.clear();
    this.levelsByColumn.set(key, level);
    return level;
  }
}

const cachesByRouter = new WeakMap<NoiseRouter, PreliminarySurfaceLevelCache>();

export function getPreliminarySurfaceLevelCache(router: NoiseRouter, minY: number, height: number, cellHeight: number): PreliminarySurfaceLevelCache {
  let cache = cachesByRouter.get(router);
  if (cache === undefined) {
    cache = new PreliminarySurfaceLevelCache(router, minY, height, cellHeight);
    cachesByRouter.set(router, cache);
  }
  return cache;
}
