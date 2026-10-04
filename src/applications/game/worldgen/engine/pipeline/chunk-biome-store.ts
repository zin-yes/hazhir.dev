// Mirrors NoiseBasedChunkGenerator.doCreateBiomes + ChunkAccess.fillBiomesFromNoise: each chunk samples the six
// climate functions through its own NoiseChunk caches (NoiseChunk.cachedClimateSampler, so flat_cache values are
// taken at y = 0 on the quart grid) at the quart cells of its section grid, and the biome source picks the biome.
// A chunk is filled eagerly in LevelChunkSection.fillBiomesFromNoise order (sections bottom-up, x, y, z), because the
// biome source's last-leaf hint makes exact climate ties depend on query order, and vanilla's stored biomes reflect it.
// Chunks are kept in a bounded LRU.

import {
  addWorkerCounter,
  endWorkerSection,
  isWorkerProfiling,
  startWorkerSection,
} from "@/applications/game/profiler/worker-recorder";
import { type NoiseRouter, quantizeClimateCoordinate } from "../density";
import type { TargetPoint } from "../density";
import { createColumnMemoizedDensity } from "../density/column-memoization";
import { compileDensityFunction, type CompiledDensityFunction } from "../density/density-codegen";
import { NoiseChunk } from "../terrain";
import { isCornerSamplingExact } from "../terrain/corner-column-sampler";
import type { MultiNoiseBiomeSource } from "../biome-source";
import { BoundedLruCache, packChunkColumnKey } from "./bounded-lru-cache";

const QUARTS_PER_CHUNK_SIDE = 4;

const CLIMATE_FIELDS = ["temperature", "vegetation", "continents", "erosion", "depth", "ridges"] as const;
/**
 * Vanilla's last-leaf hint carries over from whatever chunk the worker thread sampled before, which is unknowable.
 * A far-away unique-minimum query before each chunk makes the hint (and so every tie) independent of chunk order.
 */
const PRIMING_TARGET: TargetPoint = { temperature: 90000, humidity: 90000, continentalness: 90000, erosion: 90000, depth: 90000, weirdness: 90000 };

class ChunkBiomeGrid {
  private readonly biomeIndices: Uint16Array;
  private distinctIndices: number[] | undefined;

  constructor(
    private readonly chunkX: number,
    private readonly chunkZ: number,
    private readonly quartYCount: number,
    private readonly minQuartY: number,
    private readonly biomeSource: MultiNoiseBiomeSource,
    private readonly internBiome: (biomeId: string) => number,
  ) {
    this.biomeIndices = new Uint16Array(QUARTS_PER_CHUNK_SIDE * QUARTS_PER_CHUNK_SIDE * quartYCount);
  }

  /**
   * Mirrors ChunkAccess.fillBiomesFromNoise. Cell layout: (quartY * 4 + localQuartZ) * 4 + localQuartX. The climate
   * values come from `climate` (sampled ahead, column by column); the biome searches run in the vanilla order, which
   * the last-leaf hint depends on.
   */
  fill(climate: ChunkClimateSamples): void {
    const isProfiling = isWorkerProfiling();
    this.biomeSource.findBiome(PRIMING_TARGET);
    if (isProfiling) this.biomeSource.drainSearchStatistics();
    for (let sectionIndex = 0; sectionIndex < this.quartYCount / 4; sectionIndex++) {
      for (let quartXInSection = 0; quartXInSection < 4; quartXInSection++) {
        for (let quartYInSection = 0; quartYInSection < 4; quartYInSection++) {
          for (let quartZInSection = 0; quartZInSection < 4; quartZInSection++) {
            const quartYOffset = sectionIndex * 4 + quartYInSection;
            const sampleIndex = climate.indexOf(quartXInSection, quartYOffset, quartZInSection);
            const cellIndex = (quartYOffset * QUARTS_PER_CHUNK_SIDE + quartZInSection) * QUARTS_PER_CHUNK_SIDE + quartXInSection;
            const biomeId = this.biomeSource.findBiomeForClimate(
              climate.temperature[sampleIndex]!,
              climate.humidity[sampleIndex]!,
              climate.continentalness[sampleIndex]!,
              climate.erosion[sampleIndex]!,
              climate.depth[sampleIndex]!,
              climate.weirdness[sampleIndex]!,
            );
            this.biomeIndices[cellIndex] = this.internBiome(biomeId);
          }
        }
      }
    }
    if (isProfiling) {
      const { searches, nodeDistanceEvaluations } = this.biomeSource.drainSearchStatistics();
      addWorkerCounter("biomeQuartCellsSampled", this.biomeIndices.length);
      addWorkerCounter("biomeRTreeSearches", searches);
      addWorkerCounter("biomeRTreeNodeVisits", nodeDistanceEvaluations);
    }
  }

  /** The distinct biomes the grid holds (computed once). */
  distinctBiomeIndices(): readonly number[] {
    if (this.distinctIndices === undefined) this.distinctIndices = [...new Set(this.biomeIndices)];
    return this.distinctIndices;
  }

  biomeIndexAt(quartX: number, clampedQuartY: number, quartZ: number): number {
    const localQuartX = quartX - this.chunkX * QUARTS_PER_CHUNK_SIDE;
    const localQuartZ = quartZ - this.chunkZ * QUARTS_PER_CHUNK_SIDE;
    return this.biomeIndices[((clampedQuartY - this.minQuartY) * QUARTS_PER_CHUNK_SIDE + localQuartZ) * QUARTS_PER_CHUNK_SIDE + localQuartX]!;
  }
}

type ClimateFieldName = (typeof CLIMATE_FIELDS)[number];

/**
 * Quantized climate values of a chunk's quart cells, sampled one quart column at a time (so the y-independent parts
 * of each function are computed once per column). Each value is what the chunk's NoiseChunk-cached climate sampler
 * gives at that quart position: the caches only hold y-independent functions sampled at quart-aligned positions.
 */
class ChunkClimateSamples {
  readonly temperature: Float64Array;
  readonly humidity: Float64Array;
  readonly continentalness: Float64Array;
  readonly erosion: Float64Array;
  readonly depth: Float64Array;
  readonly weirdness: Float64Array;
  private readonly evaluators: Record<ClimateFieldName, CompiledDensityFunction>;

  constructor(
    router: NoiseRouter,
    private readonly minQuartY: number,
    private readonly quartYCount: number,
  ) {
    const sampleCount = QUARTS_PER_CHUNK_SIDE * QUARTS_PER_CHUNK_SIDE * quartYCount;
    this.temperature = new Float64Array(sampleCount);
    this.humidity = new Float64Array(sampleCount);
    this.continentalness = new Float64Array(sampleCount);
    this.erosion = new Float64Array(sampleCount);
    this.depth = new Float64Array(sampleCount);
    this.weirdness = new Float64Array(sampleCount);
    const compile = (field: ClimateFieldName) => compileDensityFunction(createColumnMemoizedDensity(router[field]));
    this.evaluators = {
      temperature: compile("temperature"),
      vegetation: compile("vegetation"),
      continents: compile("continents"),
      erosion: compile("erosion"),
      depth: compile("depth"),
      ridges: compile("ridges"),
    };
  }

  /** True when every cache in the climate functions returns the plain function's value at quart positions. */
  static isExactFor(router: NoiseRouter): boolean {
    return CLIMATE_FIELDS.every((field) => isCornerSamplingExact(router[field]));
  }

  indexOf(localQuartX: number, quartYOffset: number, localQuartZ: number): number {
    return (localQuartX * QUARTS_PER_CHUNK_SIDE + localQuartZ) * this.quartYCount + quartYOffset;
  }

  sampleChunk(chunkX: number, chunkZ: number): void {
    const { temperature, vegetation, continents, erosion, depth, ridges } = this.evaluators;
    for (let localQuartX = 0; localQuartX < QUARTS_PER_CHUNK_SIDE; localQuartX++) {
      for (let localQuartZ = 0; localQuartZ < QUARTS_PER_CHUNK_SIDE; localQuartZ++) {
        const blockX = (chunkX * QUARTS_PER_CHUNK_SIDE + localQuartX) << 2;
        const blockZ = (chunkZ * QUARTS_PER_CHUNK_SIDE + localQuartZ) << 2;
        for (let quartYOffset = 0; quartYOffset < this.quartYCount; quartYOffset++) {
          const blockY = (this.minQuartY + quartYOffset) << 2;
          const index = this.indexOf(localQuartX, quartYOffset, localQuartZ);
          this.temperature[index] = quantizeClimateCoordinate(temperature(blockX, blockY, blockZ));
          this.humidity[index] = quantizeClimateCoordinate(vegetation(blockX, blockY, blockZ));
          this.continentalness[index] = quantizeClimateCoordinate(continents(blockX, blockY, blockZ));
          this.erosion[index] = quantizeClimateCoordinate(erosion(blockX, blockY, blockZ));
          this.depth[index] = quantizeClimateCoordinate(depth(blockX, blockY, blockZ));
          this.weirdness[index] = quantizeClimateCoordinate(ridges(blockX, blockY, blockZ));
        }
      }
    }
  }
}

/** The vanilla path: climate sampled through the chunk's NoiseChunk caches (used when ChunkClimateSamples is not exact). */
function sampleClimateThroughNoiseChunk(samples: ChunkClimateSamples, router: NoiseRouter, chunkX: number, chunkZ: number, minY: number, height: number, minQuartY: number, quartYCount: number): void {
  const noiseChunk = new NoiseChunk(router, {
    cellCountXZ: 4,
    firstBlockX: chunkX * 16,
    firstBlockZ: chunkZ * 16,
    minY,
    height,
    wiredRouterFields: CLIMATE_FIELDS,
  });
  const wired = noiseChunk.router;
  const context = { blockX: 0, blockY: 0, blockZ: 0 };
  for (let localQuartX = 0; localQuartX < QUARTS_PER_CHUNK_SIDE; localQuartX++) {
    for (let localQuartZ = 0; localQuartZ < QUARTS_PER_CHUNK_SIDE; localQuartZ++) {
      for (let quartYOffset = 0; quartYOffset < quartYCount; quartYOffset++) {
        context.blockX = (chunkX * QUARTS_PER_CHUNK_SIDE + localQuartX) << 2;
        context.blockY = (minQuartY + quartYOffset) << 2;
        context.blockZ = (chunkZ * QUARTS_PER_CHUNK_SIDE + localQuartZ) << 2;
        const index = samples.indexOf(localQuartX, quartYOffset, localQuartZ);
        samples.temperature[index] = quantizeClimateCoordinate(wired.temperature!.compute(context));
        samples.humidity[index] = quantizeClimateCoordinate(wired.vegetation!.compute(context));
        samples.continentalness[index] = quantizeClimateCoordinate(wired.continents!.compute(context));
        samples.erosion[index] = quantizeClimateCoordinate(wired.erosion!.compute(context));
        samples.depth[index] = quantizeClimateCoordinate(wired.depth!.compute(context));
        samples.weirdness[index] = quantizeClimateCoordinate(wired.ridges!.compute(context));
      }
    }
  }
}

export interface ChunkBiomeStoreParams {
  router: NoiseRouter;
  biomeSource: MultiNoiseBiomeSource;
  minY: number;
  height: number;
  maxCachedChunks: number;
}

export class ChunkBiomeStore {
  private readonly grids: BoundedLruCache<number, ChunkBiomeGrid>;
  private readonly biomeIds: string[] = [];
  private readonly indicesByBiomeId = new Map<string, number>();
  private readonly minQuartY: number;
  private readonly quartYCount: number;
  private climateSamples: ChunkClimateSamples | undefined;
  private climateSamplesAreExact: boolean | undefined;
  private lastGridChunkX = Number.NaN;
  private lastGridChunkZ = Number.NaN;
  private lastGrid: ChunkBiomeGrid | undefined;
  private gridLookups = 0;
  private gridMisses = 0;

  constructor(private readonly params: ChunkBiomeStoreParams) {
    this.grids = new BoundedLruCache(params.maxCachedChunks);
    this.minQuartY = params.minY >> 2;
    this.quartYCount = params.height >> 2;
  }

  private internBiome = (biomeId: string): number => {
    let index = this.indicesByBiomeId.get(biomeId);
    if (index === undefined) {
      index = this.biomeIds.length;
      this.biomeIds.push(biomeId);
      this.indicesByBiomeId.set(biomeId, index);
    }
    return index;
  };

  /** Moves the grid lookup and miss counts accumulated since the last call into the worker profile. */
  drainProfileCounters(): void {
    if (!isWorkerProfiling()) return;
    addWorkerCounter("biomeGridLookups", this.gridLookups);
    addWorkerCounter("biomeGridCacheMisses", this.gridMisses);
    addWorkerCounter("biomeGridCacheHits", this.gridLookups - this.gridMisses);
    this.gridLookups = 0;
    this.gridMisses = 0;
  }

  private createFilledGrid(chunkX: number, chunkZ: number): ChunkBiomeGrid {
    const isProfiling = isWorkerProfiling();
    if (isProfiling) startWorkerSection("biome.fillGrid");
    try {
      const grid = new ChunkBiomeGrid(chunkX, chunkZ, this.quartYCount, this.minQuartY, this.params.biomeSource, this.internBiome);
      const climate = (this.climateSamples ??= new ChunkClimateSamples(this.params.router, this.minQuartY, this.quartYCount));
      this.climateSamplesAreExact ??= ChunkClimateSamples.isExactFor(this.params.router);
      if (isProfiling) startWorkerSection("biome.sampleClimate");
      if (this.climateSamplesAreExact) climate.sampleChunk(chunkX, chunkZ);
      else sampleClimateThroughNoiseChunk(climate, this.params.router, chunkX, chunkZ, this.params.minY, this.params.height, this.minQuartY, this.quartYCount);
      if (isProfiling) endWorkerSection();
      grid.fill(climate);
      return grid;
    } finally {
      if (isProfiling) endWorkerSection();
    }
  }

  private gridAt(chunkX: number, chunkZ: number): ChunkBiomeGrid {
    if (chunkX === this.lastGridChunkX && chunkZ === this.lastGridChunkZ) return this.lastGrid!;
    const key = packChunkColumnKey(chunkX, chunkZ);
    let grid = this.grids.get(key);
    if (grid === undefined) {
      this.gridMisses++;
      grid = this.createFilledGrid(chunkX, chunkZ);
      this.grids.set(key, grid);
    }
    return grid;
  }

  /** ChunkAccess biomes of a chunk: every biome its quart cells hold (the set FeatureSorter and decoration read). */
  chunkBiomes(chunkX: number, chunkZ: number): string[] {
    return this.gridAt(chunkX, chunkZ).distinctBiomeIndices().map((index) => this.biomeIds[index]!);
  }

  /** Whether the chunk holding this quart column already has its biome grid (no climate sampling needed). */
  hasQuartColumn(quartX: number, quartZ: number): boolean {
    const chunkX = quartX >> 2;
    const chunkZ = quartZ >> 2;
    if (chunkX === this.lastGridChunkX && chunkZ === this.lastGridChunkZ) return true;
    return this.grids.has(packChunkColumnKey(chunkX, chunkZ));
  }

  /** ChunkAccess.getNoiseBiome: y is clamped into the chunk's section range, x and z select the chunk. */
  rawBiomeAtQuart(quartX: number, quartY: number, quartZ: number): string {
    const chunkX = quartX >> 2;
    const chunkZ = quartZ >> 2;
    this.gridLookups++;
    let grid: ChunkBiomeGrid | undefined;
    if (chunkX === this.lastGridChunkX && chunkZ === this.lastGridChunkZ) {
      grid = this.lastGrid!;
    } else {
      const key = packChunkColumnKey(chunkX, chunkZ);
      grid = this.grids.get(key);
      if (grid === undefined) {
        this.gridMisses++;
        grid = this.createFilledGrid(chunkX, chunkZ);
        this.grids.set(key, grid);
      }
      this.lastGridChunkX = chunkX;
      this.lastGridChunkZ = chunkZ;
      this.lastGrid = grid;
    }
    const clampedQuartY = Math.min(Math.max(quartY, this.minQuartY), this.minQuartY + this.quartYCount - 1);
    return this.biomeIds[grid.biomeIndexAt(quartX, clampedQuartY, quartZ)]!;
  }
}
