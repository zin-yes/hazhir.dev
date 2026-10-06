// NoiseBasedChunkGenerator.applyCarvers (Minecraft 1.20.6, GenerationStep.Carving.AIR): every chunk within 8 of the
// carved chunk may start the carvers listed by the biome at its minimum corner (quart y 0); each carver seeds a
// WorldgenRandom with setLargeFeatureSeed(seed + carverIndex, chunkX, chunkZ), decides isStartChunk, then carves into
// the chunk being generated, which shares one carving mask across all carvers.

import { DIMENSIONS } from "@/applications/game/profiler/dimensions";
import {
  addWorkerCounter,
  addWorkerKeyedUnits,
  endWorkerSection,
  isWorkerProfiling,
  startWorkerSection,
} from "@/applications/game/profiler/worker-recorder";
import type { ChunkBlocks } from "../chunk";
import { LegacyRandomSource } from "../random";
import { bigIntToHalves, type Int64Halves, multiply64Into } from "../random/int64";
import type { JsonObject, TagRegistry, WorldgenRegistries } from "../registry/datapack-loader";
import { type CarverConfig, parseConfiguredCarver, readBiomeAirCarverIds } from "./carver-config";
import { carveCanyon } from "./canyon-world-carver";
import { carveCaves } from "./cave-world-carver";
import { defineHotCounter, noteHot } from "../profiling/hot-counters";
import { type CarverAquifer, CarvingContext, type TopMaterialSource } from "./carving-context";

const SOURCE_CHUNK_CACHE_HITS = defineHotCounter("carver.sourceChunkCacheHits");
const SOURCE_CHUNK_CACHE_MISSES = defineHotCounter("carver.sourceChunkCacheMisses");
const SOURCE_CHUNK_CACHE_CLEARS = defineHotCounter("carver.sourceChunkCacheClears");
const BIOME_CARVER_LISTS_BUILT = defineHotCounter("carver.biomeCarverListsBuilt");
const CARVER_CONFIGS_PARSED = defineHotCounter("carver.configsParsed");

const SOURCE_CHUNK_RADIUS = 8;
const MAX_CACHED_SOURCE_CHUNKS = 20_000;
const CHUNK_KEY_OFFSET = 2 ** 21;
const CHUNK_KEY_STRIDE = 2 ** 22;

export interface CarverSystemConfig {
  registries: Pick<WorldgenRegistries, "biome" | "configured_carver">;
  blockTags: TagRegistry;
  seed: bigint;
  /** Biome of a quart cell (NoiseBiomeSource.getNoiseBiome): read once per source chunk at (chunkX * 4, 0, chunkZ * 4). */
  rawBiomeAtQuart: (quartX: number, quartY: number, quartZ: number) => string;
}

export interface ApplyCarversParams {
  /** The chunk after the surface stage; carved in place. */
  chunk: ChunkBlocks;
  /** The chunk's aquifer (FilledChunkColumn.aquifer or createChunkAquifer): decides air, water or lava inside caves. */
  aquifer: CarverAquifer;
  /** Terrain symbol -> block state (terrainSymbolStates), so carved air, water and lava use the pipeline's palette. */
  symbolStates: readonly string[];
  /** Restores grass over dirt exposed by a carved surface block (SurfaceSystem.topMaterial). Omitted: no restoration. */
  topMaterial?: TopMaterialSource;
}

const SEED_MASK_BITS = 64;

const firstLong: Int64Halves = { high: 0, low: 0 };
const secondLong: Int64Halves = { high: 0, low: 0 };
const firstProduct: Int64Halves = { high: 0, low: 0 };
const secondProduct: Int64Halves = { high: 0, low: 0 };

/**
 * WorldgenRandom.setLargeFeatureSeed on a Legacy source, in int32 halves:
 * setSeed(seed); setSeed((long)chunkX * nextLong() ^ (long)chunkZ * nextLong() ^ seed).
 */
function setLargeFeatureSeed(random: LegacyRandomSource, seed: Int64Halves, chunkX: number, chunkZ: number): void {
  random.setSeedFromLongHalves(seed.high, seed.low);
  random.nextLongInto(firstLong);
  random.nextLongInto(secondLong);
  multiply64Into(chunkX < 0 ? -1 : 0, chunkX | 0, firstLong.high, firstLong.low, firstProduct);
  multiply64Into(chunkZ < 0 ? -1 : 0, chunkZ | 0, secondLong.high, secondLong.low, secondProduct);
  random.setSeedFromLongHalves(firstProduct.high ^ secondProduct.high ^ seed.high, firstProduct.low ^ secondProduct.low ^ seed.low);
}

export class CarverSystem {
  private readonly carversByBiomeId = new Map<string, CarverConfig[]>();
  private readonly carversByConfiguredId = new Map<string, CarverConfig>();
  private readonly carversBySourceChunk = new Map<number, CarverConfig[]>();
  private readonly random = new LegacyRandomSource(BigInt(0));
  /** seed + carverIndex as a Java long, per carver index. */
  private readonly carverSeeds: Int64Halves[] = [];

  constructor(private readonly config: CarverSystemConfig) {}

  private carverSeed(carverIndex: number): Int64Halves {
    let seed = this.carverSeeds[carverIndex];
    if (seed === undefined) {
      seed = { high: 0, low: 0 };
      bigIntToHalves(BigInt.asIntN(SEED_MASK_BITS, this.config.seed + BigInt(carverIndex)), seed);
      this.carverSeeds[carverIndex] = seed;
    }
    return seed;
  }

  private carverById(carverId: string): CarverConfig {
    let carver = this.carversByConfiguredId.get(carverId);
    if (carver === undefined) {
      const json = this.config.registries.configured_carver[carverId];
      if (json === undefined) throw new Error(`Unknown configured carver ${carverId}`);
      carver = parseConfiguredCarver(carverId, json, this.config.blockTags);
      noteHot(CARVER_CONFIGS_PARSED);
      this.carversByConfiguredId.set(carverId, carver);
    }
    return carver;
  }

  private carversOfBiome(biomeId: string): CarverConfig[] {
    let carvers = this.carversByBiomeId.get(biomeId);
    if (carvers === undefined) {
      const biomeJson: JsonObject | undefined = this.config.registries.biome[biomeId];
      if (biomeJson === undefined) throw new Error(`Unknown biome ${biomeId}`);
      carvers = readBiomeAirCarverIds(biomeJson).map((carverId) => this.carverById(carverId));
      noteHot(BIOME_CARVER_LISTS_BUILT);
      this.carversByBiomeId.set(biomeId, carvers);
    }
    return carvers;
  }

  /** BiomeGenerationSettings.getCarvers(AIR) of the biome at the chunk's minimum corner. */
  carversOfSourceChunk(chunkX: number, chunkZ: number): CarverConfig[] {
    const key = (chunkX + CHUNK_KEY_OFFSET) * CHUNK_KEY_STRIDE + (chunkZ + CHUNK_KEY_OFFSET);
    let carvers = this.carversBySourceChunk.get(key);
    if (carvers === undefined) {
      noteHot(SOURCE_CHUNK_CACHE_MISSES);
      carvers = this.carversOfBiome(this.config.rawBiomeAtQuart(chunkX * 4, 0, chunkZ * 4));
      if (this.carversBySourceChunk.size >= MAX_CACHED_SOURCE_CHUNKS) {
        noteHot(SOURCE_CHUNK_CACHE_CLEARS);
        this.carversBySourceChunk.clear();
      }
      this.carversBySourceChunk.set(key, carvers);
    } else {
      noteHot(SOURCE_CHUNK_CACHE_HITS);
    }
    return carvers;
  }

  /** Returns the carving mask (index (y - minY) * 256 + localZ * 16 + localX, 1 where a carver removed a block). */
  applyCarvers(params: ApplyCarversParams): Uint8Array {
    const { chunk } = params;
    const isProfiling = isWorkerProfiling();
    const context = new CarvingContext(params);
    const random = this.random;
    let sourceChunksScanned = 0;
    let carverRolls = 0;
    let carversStarted = 0;
    for (let offsetX = -SOURCE_CHUNK_RADIUS; offsetX <= SOURCE_CHUNK_RADIUS; offsetX++) {
      for (let offsetZ = -SOURCE_CHUNK_RADIUS; offsetZ <= SOURCE_CHUNK_RADIUS; offsetZ++) {
        const sourceChunkX = chunk.chunkX + offsetX;
        const sourceChunkZ = chunk.chunkZ + offsetZ;
        const carvers = this.carversOfSourceChunk(sourceChunkX, sourceChunkZ);
        sourceChunksScanned++;
        for (let carverIndex = 0; carverIndex < carvers.length; carverIndex++) {
          const carver = carvers[carverIndex]!;
          setLargeFeatureSeed(random, this.carverSeed(carverIndex), sourceChunkX, sourceChunkZ);
          const startsHere = random.nextFloat() <= carver.probability;
          carverRolls++;
          if (!startsHere) continue;
          carversStarted++;
          if (isProfiling) this.carveProfiled(context, carver, random, sourceChunkX, sourceChunkZ);
          else if (carver.kind === "cave") carveCaves(context, carver, random, sourceChunkX, sourceChunkZ);
          else carveCanyon(context, carver, random, sourceChunkX, sourceChunkZ);
        }
      }
    }
    if (isProfiling) {
      addWorkerCounter("carverSourceChunksScanned", sourceChunksScanned);
      addWorkerCounter("carverStartRolls", carverRolls);
      addWorkerCounter("carversStarted", carversStarted);
      addWorkerCounter("carverEllipsoids", context.ellipsoidsCarved);
      addWorkerCounter("carverBlocksTested", context.blocksTested);
      addWorkerCounter("carverBlocksRemoved", context.blocksRemoved);
      addWorkerCounter("carver.ellipsoidsOutOfRange", context.ellipsoidsOutOfRange);
      addWorkerCounter("carver.blocksAlreadyMasked", context.blocksAlreadyMasked);
      addWorkerCounter("carver.blocksNotReplaceable", context.blocksNotReplaceable);
      addWorkerCounter("carver.blocksKeptByAquifer", context.blocksKeptByAquifer);
      addWorkerCounter("carver.lavaBlocksCarved", context.lavaBlocksCarved);
      addWorkerCounter("carver.topMaterialLookups", context.topMaterialLookups);
      addWorkerCounter("carver.roomsCreated", context.roomsCreated);
      addWorkerCounter("carver.tunnelsStarted", context.tunnelsStarted);
      addWorkerCounter("carver.tunnelBranches", context.tunnelBranches);
      addWorkerCounter("carver.tunnelSteps", context.tunnelSteps);
      addWorkerCounter("carver.stepsStaggered", context.tunnelStepsStaggered);
      addWorkerCounter("carver.tunnelsEndedOutOfReach", context.tunnelsEndedOutOfReach);
      addWorkerCounter("carver.canyonsStarted", context.canyonsStarted);
      addWorkerCounter("carver.canyonSteps", context.canyonSteps);
      params.aquifer.drainProfileCounters?.();
    }
    return context.mask;
  }

  private carveProfiled(context: CarvingContext, carver: CarverConfig, random: LegacyRandomSource, sourceChunkX: number, sourceChunkZ: number): void {
    const blocksRemovedBefore = context.blocksRemoved;
    startWorkerSection(carver.kind === "cave" ? "carver.cave" : "carver.canyon", DIMENSIONS.worldgenCarver, carver.id);
    try {
      if (carver.kind === "cave") carveCaves(context, carver, random, sourceChunkX, sourceChunkZ);
      else carveCanyon(context, carver, random, sourceChunkX, sourceChunkZ);
    } finally {
      endWorkerSection();
    }
    addWorkerKeyedUnits(DIMENSIONS.worldgenCarver, carver.id, context.blocksRemoved - blocksRemovedBefore);
  }
}

export function createCarverSystem(config: CarverSystemConfig): CarverSystem {
  return new CarverSystem(config);
}

/** One-call form of NoiseBasedChunkGenerator.applyCarvers: `system.applyCarvers(params)`. */
export function applyCarvers(system: CarverSystem, params: ApplyCarversParams): Uint8Array {
  return system.applyCarvers(params);
}
