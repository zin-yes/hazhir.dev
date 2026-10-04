// Base overworld generator: wires the finished engine stages in vanilla order
// (NoiseBasedChunkGenerator: fill noise with aquifers and ore veins -> biomes -> buildSurface -> carvers). Features
// are a later stage that plugs into `stages`.

import { addWorkerCounter, isWorkerProfiling } from "@/applications/game/profiler/worker-recorder";
import { BiomeManager, MultiNoiseBiomeSource } from "../biome-source";
import { createCarverSystem } from "../carvers";
import { BlockPalette, ChunkBlocks, blockNameOf } from "../chunk";
import { CarvingMask, type CarvingStep } from "../features/core/carving-mask";
import { createSeededNoiseSources, type NoiseRouter, wireNoiseRouter } from "../density";
import { createRootRandomFactory } from "../noise";
import type { JsonObject, TagRegistry, WorldgenRegistries } from "../registry/datapack-loader";
import { BoundedLruCache, packChunkColumnKey } from "./bounded-lru-cache";
import { ChunkBiomeStore } from "./chunk-biome-store";
import type { ColumnStage, ColumnStageContext } from "./column-stage";
import { createCarverStage, createNoiseFillStage, createSeedSurfaceSystem, createSurfaceStage } from "./default-stages";
import { createPointBiomeSampler } from "./point-biome-sampler";
import { runStagesWithProfiling } from "./profiled-stage-runner";
import { readOverworldSettings, type OverworldSettings } from "./noise-settings-reader";

const MAX_CACHED_COLUMNS = 64;
// A biome grid is about 3 KB; decoration and surface rules read biomes a few chunks around every base column.
const MAX_CACHED_BIOME_CHUNKS = 1024;

export type HeightmapType = "WORLD_SURFACE_WG" | "OCEAN_FLOOR_WG";

export interface OverworldGeneratorParams {
  registries: WorldgenRegistries;
  overworldDimension: JsonObject;
  seed: bigint;
  /** Block tags (`#minecraft:...` ids to members) the carvers need; without them the default stage list has no carvers. */
  blockTags?: TagRegistry;
  /** Replaces the default stage list (noise fill with aquifers, surface, carvers); use `generator.stages` to splice instead. */
  stages?: ColumnStage[];
  /** Bounded LRU size for generated columns (default 64). */
  maxCachedColumns?: number;
}

export interface OverworldGenerator {
  readonly settings: Pick<OverworldSettings, "minY" | "height" | "seaLevel" | "defaultBlock">;
  /** The seeded noise router every stage samples (density functions with markers, outside any NoiseChunk). */
  readonly router: NoiseRouter;
  /** Ordered per-column stages. Mutate before the first generateBaseColumn call (cached columns are not regenerated). */
  readonly stages: ColumnStage[];
  /** Noise fill + surface (+ any added stages) for one chunk column. The result is cached: treat it as read-only. */
  generateBaseColumn(chunkX: number, chunkZ: number): ChunkBlocks;
  rawBiomeAtQuart(quartX: number, quartY: number, quartZ: number): string;
  biomeAt(blockX: number, blockY: number, blockZ: number): string;
  /** The carvers' air mask of a base column (undefined for the liquid step and when the carvers stage is absent). */
  carvingMask(chunkX: number, chunkZ: number, step: CarvingStep): CarvingMask | undefined;
  /** First free y above the highest matching block (Heightmap value), computed on the generated base column. */
  surfaceHeight(blockX: number, blockZ: number, heightmap: HeightmapType): number;
}

const NON_MOTION_BLOCKING_NAMES = new Set(["minecraft:air", "minecraft:cave_air", "minecraft:void_air", "minecraft:water", "minecraft:lava"]);

export function createOverworldGenerator(params: OverworldGeneratorParams): OverworldGenerator {
  const { registries, overworldDimension, seed, blockTags } = params;
  const settings = readOverworldSettings(registries, overworldDimension);
  const noiseSettings = registries.noise_settings[settings.noiseSettingsId]!;
  const router = wireNoiseRouter({
    densityFunctionsById: registries.density_function,
    noiseRouterJson: noiseSettings.noise_router as JsonObject,
    sources: createSeededNoiseSources({ registries, seed }),
  });
  const biomeSource = new MultiNoiseBiomeSource((overworldDimension.generator as JsonObject).biome_source as JsonObject, { reuseLastLeaf: true });
  const biomeStore = new ChunkBiomeStore({
    router,
    biomeSource,
    minY: settings.minY,
    height: settings.height,
    maxCachedChunks: MAX_CACHED_BIOME_CHUNKS,
  });
  const rawBiomeAtQuart = (quartX: number, quartY: number, quartZ: number) => biomeStore.rawBiomeAtQuart(quartX, quartY, quartZ);
  const biomeManager = new BiomeManager(rawBiomeAtQuart, seed);
  const biomeAt = (blockX: number, blockY: number, blockZ: number) => biomeManager.getBiome(blockX, blockY, blockZ);

  const palette = new BlockPalette();
  const rootRandomFactory = createRootRandomFactory(seed);
  const seedSurface = createSeedSurfaceSystem({ registries, settings, randomFactory: rootRandomFactory });
  const stages = params.stages ?? [createNoiseFillStage({ aquifers: { rootRandomFactory } }), createSurfaceStage(seedSurface.surfaceSystem)];
  if (params.stages === undefined && blockTags !== undefined) {
    const carverBiomeSampler = createPointBiomeSampler(router, new MultiNoiseBiomeSource((overworldDimension.generator as JsonObject).biome_source as JsonObject));
    const carverSystem = createCarverSystem({ registries, blockTags, seed, rawBiomeAtQuart: carverBiomeSampler });
    stages.push(createCarverStage({ carverSystem, seedSurface, settings, router }));
  }
  const columnCache = new BoundedLruCache<number, ChunkBlocks>(params.maxCachedColumns ?? MAX_CACHED_COLUMNS);
  const carvingMaskByColumn = new WeakMap<ChunkBlocks, CarvingMask>();
  const motionBlockingByPaletteId: boolean[] = [];

  const generateBaseColumn = (chunkX: number, chunkZ: number): ChunkBlocks => {
    const key = packChunkColumnKey(chunkX, chunkZ);
    const cached = columnCache.get(key);
    const isProfiling = isWorkerProfiling();
    if (cached !== undefined) {
      if (isProfiling) addWorkerCounter("baseColumnCacheHits", 1);
      return cached;
    }
    const column = new ChunkBlocks(chunkX, chunkZ, settings.minY, settings.height, palette);
    const context: ColumnStageContext = { chunkX, chunkZ, seed, settings, registries, router, aquifer: undefined, rawBiomeAtQuart, biomeAt };
    if (isProfiling) {
      addWorkerCounter("baseColumnCacheMisses", 1);
      runStagesWithProfiling(stages, column, context);
      biomeStore.drainProfileCounters();
    } else {
      for (const stage of stages) stage.run(column, context);
    }
    if (context.carvingMask !== undefined) carvingMaskByColumn.set(column, CarvingMask.fromByteMask(settings.minY, settings.height, context.carvingMask));
    columnCache.set(key, column);
    return column;
  };

  const blocksMotion = (paletteId: number): boolean => {
    let result = motionBlockingByPaletteId[paletteId];
    if (result === undefined) {
      result = !NON_MOTION_BLOCKING_NAMES.has(blockNameOf(palette.stateOf(paletteId)));
      motionBlockingByPaletteId[paletteId] = result;
    }
    return result;
  };

  return {
    settings: { minY: settings.minY, height: settings.height, seaLevel: settings.seaLevel, defaultBlock: settings.defaultBlock },
    router,
    stages,
    generateBaseColumn,
    rawBiomeAtQuart,
    biomeAt,
    carvingMask: (chunkX, chunkZ, step) => (step === "air" ? carvingMaskByColumn.get(generateBaseColumn(chunkX, chunkZ)) : undefined),
    surfaceHeight(blockX, blockZ, heightmap) {
      const column = generateBaseColumn(blockX >> 4, blockZ >> 4);
      const localX = blockX & 15;
      const localZ = blockZ & 15;
      for (let blockY = column.maxY; blockY >= column.minY; blockY--) {
        const paletteId = column.getId(localX, blockY, localZ);
        const matches = heightmap === "WORLD_SURFACE_WG" ? paletteId !== 0 : blocksMotion(paletteId);
        if (matches) return blockY + 1;
      }
      return column.minY;
    },
  };
}
