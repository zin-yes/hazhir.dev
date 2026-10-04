// NoiseBasedChunkGenerator.applyCarvers (Minecraft 1.20.6, GenerationStep.Carving.AIR): every chunk within 8 of the
// carved chunk may start the carvers listed by the biome at its minimum corner (quart y 0); each carver seeds a
// WorldgenRandom with setLargeFeatureSeed(seed + carverIndex, chunkX, chunkZ), decides isStartChunk, then carves into
// the chunk being generated, which shares one carving mask across all carvers.

import type { ChunkBlocks } from "../chunk";
import { LegacyRandomSource } from "../random";
import type { JsonObject, TagRegistry, WorldgenRegistries } from "../registry/datapack-loader";
import { type CarverConfig, parseConfiguredCarver, readBiomeAirCarverIds } from "./carver-config";
import { carveCanyon } from "./canyon-world-carver";
import { carveCaves } from "./cave-world-carver";
import { type CarverAquifer, CarvingContext, type TopMaterialSource } from "./carving-context";

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

/** WorldgenRandom.setLargeFeatureSeed on a Legacy source. */
function setLargeFeatureSeed(random: LegacyRandomSource, seed: bigint, chunkX: number, chunkZ: number): void {
  random.setSeed(seed);
  const first = random.nextLong();
  const second = random.nextLong();
  const mixed = BigInt.asIntN(SEED_MASK_BITS, BigInt(chunkX) * first) ^ BigInt.asIntN(SEED_MASK_BITS, BigInt(chunkZ) * second) ^ seed;
  random.setSeed(mixed);
}

export class CarverSystem {
  private readonly carversByBiomeId = new Map<string, CarverConfig[]>();
  private readonly carversByConfiguredId = new Map<string, CarverConfig>();
  private readonly carversBySourceChunk = new Map<number, CarverConfig[]>();
  private readonly random = new LegacyRandomSource(BigInt(0));

  constructor(private readonly config: CarverSystemConfig) {}

  private carverById(carverId: string): CarverConfig {
    let carver = this.carversByConfiguredId.get(carverId);
    if (carver === undefined) {
      const json = this.config.registries.configured_carver[carverId];
      if (json === undefined) throw new Error(`Unknown configured carver ${carverId}`);
      carver = parseConfiguredCarver(carverId, json, this.config.blockTags);
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
      this.carversByBiomeId.set(biomeId, carvers);
    }
    return carvers;
  }

  /** BiomeGenerationSettings.getCarvers(AIR) of the biome at the chunk's minimum corner. */
  carversOfSourceChunk(chunkX: number, chunkZ: number): CarverConfig[] {
    const key = (chunkX + CHUNK_KEY_OFFSET) * CHUNK_KEY_STRIDE + (chunkZ + CHUNK_KEY_OFFSET);
    let carvers = this.carversBySourceChunk.get(key);
    if (carvers === undefined) {
      carvers = this.carversOfBiome(this.config.rawBiomeAtQuart(chunkX * 4, 0, chunkZ * 4));
      if (this.carversBySourceChunk.size >= MAX_CACHED_SOURCE_CHUNKS) this.carversBySourceChunk.clear();
      this.carversBySourceChunk.set(key, carvers);
    }
    return carvers;
  }

  /** Returns the carving mask (index (y - minY) * 256 + localZ * 16 + localX, 1 where a carver removed a block). */
  applyCarvers(params: ApplyCarversParams): Uint8Array {
    const { chunk } = params;
    const context = new CarvingContext(params);
    const random = this.random;
    for (let offsetX = -SOURCE_CHUNK_RADIUS; offsetX <= SOURCE_CHUNK_RADIUS; offsetX++) {
      for (let offsetZ = -SOURCE_CHUNK_RADIUS; offsetZ <= SOURCE_CHUNK_RADIUS; offsetZ++) {
        const sourceChunkX = chunk.chunkX + offsetX;
        const sourceChunkZ = chunk.chunkZ + offsetZ;
        const carvers = this.carversOfSourceChunk(sourceChunkX, sourceChunkZ);
        for (let carverIndex = 0; carverIndex < carvers.length; carverIndex++) {
          const carver = carvers[carverIndex]!;
          setLargeFeatureSeed(random, BigInt.asIntN(SEED_MASK_BITS, this.config.seed + BigInt(carverIndex)), sourceChunkX, sourceChunkZ);
          if (random.nextFloat() > carver.probability) continue;
          if (carver.kind === "cave") carveCaves(context, carver, random, sourceChunkX, sourceChunkZ);
          else carveCanyon(context, carver, random, sourceChunkX, sourceChunkZ);
        }
      }
    }
    return context.mask;
  }
}

export function createCarverSystem(config: CarverSystemConfig): CarverSystem {
  return new CarverSystem(config);
}

/** One-call form of NoiseBasedChunkGenerator.applyCarvers: `system.applyCarvers(params)`. */
export function applyCarvers(system: CarverSystem, params: ApplyCarversParams): Uint8Array {
  return system.applyCarvers(params);
}
