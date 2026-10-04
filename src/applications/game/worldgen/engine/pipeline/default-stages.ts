// The two base stages: terrain fill (NoiseBasedChunkGenerator.doFill without aquifers/ore veins) and buildSurface.

import { BLOCK_AIR, BLOCK_DEFAULT_BLOCK, BLOCK_DEFAULT_FLUID, BLOCK_LAVA, fillChunkColumn } from "../terrain";
import { createSurfaceSystem, createBiomeClimateLookup, type SurfaceSystem } from "../surface";
import { createRootRandomFactory, NoiseRegistry, type NoiseParameters } from "../noise";
import type { JsonObject } from "../registry/datapack-loader";
import type { ColumnStage, ColumnStageContext } from "./column-stage";
import { LAVA_STATE } from "./noise-settings-reader";

export const NOISE_FILL_STAGE_NAME = "noise-fill";
export const SURFACE_STAGE_NAME = "surface";

/** Maps the terrain stage's symbolic ids (air, default block, default fluid, lava) to palette ids of the noise settings states. */
export function createNoiseFillStage(): ColumnStage {
  return {
    name: NOISE_FILL_STAGE_NAME,
    run(column, context) {
      const { settings } = context;
      const paletteIdBySymbol = new Uint16Array(4);
      paletteIdBySymbol[BLOCK_AIR] = column.palette.idOf("minecraft:air");
      paletteIdBySymbol[BLOCK_DEFAULT_BLOCK] = column.palette.idOf(settings.defaultBlock);
      paletteIdBySymbol[BLOCK_DEFAULT_FLUID] = column.palette.idOf(settings.defaultFluid);
      paletteIdBySymbol[BLOCK_LAVA] = column.palette.idOf(LAVA_STATE);
      const symbols = fillChunkColumn({
        router: context.router,
        chunkX: context.chunkX,
        chunkZ: context.chunkZ,
        minY: settings.minY,
        height: settings.height,
        seaLevel: settings.seaLevel,
      });
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

export function createSeedSurfaceSystem(params: {
  registries: ColumnStageContext["registries"];
  settings: ColumnStageContext["settings"];
  seed: bigint;
}): SurfaceSystem {
  const { registries, settings, seed } = params;
  const parametersById: Record<string, NoiseParameters> = {};
  for (const [noiseId, json] of Object.entries(registries.noise as Record<string, JsonObject>)) {
    parametersById[noiseId] = { firstOctave: json.firstOctave as number, amplitudes: json.amplitudes as number[] };
  }
  const randomFactory = createRootRandomFactory(seed);
  return createSurfaceSystem({
    noises: new NoiseRegistry(parametersById, randomFactory),
    randomFactory,
    surfaceRule: settings.surfaceRule,
    seaLevel: settings.seaLevel,
    defaultBlock: settings.defaultBlock,
    minY: settings.minY,
    height: settings.height,
    biomeClimate: createBiomeClimateLookup(registries.biome),
  });
}
