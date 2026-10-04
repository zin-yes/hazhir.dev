// Base overworld generator: wires the finished engine stages in vanilla order
// (NoiseBasedChunkGenerator: fill noise -> biomes -> buildSurface). Aquifers, ore veins, carvers and features are
// later stages that plug into `stages`.

import { BiomeManager, MultiNoiseBiomeSource } from "../biome-source";
import { BlockPalette, ChunkBlocks, blockNameOf } from "../chunk";
import { createSeededNoiseSources, wireNoiseRouter } from "../density";
import type { JsonObject, WorldgenRegistries } from "../registry/datapack-loader";
import { BoundedLruCache } from "./bounded-lru-cache";
import { ChunkBiomeStore } from "./chunk-biome-store";
import type { ColumnStage, ColumnStageContext } from "./column-stage";
import { createNoiseFillStage, createSeedSurfaceSystem, createSurfaceStage } from "./default-stages";
import { readOverworldSettings, type OverworldSettings } from "./noise-settings-reader";

const MAX_CACHED_COLUMNS = 64;
const MAX_CACHED_BIOME_CHUNKS = 64;

export type HeightmapType = "WORLD_SURFACE_WG" | "OCEAN_FLOOR_WG";

export interface OverworldGeneratorParams {
  registries: WorldgenRegistries;
  overworldDimension: JsonObject;
  seed: bigint;
  /** Replaces the default stage list (noise fill, surface); use `generator.stages` to splice instead. */
  stages?: ColumnStage[];
  /** Bounded LRU size for generated columns (default 64). */
  maxCachedColumns?: number;
}

export interface OverworldGenerator {
  readonly settings: Pick<OverworldSettings, "minY" | "height" | "seaLevel" | "defaultBlock">;
  /** Ordered per-column stages. Mutate before the first generateBaseColumn call (cached columns are not regenerated). */
  readonly stages: ColumnStage[];
  /** Noise fill + surface (+ any added stages) for one chunk column. The result is cached: treat it as read-only. */
  generateBaseColumn(chunkX: number, chunkZ: number): ChunkBlocks;
  rawBiomeAtQuart(quartX: number, quartY: number, quartZ: number): string;
  biomeAt(blockX: number, blockY: number, blockZ: number): string;
  /** First free y above the highest matching block (Heightmap value), computed on the generated base column. */
  surfaceHeight(blockX: number, blockZ: number, heightmap: HeightmapType): number;
}

const NON_MOTION_BLOCKING_NAMES = new Set(["minecraft:air", "minecraft:cave_air", "minecraft:void_air", "minecraft:water", "minecraft:lava"]);

export function createOverworldGenerator(params: OverworldGeneratorParams): OverworldGenerator {
  const { registries, overworldDimension, seed } = params;
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
  const surfaceSystem = createSeedSurfaceSystem({ registries, settings, seed });
  const stages = params.stages ?? [createNoiseFillStage(), createSurfaceStage(surfaceSystem)];
  const columnCache = new BoundedLruCache<string, ChunkBlocks>(params.maxCachedColumns ?? MAX_CACHED_COLUMNS);
  const motionBlockingByPaletteId: boolean[] = [];

  const generateBaseColumn = (chunkX: number, chunkZ: number): ChunkBlocks => {
    const key = `${chunkX},${chunkZ}`;
    const cached = columnCache.get(key);
    if (cached !== undefined) return cached;
    const column = new ChunkBlocks(chunkX, chunkZ, settings.minY, settings.height, palette);
    const context: ColumnStageContext = { chunkX, chunkZ, seed, settings, registries, router, rawBiomeAtQuart, biomeAt };
    for (const stage of stages) stage.run(column, context);
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
    stages,
    generateBaseColumn,
    rawBiomeAtQuart,
    biomeAt,
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
