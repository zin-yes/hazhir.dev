// Per-seed worldgen pieces the LOD sampler reads, built once per thread from the engine's public building blocks:
// the noise router (final density with column memos), the climate sampler and biome table, and the compiled surface
// rules with the noises and temperature model they need. Nothing here generates chunks.

import { addWorkerCounter, workerSection } from "../../profiler/worker-recorder";
import { createNoiseRouter } from "../../worldgen/engine/density";
import { MultiNoiseBiomeSource } from "../../worldgen/engine/biome-source";
import { createRootRandomFactory, NoiseRegistry, type NoiseParameters } from "../../worldgen/engine/noise";
import { readOverworldSettings, type OverworldSettings } from "../../worldgen/engine/pipeline/noise-settings-reader";
import type { JsonObject } from "../../worldgen/engine/registry/datapack-loader";
import {
  compileSurfaceRules,
  createBiomeClimateLookup,
  createSurfaceSystem,
  SurfaceResultTable,
  type SurfaceSystem,
} from "../../worldgen/engine/surface";
import { BiomeTemperatureSampler } from "../../worldgen/engine/surface/biome-temperature";
import type { SurfaceRule } from "../../worldgen/engine/surface/surface-rule-compiler";
import { loadTerralithRegistries } from "../../worldgen/terralith/load-terralith-registries";
import { createColumnCachedRouter, type ColumnClimateSampler, type ColumnDensity } from "./column-cached-density";

export interface SeedWorldgenContext {
  readonly seed: number;
  readonly settings: OverworldSettings;
  readonly density: ColumnDensity;
  readonly climateSampler: ColumnClimateSampler;
  readonly biomeSource: MultiNoiseBiomeSource;
  readonly surfaceSystem: SurfaceSystem;
  readonly surfaceRule: SurfaceRule;
  readonly surfaceResults: SurfaceResultTable;
  readonly temperature: BiomeTemperatureSampler;
}

const MAX_CACHED_SEEDS = 2;
const contextsBySeed = new Map<number, SeedWorldgenContext>();

function createSeedWorldgenContext(seed: number): SeedWorldgenContext {
  const { registries, overworldDimension } = workerSection("lod.context.registries", () => loadTerralithRegistries());
  const settings = readOverworldSettings(registries, overworldDimension);
  const seedBigInt = BigInt(Math.trunc(seed));
  const router = workerSection("lod.context.noiseRouter", () =>
    createNoiseRouter({ registries, noiseSettingsId: settings.noiseSettingsId, seed: seedBigInt }),
  );
  const randomFactory = createRootRandomFactory(seedBigInt);
  const noises = workerSection("lod.context.noises", () => {
    const parametersById: Record<string, NoiseParameters> = {};
    for (const [noiseId, json] of Object.entries(registries.noise as Record<string, JsonObject>)) {
      parametersById[noiseId] = { firstOctave: json.firstOctave as number, amplitudes: json.amplitudes as number[] };
    }
    return new NoiseRegistry(parametersById, randomFactory);
  });
  const biomeClimate = createBiomeClimateLookup(registries.biome);
  const surfaceSystem = workerSection("lod.context.surfaceSystem", () =>
    createSurfaceSystem({
      noises,
      randomFactory,
      surfaceRule: settings.surfaceRule,
      seaLevel: settings.seaLevel,
      defaultBlock: settings.defaultBlock,
      minY: settings.minY,
      height: settings.height,
      biomeClimate,
    }),
  );
  const surfaceResults = new SurfaceResultTable();
  const surfaceRule = workerSection("lod.context.surfaceRules", () =>
    compileSurfaceRules(settings.surfaceRule, {
      noises,
      randomFactory,
      resultTable: surfaceResults,
      getBandResultIndex: (blockX, blockY, blockZ) => surfaceResults.indexOf(surfaceSystem.getBandState(blockX, blockY, blockZ)),
    }),
  );
  const columnCachedRouter = workerSection("lod.context.columnCache", () => createColumnCachedRouter(router));
  const biomeSource = workerSection(
    "lod.context.biomeSource",
    () => new MultiNoiseBiomeSource((overworldDimension.generator as JsonObject).biome_source as JsonObject),
  );
  return {
    seed,
    settings,
    density: columnCachedRouter.density,
    climateSampler: columnCachedRouter.climate,
    biomeSource,
    surfaceSystem,
    surfaceRule,
    surfaceResults,
    temperature: new BiomeTemperatureSampler(biomeClimate),
  };
}

export function getSeedWorldgenContext(seed: number): SeedWorldgenContext {
  let context = contextsBySeed.get(seed);
  if (context === undefined) {
    if (contextsBySeed.size >= MAX_CACHED_SEEDS) contextsBySeed.delete(contextsBySeed.keys().next().value as number);
    context = workerSection("lod.context.create", () => createSeedWorldgenContext(seed));
    contextsBySeed.set(seed, context);
    addWorkerCounter("lodWorldgenContextsCreated", 1);
  } else {
    addWorkerCounter("lodWorldgenContextHits", 1);
  }
  return context;
}
