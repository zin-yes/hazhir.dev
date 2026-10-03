// Per-column world description (terrain, biome, slope) with caching. A chunk
// column grid covers one 32x32 footprint plus a one block border so slopes
// can be measured without resampling; points outside it are sampled singly.

import { CHUNK_LENGTH, CHUNK_WIDTH } from "@/applications/game/config";
import { BIOME_DEFINITIONS, type BiomeDefinition } from "./biomes";
import { selectBiome, describeBiomeContext } from "./biomes/biome-selection";
import { createTerrainModel, type TerrainModel } from "./terrain-model";
import type { TerrainSample } from "./terrain-types";

export interface ColumnInfo {
  worldX: number;
  worldZ: number;
  sample: TerrainSample;
  biome: BiomeDefinition;
  /** Y of the highest solid block. */
  groundTopY: number;
  /** Water fills y < waterLevel above the ground; equals groundTopY + 1 or less when dry. */
  waterLevel: number;
  isSubmerged: boolean;
  /** Steepest drop to a direct neighbor, in blocks per block. */
  slope: number;
  lowestNeighborHeight: number;
  /** Temperature after altitude cooling. */
  temperature: number;
  humidity: number;
}

export interface ColumnLookup {
  columnAt(worldX: number, worldZ: number): ColumnInfo;
}

const GRID_BORDER = 1;
const GRID_SIDE = CHUNK_WIDTH + GRID_BORDER * 2;
const MAX_CACHED_GRIDS = 40;

function buildColumn(
  worldX: number,
  worldZ: number,
  sample: TerrainSample,
  neighborHeights: readonly [number, number, number, number],
): ColumnInfo {
  let steepestDrop = 0;
  let lowestNeighborHeight = sample.height;
  for (const neighborHeight of neighborHeights) {
    steepestDrop = Math.max(steepestDrop, Math.abs(sample.height - neighborHeight));
    lowestNeighborHeight = Math.min(lowestNeighborHeight, neighborHeight);
  }
  const context = describeBiomeContext(sample);
  const groundTopY = Math.floor(sample.height);
  const isSubmerged = sample.waterLevel > groundTopY + 1;
  return {
    worldX,
    worldZ,
    sample,
    biome: BIOME_DEFINITIONS[selectBiome(sample, steepestDrop)],
    groundTopY,
    waterLevel: sample.waterLevel,
    isSubmerged,
    slope: steepestDrop,
    lowestNeighborHeight,
    temperature: context.temperature,
    humidity: context.humidity,
  };
}

export class ChunkColumnGrid implements ColumnLookup {
  private readonly samples: TerrainSample[] = new Array(GRID_SIDE * GRID_SIDE);
  private readonly columns: (ColumnInfo | undefined)[] = new Array(GRID_SIDE * GRID_SIDE);
  private readonly outsideSamples = new Map<number, TerrainSample>();
  private readonly outsideColumns = new Map<number, ColumnInfo>();
  readonly minimumWorldX: number;
  readonly minimumWorldZ: number;

  constructor(
    private readonly terrain: TerrainModel,
    chunkX: number,
    chunkZ: number,
  ) {
    this.minimumWorldX = chunkX * CHUNK_WIDTH;
    this.minimumWorldZ = chunkZ * CHUNK_LENGTH;
    for (let gridX = 0; gridX < GRID_SIDE; gridX++) {
      for (let gridZ = 0; gridZ < GRID_SIDE; gridZ++) {
        this.samples[gridX * GRID_SIDE + gridZ] = terrain.sample(
          this.minimumWorldX + gridX - GRID_BORDER,
          this.minimumWorldZ + gridZ - GRID_BORDER,
        );
      }
    }
  }

  /** Column at a local position inside this chunk's footprint. */
  localColumn(localX: number, localZ: number): ColumnInfo {
    const gridX = localX + GRID_BORDER;
    const gridZ = localZ + GRID_BORDER;
    const index = gridX * GRID_SIDE + gridZ;
    let column = this.columns[index];
    if (!column) {
      column = buildColumn(
        this.minimumWorldX + localX,
        this.minimumWorldZ + localZ,
        this.samples[index],
        [
          this.samples[index - GRID_SIDE].height,
          this.samples[index + GRID_SIDE].height,
          this.samples[index - 1].height,
          this.samples[index + 1].height,
        ],
      );
      this.columns[index] = column;
    }
    return column;
  }

  columnAt(worldX: number, worldZ: number): ColumnInfo {
    const localX = worldX - this.minimumWorldX;
    const localZ = worldZ - this.minimumWorldZ;
    if (localX >= 0 && localX < CHUNK_WIDTH && localZ >= 0 && localZ < CHUNK_LENGTH) {
      return this.localColumn(localX, localZ);
    }
    const key = (worldX + 1048576) * 2097152 + (worldZ + 1048576);
    let column = this.outsideColumns.get(key);
    if (!column) {
      column = buildColumn(worldX, worldZ, this.outsideSample(worldX, worldZ), [
        this.outsideSample(worldX - 1, worldZ).height,
        this.outsideSample(worldX + 1, worldZ).height,
        this.outsideSample(worldX, worldZ - 1).height,
        this.outsideSample(worldX, worldZ + 1).height,
      ]);
      this.outsideColumns.set(key, column);
    }
    return column;
  }

  /** Cheap terrain sample at any point; reuses grid data when the point is inside. */
  terrainSampleAt(worldX: number, worldZ: number): TerrainSample {
    return this.outsideSample(worldX, worldZ);
  }

  private outsideSample(worldX: number, worldZ: number): TerrainSample {
    const gridX = worldX - this.minimumWorldX + GRID_BORDER;
    const gridZ = worldZ - this.minimumWorldZ + GRID_BORDER;
    if (gridX >= 0 && gridX < GRID_SIDE && gridZ >= 0 && gridZ < GRID_SIDE) {
      return this.samples[gridX * GRID_SIDE + gridZ];
    }
    const key = (worldX + 1048576) * 2097152 + (worldZ + 1048576);
    let sample = this.outsideSamples.get(key);
    if (!sample) {
      sample = this.terrain.sample(worldX, worldZ);
      this.outsideSamples.set(key, sample);
    }
    return sample;
  }
}

interface SeedCache {
  seed: number;
  terrain: TerrainModel;
  grids: Map<string, ChunkColumnGrid>;
}

let activeCache: SeedCache | undefined;

function cacheForSeed(seed: number): SeedCache {
  if (activeCache?.seed !== seed) {
    activeCache = { seed, terrain: createTerrainModel(seed), grids: new Map() };
  }
  return activeCache;
}

export function getTerrainModel(seed: number): TerrainModel {
  return cacheForSeed(seed).terrain;
}

export function getChunkColumnGrid(seed: number, chunkX: number, chunkZ: number): ChunkColumnGrid {
  const cache = cacheForSeed(seed);
  const key = `${chunkX},${chunkZ}`;
  let grid = cache.grids.get(key);
  if (!grid) {
    grid = new ChunkColumnGrid(cache.terrain, chunkX, chunkZ);
    cache.grids.set(key, grid);
    if (cache.grids.size > MAX_CACHED_GRIDS) {
      const oldestKey = cache.grids.keys().next().value as string;
      cache.grids.delete(oldestKey);
    }
  }
  return grid;
}
