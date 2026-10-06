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
import { createColumnMemoizedDensity } from "../density/column-memoization";
import { compileDensityFunction, type CompiledDensityFunction, noteCompiledDensityEvaluations } from "../density/density-codegen";
import type { NoiseRouter } from "../density/router-wiring";

const INITIAL_DENSITY_SURFACE_THRESHOLD = 0.390625;
const SLOT_BITS = 16;
const SLOT_COUNT = 1 << SLOT_BITS;
const SLOT_MASK = SLOT_COUNT - 1;
const NO_SURFACE_LEVEL = 2147483647;

export class PreliminarySurfaceLevelCache {
  // Direct-mapped cache of quart columns (a colliding column simply replaces the previous one).
  private readonly slotIsFilled = new Uint8Array(SLOT_COUNT);
  private readonly slotQuartX = new Int32Array(SLOT_COUNT);
  private readonly slotQuartZ = new Int32Array(SLOT_COUNT);
  private readonly slotLevel = new Int32Array(SLOT_COUNT);
  private readonly evaluateInitialDensity: CompiledDensityFunction;

  constructor(
    router: NoiseRouter,
    private readonly minY: number,
    private readonly height: number,
    private readonly cellHeight: number,
  ) {
    this.evaluateInitialDensity = compileDensityFunction(createColumnMemoizedDensity(router.initialDensityWithoutJaggedness));
  }

  get(blockX: number, blockZ: number): number {
    const quartX = blockX >> 2;
    const quartZ = blockZ >> 2;
    const slot = (Math.imul(quartX, 73856093) ^ Math.imul(quartZ, 19349663)) & SLOT_MASK;
    const isProfiling = isWorkerProfiling();
    if (this.slotIsFilled[slot] === 1 && this.slotQuartX[slot] === quartX && this.slotQuartZ[slot] === quartZ) {
      if (isProfiling) addWorkerCounter("preliminarySurfaceCacheHits", 1);
      return this.slotLevel[slot]!;
    }
    const alignedX = quartX << 2;
    const alignedZ = quartZ << 2;
    let level = NO_SURFACE_LEVEL;
    let densityProbes = 0;
    if (isProfiling) startWorkerSection("terrain.preliminarySurfaceLevel");
    const evaluateInitialDensity = this.evaluateInitialDensity;
    for (let blockY = this.minY + this.height; blockY >= this.minY; blockY -= this.cellHeight) {
      densityProbes++;
      if (evaluateInitialDensity(alignedX, blockY, alignedZ) > INITIAL_DENSITY_SURFACE_THRESHOLD) {
        level = blockY;
        break;
      }
    }
    if (isProfiling) {
      endWorkerSection();
      addWorkerCounter("preliminarySurfaceCacheMisses", 1);
      addWorkerCounter("preliminarySurfaceDensityProbes", densityProbes);
      addWorkerCounter("preliminarySurfaceLevelsFound", level === NO_SURFACE_LEVEL ? 0 : 1);
      noteCompiledDensityEvaluations(evaluateInitialDensity, densityProbes, 1);
    }
    this.slotIsFilled[slot] = 1;
    this.slotQuartX[slot] = quartX;
    this.slotQuartZ[slot] = quartZ;
    this.slotLevel[slot] = level;
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
