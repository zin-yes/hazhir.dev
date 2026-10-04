// The pipeline stages: terrain fill (NoiseBasedChunkGenerator.doFill, optionally with aquifers and ore veins),
// buildSurface, and the air carvers (applyCarvers).

import { createTopMaterialSourceFactory, type CarverSystem } from "../carvers";
import { createSurfaceSystem, createBiomeClimateLookup, type SurfaceSystem } from "../surface";
import { NoiseRegistry, type NoiseParameters } from "../noise";
import type { PositionalRandomFactory } from "../random";
import { fillChunkColumnDetailed, terrainSymbolStates } from "../terrain";
import type { JsonObject } from "../registry/datapack-loader";
import type { ColumnStage, ColumnStageContext } from "./column-stage";

export const NOISE_FILL_STAGE_NAME = "noise-fill";
export const SURFACE_STAGE_NAME = "surface";
export const CARVERS_STAGE_NAME = "carvers";

export interface NoiseFillStageOptions {
  /** Enables aquifers and ore veins (the real doFill material rules); the aquifer is handed on through the stage context. */
  aquifers?: { rootRandomFactory: PositionalRandomFactory };
}

/** Maps the terrain stage's symbolic ids (air, fluids, ore vein blocks) to palette ids of the noise settings states. */
export function createNoiseFillStage(options: NoiseFillStageOptions = {}): ColumnStage {
  return {
    name: NOISE_FILL_STAGE_NAME,
    run(column, context) {
      const { settings } = context;
      const paletteIdBySymbol = terrainSymbolStates(settings.defaultBlock, settings.defaultFluid).map((state) => column.palette.idOf(state));
      const { blocks: symbols, aquifer } = fillChunkColumnDetailed({
        router: context.router,
        chunkX: context.chunkX,
        chunkZ: context.chunkZ,
        minY: settings.minY,
        height: settings.height,
        seaLevel: settings.seaLevel,
        aquifers: options.aquifers,
      });
      context.aquifer = aquifer;
      const blocks = column.blocks;
      for (let index = 0; index < symbols.length; index++) blocks[index] = paletteIdBySymbol[symbols[index]!]!;
    },
  };
}

export function createSurfaceStage(surfaceSystem: SurfaceSystem): ColumnStage {
  return {
    name: SURFACE_STAGE_NAME,
    run(column, context) {
      surfaceSystem.buildSurface({ chunk: column, router: context.router, biomeAt: context.biomeAt });
    },
  };
}

/** The seed's surface system plus the pieces the carvers' top material lookup shares with it. */
export interface SeedSurfaceSystem {
  surfaceSystem: SurfaceSystem;
  noises: NoiseRegistry;
  randomFactory: PositionalRandomFactory;
  biomeClimate: ReturnType<typeof createBiomeClimateLookup>;
}

export function createSeedSurfaceSystem(params: {
  registries: ColumnStageContext["registries"];
  settings: ColumnStageContext["settings"];
  randomFactory: PositionalRandomFactory;
}): SeedSurfaceSystem {
  const { registries, settings, randomFactory } = params;
  const parametersById: Record<string, NoiseParameters> = {};
  for (const [noiseId, json] of Object.entries(registries.noise as Record<string, JsonObject>)) {
    parametersById[noiseId] = { firstOctave: json.firstOctave as number, amplitudes: json.amplitudes as number[] };
  }
  const noises = new NoiseRegistry(parametersById, randomFactory);
  const biomeClimate = createBiomeClimateLookup(registries.biome);
  const surfaceSystem = createSurfaceSystem({
    noises,
    randomFactory,
    surfaceRule: settings.surfaceRule,
    seaLevel: settings.seaLevel,
    defaultBlock: settings.defaultBlock,
    minY: settings.minY,
    height: settings.height,
    biomeClimate,
  });
  return { surfaceSystem, noises, randomFactory, biomeClimate };
}

export function createCarverStage(params: {
  carverSystem: CarverSystem;
  seedSurface: SeedSurfaceSystem;
  settings: ColumnStageContext["settings"];
  router: ColumnStageContext["router"];
}): ColumnStage {
  const { carverSystem, seedSurface, settings, router } = params;
  const symbolStates = terrainSymbolStates(settings.defaultBlock, settings.defaultFluid);
  const createTopMaterialSource = createTopMaterialSourceFactory({
    surfaceSystem: seedSurface.surfaceSystem,
    surfaceRule: settings.surfaceRule,
    noises: seedSurface.noises,
    randomFactory: seedSurface.randomFactory,
    router,
    biomeClimate: seedSurface.biomeClimate,
  });
  return {
    name: CARVERS_STAGE_NAME,
    run(column, context) {
      if (context.aquifer === undefined) throw new Error("The carvers stage needs the aquifer of the noise fill stage (enable aquifers there)");
      context.carvingMask = carverSystem.applyCarvers({
        chunk: column,
        aquifer: context.aquifer,
        symbolStates,
        topMaterial: createTopMaterialSource(column, context.biomeAt),
      });
    },
  };
}
