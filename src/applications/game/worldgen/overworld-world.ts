// Per-seed engine instances for the game (one set per thread): the full world used for chunk blocks (base terrain
// plus biome decoration), and a terrain-only generator (noise fill without biomes-to-surface work) that answers cheap
// ground-height questions.

import {
  addWorkerCounter,
  endWorkerSection,
  startWorkerSection,
} from "@/applications/game/profiler/worker-recorder";
import type { ChunkBlocks } from "./engine/chunk";
import { FeatureDecorator, possibleBiomesOfDimension } from "./engine/features";
import { BoundedLruCache } from "./engine/pipeline/bounded-lru-cache";
import {
  createNoiseFillStage,
  createOverworldGenerator,
  type ColumnStage,
  type OverworldGenerator,
} from "./engine/pipeline";
import { loadTerralithRegistries } from "./terralith/load-terralith-registries";

const MAX_CACHED_SEEDS = 2;
// A decorated column reads base terrain up to two columns away, so one 2x2 game column touches a 6x6 base area.
const FULL_GENERATOR_CACHED_COLUMNS = 128;
// Each origin patch serves the 9 columns around it (a few kilobytes: only the written blocks).
const CACHED_DECORATION_ORIGINS = 256;
// A game column consumes its four decorated columns right away and keeps the converted result itself.
const CACHED_DECORATED_COLUMNS = 16;
const TERRAIN_ONLY_GENERATOR_CACHED_COLUMNS = 24;

/**
 * Registration point for stages that are not part of the base pipeline (aquifers, carvers, features). Each entry is
 * spliced into the full generator's stage list after the stage named `insertAfterStageName`.
 */
export interface AdditionalStageRegistration {
  insertAfterStageName: string;
  createStage(): ColumnStage;
}
export const ADDITIONAL_STAGE_REGISTRATIONS: AdditionalStageRegistration[] = [];

export interface FullWorld {
  readonly generator: OverworldGenerator;
  readonly decorator: FeatureDecorator;
  /** Base terrain plus the patches of the 9 origins around the column (cached, treat as read-only). */
  generateDecoratedColumn(chunkX: number, chunkZ: number): ChunkBlocks;
}

function loadRegistriesProfiled(): ReturnType<typeof loadTerralithRegistries> {
  startWorkerSection("world.loadRegistries");
  try {
    return loadTerralithRegistries();
  } finally {
    endWorkerSection();
  }
}

function createFullGenerator(seed: number): OverworldGenerator {
  const { registries, overworldDimension, blockTags } = loadRegistriesProfiled();
  startWorkerSection("world.createGenerator");
  let generator: OverworldGenerator;
  try {
    generator = createOverworldGenerator({
      registries,
      overworldDimension,
      blockTags,
      seed: BigInt(Math.trunc(seed)),
      maxCachedColumns: FULL_GENERATOR_CACHED_COLUMNS,
    });
  } finally {
    endWorkerSection();
  }
  for (const registration of ADDITIONAL_STAGE_REGISTRATIONS) {
    const anchorIndex = generator.stages.findIndex((stage) => stage.name === registration.insertAfterStageName);
    if (anchorIndex === -1) throw new Error(`No stage named "${registration.insertAfterStageName}" to insert after`);
    generator.stages.splice(anchorIndex + 1, 0, registration.createStage());
  }
  return generator;
}

function createFullWorld(seed: number): FullWorld {
  const generator = createFullGenerator(seed);
  const { registries, overworldDimension, blockTags } = loadTerralithRegistries();
  const timedSource: OverworldGenerator = {
    ...generator,
    generateBaseColumn(chunkX, chunkZ) {
      startWorkerSection("baseColumn");
      try {
        return generator.generateBaseColumn(chunkX, chunkZ);
      } finally {
        endWorkerSection();
      }
    },
  };
  const decorator = new FeatureDecorator({
    source: timedSource,
    seed: BigInt(Math.trunc(seed)),
    registries,
    blockTags,
    possibleBiomes: possibleBiomesOfDimension(overworldDimension),
    maxCachedOrigins: CACHED_DECORATION_ORIGINS,
  });
  const decoratedColumns = new BoundedLruCache<string, ChunkBlocks>(CACHED_DECORATED_COLUMNS);
  return {
    generator,
    decorator,
    generateDecoratedColumn(chunkX, chunkZ) {
      const key = `${chunkX},${chunkZ}`;
      let column = decoratedColumns.get(key);
      if (column !== undefined) {
        addWorkerCounter("decoratedColumnCacheHits", 1);
      } else {
        addWorkerCounter("decoratedColumnCacheMisses", 1);
        startWorkerSection("decoration");
        try {
          column = decorator.generateDecoratedColumn(chunkX, chunkZ);
        } finally {
          endWorkerSection();
        }
        decoratedColumns.set(key, column);
      }
      return column;
    },
  };
}

function createTerrainOnlyGenerator(seed: number): OverworldGenerator {
  const { registries, overworldDimension } = loadTerralithRegistries();
  return createOverworldGenerator({
    registries,
    overworldDimension,
    seed: BigInt(Math.trunc(seed)),
    stages: [createNoiseFillStage()],
    maxCachedColumns: TERRAIN_ONLY_GENERATOR_CACHED_COLUMNS,
  });
}

const generatorsBySeed = new Map<number, { full?: FullWorld; terrainOnly?: OverworldGenerator }>();

function entryForSeed(seed: number) {
  let entry = generatorsBySeed.get(seed);
  if (entry === undefined) {
    entry = {};
    if (generatorsBySeed.size >= MAX_CACHED_SEEDS) generatorsBySeed.delete(generatorsBySeed.keys().next().value as number);
  } else {
    generatorsBySeed.delete(seed);
  }
  generatorsBySeed.set(seed, entry);
  return entry;
}

export function getFullWorld(seed: number): FullWorld {
  const entry = entryForSeed(seed);
  return (entry.full ??= createFullWorld(seed));
}

export function getTerrainOnlyGenerator(seed: number): OverworldGenerator {
  const entry = entryForSeed(seed);
  return (entry.terrainOnly ??= createTerrainOnlyGenerator(seed));
}
