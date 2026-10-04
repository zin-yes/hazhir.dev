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
  startWorkerSampledSection,
  startWorkerSection,
} from "@/applications/game/profiler/worker-recorder";
import { type NoiseRouter, quantizeClimateCoordinate } from "../density";
import type { TargetPoint } from "../density";
import { NoiseChunk } from "../terrain";
import type { MultiNoiseBiomeSource } from "../biome-source";
import { BoundedLruCache, packChunkColumnKey } from "./bounded-lru-cache";

const QUARTS_PER_CHUNK_SIDE = 4;

const CLIMATE_FIELDS = ["temperature", "vegetation", "continents", "erosion", "depth", "ridges"] as const;
/**
 * Vanilla's last-leaf hint carries over from whatever chunk the worker thread sampled before, which is unknowable.
 * A far-away unique-minimum query before each chunk makes the hint (and so every tie) independent of chunk order.
 */
const CLIMATE_SAMPLE_EVERY = 16;
const BIOME_SEARCH_SAMPLE_EVERY = 16;
const PRIMING_TARGET: TargetPoint = { temperature: 90000, humidity: 90000, continentalness: 90000, erosion: 90000, depth: 90000, weirdness: 90000 };

class ChunkBiomeGrid {
  private readonly biomeIndices: Uint16Array;

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

  /** Mirrors ChunkAccess.fillBiomesFromNoise. Cell layout: (quartY * 4 + localQuartZ) * 4 + localQuartX. */
  fill(router: NoiseRouter, minY: number, height: number): void {
    const noiseChunk = new NoiseChunk(router, {
      cellCountXZ: 4,
      firstBlockX: this.chunkX * 16,
      firstBlockZ: this.chunkZ * 16,
      minY,
      height,
      wiredRouterFields: CLIMATE_FIELDS,
    });
    const temperature = noiseChunk.router.temperature!;
    const humidity = noiseChunk.router.vegetation!;
    const continentalness = noiseChunk.router.continents!;
    const erosion = noiseChunk.router.erosion!;
    const depth = noiseChunk.router.depth!;
    const weirdness = noiseChunk.router.ridges!;
    const context = { blockX: 0, blockY: 0, blockZ: 0 };
    const firstQuartX = this.chunkX * QUARTS_PER_CHUNK_SIDE;
    const firstQuartZ = this.chunkZ * QUARTS_PER_CHUNK_SIDE;
    const isProfiling = isWorkerProfiling();
    this.biomeSource.findBiome(PRIMING_TARGET);
    if (isProfiling) this.biomeSource.drainSearchStatistics();
    for (let sectionIndex = 0; sectionIndex < this.quartYCount / 4; sectionIndex++) {
      for (let quartXInSection = 0; quartXInSection < 4; quartXInSection++) {
        for (let quartYInSection = 0; quartYInSection < 4; quartYInSection++) {
          for (let quartZInSection = 0; quartZInSection < 4; quartZInSection++) {
            const quartY = this.minQuartY + sectionIndex * 4 + quartYInSection;
            const quartX = firstQuartX + quartXInSection;
            const quartZ = firstQuartZ + quartZInSection;
            context.blockX = quartX << 2;
            context.blockY = quartY << 2;
            context.blockZ = quartZ << 2;
            if (isProfiling) startWorkerSampledSection("biome.sampleClimate", CLIMATE_SAMPLE_EVERY);
            const quantizedTemperature = quantizeClimateCoordinate(temperature.compute(context));
            const quantizedHumidity = quantizeClimateCoordinate(humidity.compute(context));
            const quantizedContinentalness = quantizeClimateCoordinate(continentalness.compute(context));
            const quantizedErosion = quantizeClimateCoordinate(erosion.compute(context));
            const quantizedDepth = quantizeClimateCoordinate(depth.compute(context));
            const quantizedWeirdness = quantizeClimateCoordinate(weirdness.compute(context));
            if (isProfiling) {
              endWorkerSection();
              startWorkerSampledSection("biome.searchRTree", BIOME_SEARCH_SAMPLE_EVERY);
            }
            const cellIndex = ((sectionIndex * 4 + quartYInSection) * QUARTS_PER_CHUNK_SIDE + quartZInSection) * QUARTS_PER_CHUNK_SIDE + quartXInSection;
            const biomeId = this.biomeSource.findBiomeForClimate(
              quantizedTemperature,
              quantizedHumidity,
              quantizedContinentalness,
              quantizedErosion,
              quantizedDepth,
              quantizedWeirdness,
            );
            this.biomeIndices[cellIndex] = this.internBiome(biomeId);
            if (isProfiling) endWorkerSection();
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

  biomeIndexAt(quartX: number, clampedQuartY: number, quartZ: number): number {
    const localQuartX = quartX - this.chunkX * QUARTS_PER_CHUNK_SIDE;
    const localQuartZ = quartZ - this.chunkZ * QUARTS_PER_CHUNK_SIDE;
    return this.biomeIndices[((clampedQuartY - this.minQuartY) * QUARTS_PER_CHUNK_SIDE + localQuartZ) * QUARTS_PER_CHUNK_SIDE + localQuartX]!;
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
      grid.fill(this.params.router, this.params.minY, this.params.height);
      return grid;
    } finally {
      if (isProfiling) endWorkerSection();
    }
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
