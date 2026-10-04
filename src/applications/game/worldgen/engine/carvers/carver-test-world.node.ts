// Node-only test helper: the seed-1337 Terralith world pieces the carver tests need (router, climate-based raw biomes,
// BiomeManager, surface system, aquifers), built once per test process from the scratch datapacks.

import { BiomeManager, MultiNoiseBiomeSource } from "../biome-source";
import { BlockPalette, ChunkBlocks } from "../chunk";
import { createClimateSampler } from "../density";
import { loadOverworldRouter, loadTerralithDatapacks, TEST_SEED } from "../density/terralith-test-data.node";
import { createRootRandomFactory, NoiseRegistry, type NoiseParameters } from "../noise";
import type { JsonObject } from "../registry/datapack-loader";
import { createBiomeClimateLookup, createSurfaceSystem } from "../surface";
import { createChunkAquifer, terrainSymbolStates } from "../terrain";
import { createCarverSystem } from "./carver-system";
import { createTopMaterialSourceFactory } from "./top-material";

export const MIN_Y = -64;
export const HEIGHT = 384;
export const SEA_LEVEL = 63;

let cachedWorld: ReturnType<typeof buildWorld> | undefined;

function buildWorld() {
  const { registries, overworldDimension, blockTags } = loadTerralithDatapacks();
  const router = loadOverworldRouter();
  const rootRandomFactory = createRootRandomFactory(TEST_SEED);
  const parametersById: Record<string, NoiseParameters> = {};
  for (const [noiseId, json] of Object.entries(registries.noise)) {
    parametersById[noiseId] = { firstOctave: json.firstOctave as number, amplitudes: json.amplitudes as number[] };
  }
  const noises = new NoiseRegistry(parametersById, rootRandomFactory);
  const surfaceRule = registries.noise_settings["minecraft:overworld"]!.surface_rule as JsonObject;
  const biomeClimate = createBiomeClimateLookup(registries.biome);
  const surfaceSystem = createSurfaceSystem({
    noises,
    randomFactory: rootRandomFactory,
    surfaceRule,
    seaLevel: SEA_LEVEL,
    defaultBlock: "minecraft:stone",
    biomeClimate,
  });
  const biomeSource = new MultiNoiseBiomeSource((overworldDimension!.generator as JsonObject).biome_source as JsonObject);
  const climateSampler = createClimateSampler(router);
  const rawBiomeAtQuart = (quartX: number, quartY: number, quartZ: number) => biomeSource.findBiome(climateSampler.sample(quartX, quartY, quartZ));
  const biomeManager = new BiomeManager(rawBiomeAtQuart, TEST_SEED);
  const biomeAtBlock = (blockX: number, blockY: number, blockZ: number) => biomeManager.getBiome(blockX, blockY, blockZ);
  const symbolStates = terrainSymbolStates("minecraft:stone", "minecraft:water[level=0]");
  const carverSystem = createCarverSystem({ registries, blockTags, seed: TEST_SEED, rawBiomeAtQuart });
  const createTopMaterialSource = createTopMaterialSourceFactory({
    surfaceSystem,
    surfaceRule,
    noises,
    randomFactory: rootRandomFactory,
    router,
    biomeClimate,
  });
  return { registries, blockTags, router, rootRandomFactory, rawBiomeAtQuart, biomeAtBlock, symbolStates, carverSystem, createTopMaterialSource };
}

export function loadCarverTestWorld() {
  cachedWorld ??= buildWorld();
  return cachedWorld;
}

/** A column built from recorded block names (palette ids assigned in name order, air first). */
export function chunkFromRecordedNames(chunkX: number, chunkZ: number, paletteNames: string[], encodedIds: string): ChunkBlocks {
  const palette = new BlockPalette();
  const bytes = new Uint8Array(Buffer.from(encodedIds, "base64"));
  const recordedIds = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
  const idByRecordedId = paletteNames.map((name) => palette.idOf(name));
  const chunk = new ChunkBlocks(chunkX, chunkZ, MIN_Y, HEIGHT, palette);
  for (let index = 0; index < recordedIds.length; index++) chunk.blocks[index] = idByRecordedId[recordedIds[index]!]!;
  return chunk;
}

export { createChunkAquifer };
