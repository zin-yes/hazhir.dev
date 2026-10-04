// Node-only test helper: fill (aquifers + ore veins) -> surface -> carvers for one chunk, the stage order of
// NoiseBasedChunkGenerator, so tests can compare whole columns with the real server's chunks.

import { BlockPalette, ChunkBlocks } from "../chunk";
import { fillChunkColumnDetailed } from "../terrain";
import { createSurfaceSystem } from "../surface";
import { loadCarverTestWorld, HEIGHT, MIN_Y, SEA_LEVEL } from "./carver-test-world.node";
import { createNoiseRouter } from "../density";
import { loadTerralithDatapacks, TEST_SEED } from "../density/terralith-test-data.node";
import { createRootRandomFactory, NoiseRegistry, type NoiseParameters } from "../noise";
import type { JsonObject } from "../registry/datapack-loader";
import { createBiomeClimateLookup } from "../surface";

let fullWorld: ReturnType<typeof buildFullWorld> | undefined;

function buildFullWorld() {
  const world = loadCarverTestWorld();
  const { registries } = loadTerralithDatapacks();
  const rootRandomFactory = createRootRandomFactory(TEST_SEED);
  const parametersById: Record<string, NoiseParameters> = {};
  for (const [noiseId, json] of Object.entries(registries.noise)) {
    parametersById[noiseId] = { firstOctave: json.firstOctave as number, amplitudes: json.amplitudes as number[] };
  }
  const surfaceSystem = createSurfaceSystem({
    noises: new NoiseRegistry(parametersById, rootRandomFactory),
    randomFactory: rootRandomFactory,
    surfaceRule: registries.noise_settings["minecraft:overworld"]!.surface_rule as JsonObject,
    seaLevel: SEA_LEVEL,
    defaultBlock: "minecraft:stone",
    biomeClimate: createBiomeClimateLookup(registries.biome),
  });
  return { world, surfaceSystem, palette: new BlockPalette() };
}

export interface GeneratedColumn {
  /** The carved chunk (palette ids). */
  chunk: ChunkBlocks;
  /** Copy of the block ids after the surface stage, before the carvers ran. */
  preCarveBlocks: Uint16Array;
  fillMilliseconds: number;
  surfaceMilliseconds: number;
  carveMilliseconds: number;
}

export function generateCarvedColumn(chunkX: number, chunkZ: number): GeneratedColumn {
  fullWorld ??= buildFullWorld();
  const { world, surfaceSystem, palette } = fullWorld;
  const fillStart = performance.now();
  const { blocks, aquifer } = fillChunkColumnDetailed({
    router: world.router,
    chunkX,
    chunkZ,
    minY: MIN_Y,
    height: HEIGHT,
    seaLevel: SEA_LEVEL,
    aquifers: { rootRandomFactory: world.rootRandomFactory },
  });
  const chunk = new ChunkBlocks(chunkX, chunkZ, MIN_Y, HEIGHT, palette);
  const paletteIdBySymbol = world.symbolStates.map((state) => palette.idOf(state));
  for (let index = 0; index < blocks.length; index++) chunk.blocks[index] = paletteIdBySymbol[blocks[index]!]!;
  const surfaceStart = performance.now();
  surfaceSystem.buildSurface({ chunk, router: world.router, biomeAt: world.biomeAtBlock });
  const preCarveBlocks = chunk.blocks.slice();
  const carveStart = performance.now();
  world.carverSystem.applyCarvers({
    chunk,
    aquifer: aquifer!,
    symbolStates: world.symbolStates,
    topMaterial: world.createTopMaterialSource(chunk, world.biomeAtBlock),
  });
  const end = performance.now();
  return { chunk, preCarveBlocks, fillMilliseconds: surfaceStart - fillStart, surfaceMilliseconds: carveStart - surfaceStart, carveMilliseconds: end - carveStart };
}
