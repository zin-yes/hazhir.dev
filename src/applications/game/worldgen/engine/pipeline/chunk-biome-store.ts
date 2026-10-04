// Mirrors NoiseBasedChunkGenerator.doCreateBiomes + ChunkAccess.fillBiomesFromNoise: each chunk samples the six
// climate functions through its own NoiseChunk caches (NoiseChunk.cachedClimateSampler, so flat_cache values are
// taken at y = 0 on the quart grid) at the quart cells of its section grid, and the biome source picks the biome.
// A chunk is filled eagerly in LevelChunkSection.fillBiomesFromNoise order (sections bottom-up, x, y, z), because the
// biome source's last-leaf hint makes exact climate ties depend on query order, and vanilla's stored biomes reflect it.
// Chunks are kept in a bounded LRU.

import { SinglePointContext, type DensityNode, type NoiseRouter, quantizeClimateCoordinate } from "../density";
import type { TargetPoint } from "../density";
import { NoiseChunk } from "../terrain";
import type { MultiNoiseBiomeSource } from "../biome-source";
import { BoundedLruCache } from "./bounded-lru-cache";

const QUARTS_PER_CHUNK_SIDE = 4;
const CLIMATE_FIELDS = ["temperature", "vegetation", "continents", "erosion", "depth", "ridges"] as const;
/**
 * Vanilla's last-leaf hint carries over from whatever chunk the worker thread sampled before, which is unknowable.
 * A far-away unique-minimum query before each chunk makes the hint (and so every tie) independent of chunk order.
 */
const PRIMING_TARGET: TargetPoint = { temperature: 90000, humidity: 90000, continentalness: 90000, erosion: 90000, depth: 90000, weirdness: 90000 };

class ChunkBiomeGrid {
  private readonly biomeIndices: Uint16Array;
  private readonly temperature: DensityNode;
  private readonly humidity: DensityNode;
  private readonly continentalness: DensityNode;
  private readonly erosion: DensityNode;
  private readonly depth: DensityNode;
  private readonly weirdness: DensityNode;

  constructor(
    private readonly chunkX: number,
    private readonly chunkZ: number,
    private readonly quartYCount: number,
    private readonly minQuartY: number,
    router: NoiseRouter,
    minY: number,
    height: number,
    private readonly biomeSource: MultiNoiseBiomeSource,
    private readonly internBiome: (biomeId: string) => number,
  ) {
    this.biomeIndices = new Uint16Array(QUARTS_PER_CHUNK_SIDE * QUARTS_PER_CHUNK_SIDE * quartYCount);
    const noiseChunk = new NoiseChunk(router, {
      cellCountXZ: 4,
      firstBlockX: chunkX * 16,
      firstBlockZ: chunkZ * 16,
      minY,
      height,
      wiredRouterFields: CLIMATE_FIELDS,
    });
    this.temperature = noiseChunk.router.temperature!;
    this.humidity = noiseChunk.router.vegetation!;
    this.continentalness = noiseChunk.router.continents!;
    this.erosion = noiseChunk.router.erosion!;
    this.depth = noiseChunk.router.depth!;
    this.weirdness = noiseChunk.router.ridges!;
  }

  /** Mirrors ChunkAccess.fillBiomesFromNoise. Cell layout: (quartY * 4 + localQuartZ) * 4 + localQuartX. */
  fill(): void {
    const firstQuartX = this.chunkX * QUARTS_PER_CHUNK_SIDE;
    const firstQuartZ = this.chunkZ * QUARTS_PER_CHUNK_SIDE;
    this.biomeSource.findBiome(PRIMING_TARGET);
    for (let sectionIndex = 0; sectionIndex < this.quartYCount / 4; sectionIndex++) {
      for (let quartXInSection = 0; quartXInSection < 4; quartXInSection++) {
        for (let quartYInSection = 0; quartYInSection < 4; quartYInSection++) {
          for (let quartZInSection = 0; quartZInSection < 4; quartZInSection++) {
            const quartY = this.minQuartY + sectionIndex * 4 + quartYInSection;
            const quartX = firstQuartX + quartXInSection;
            const quartZ = firstQuartZ + quartZInSection;
            const context = new SinglePointContext(quartX << 2, quartY << 2, quartZ << 2);
            const target: TargetPoint = {
              temperature: quantizeClimateCoordinate(this.temperature.compute(context)),
              humidity: quantizeClimateCoordinate(this.humidity.compute(context)),
              continentalness: quantizeClimateCoordinate(this.continentalness.compute(context)),
              erosion: quantizeClimateCoordinate(this.erosion.compute(context)),
              depth: quantizeClimateCoordinate(this.depth.compute(context)),
              weirdness: quantizeClimateCoordinate(this.weirdness.compute(context)),
            };
            const cellIndex = ((sectionIndex * 4 + quartYInSection) * QUARTS_PER_CHUNK_SIDE + quartZInSection) * QUARTS_PER_CHUNK_SIDE + quartXInSection;
            this.biomeIndices[cellIndex] = this.internBiome(this.biomeSource.findBiome(target));
          }
        }
      }
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
  private readonly grids: BoundedLruCache<string, ChunkBiomeGrid>;
  private readonly biomeIds: string[] = [];
  private readonly indicesByBiomeId = new Map<string, number>();
  private readonly minQuartY: number;
  private readonly quartYCount: number;
  private lastGridKey = "";
  private lastGrid: ChunkBiomeGrid | undefined;

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

  /** ChunkAccess.getNoiseBiome: y is clamped into the chunk's section range, x and z select the chunk. */
  rawBiomeAtQuart(quartX: number, quartY: number, quartZ: number): string {
    const chunkX = quartX >> 2;
    const chunkZ = quartZ >> 2;
    const key = `${chunkX},${chunkZ}`;
    let grid: ChunkBiomeGrid | undefined;
    if (key === this.lastGridKey) grid = this.lastGrid;
    grid ??= this.grids.get(key);
    if (grid === undefined) {
      grid = new ChunkBiomeGrid(
        chunkX,
        chunkZ,
        this.quartYCount,
        this.minQuartY,
        this.params.router,
        this.params.minY,
        this.params.height,
        this.params.biomeSource,
        this.internBiome,
      );
      grid.fill();
      this.grids.set(key, grid);
    }
    this.lastGridKey = key;
    this.lastGrid = grid;
    const clampedQuartY = Math.min(Math.max(quartY, this.minQuartY), this.minQuartY + this.quartYCount - 1);
    return this.biomeIds[grid.biomeIndexAt(quartX, clampedQuartY, quartZ)]!;
  }
}
