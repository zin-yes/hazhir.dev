// SurfaceSystem.topMaterial for the carvers: evaluates the noise settings' surface rules at one block with
// stoneDepthAbove = stoneDepthBelow = 1, the way CarvingContext.topMaterial does after a carved surface block, to
// pick the block restored over exposed dirt (grass or mycelium in the biome, usually).

import {
  endWorkerSection,
  isWorkerProfiling,
  startWorkerSampledSection,
  startWorkerSection,
} from "@/applications/game/profiler/worker-recorder";
import type { ChunkBlocks } from "../chunk";
import { blockNameOf } from "../chunk";
import type { JsonObject } from "../registry/datapack-loader";
import { BiomeTemperatureSampler } from "../surface/biome-temperature";
import { compileSurfaceRules, NO_RULE_MATCH, SurfaceResultTable } from "../surface/surface-rule-compiler";
import { NO_WATER_HEIGHT, SurfaceRuleContext, type SurfaceContextServices } from "../surface/surface-rule-context";
import type { SurfaceSystem } from "../surface/surface-system";
import type {
  BiomeAtBlock,
  BiomeClimateLookup,
  SurfaceNoiseRegistry,
  SurfaceNoiseRouter,
  SurfacePositionalRandomFactory,
} from "../surface/surface-types";
import type { TopMaterialSource } from "./carving-context";

export interface TopMaterialConfig {
  /** The seed's SurfaceSystem: depth and secondary noises, clay bands and the preliminary surface level. */
  surfaceSystem: SurfaceSystem;
  surfaceRule: JsonObject;
  noises: SurfaceNoiseRegistry;
  randomFactory: SurfacePositionalRandomFactory;
  router: SurfaceNoiseRouter;
  biomeClimate: BiomeClimateLookup;
}

const TOP_MATERIAL_SAMPLE_EVERY = 8;
const AIR_NAMES = new Set(["minecraft:air", "minecraft:cave_air", "minecraft:void_air"]);

/** Returns a per-chunk factory: `createSource(chunk, biomeAtBlock)` gives the chunk's TopMaterialSource. */
export function createTopMaterialSourceFactory(config: TopMaterialConfig): (chunk: ChunkBlocks, biomeAtBlock: BiomeAtBlock) => TopMaterialSource {
  const resultTable = new SurfaceResultTable();
  if (isWorkerProfiling()) startWorkerSection("carver.compileTopMaterialRules");
  const rule = compileSurfaceRules(config.surfaceRule, {
    noises: config.noises,
    randomFactory: config.randomFactory,
    resultTable,
    getBandResultIndex: (blockX, blockY, blockZ) => config.surfaceSystem.getBandResultIndex(blockX, blockY, blockZ),
  });
  if (isWorkerProfiling()) endWorkerSection();
  const temperatureSampler = new BiomeTemperatureSampler(config.biomeClimate);
  const services: SurfaceContextServices = {
    minY: config.surfaceSystem.minY,
    height: config.surfaceSystem.height,
    getSurfaceDepth: (blockX, blockZ) => config.surfaceSystem.getSurfaceDepth(blockX, blockZ),
    getSurfaceSecondary: (blockX, blockZ) => config.surfaceSystem.getSurfaceSecondary(blockX, blockZ),
    getPreliminarySurfaceLevel: (blockX, blockZ) => config.surfaceSystem.getPreliminarySurfaceLevel(config.router, blockX, blockZ),
    isColdEnoughToSnow: (biomeId, blockX, blockY, blockZ) => temperatureSampler.isColdEnoughToSnow(biomeId, blockX, blockY, blockZ),
  };

  return (chunk, biomeAtBlock) => {
    const isAirId: boolean[] = [];
    const isAir = (paletteId: number): boolean => (isAirId[paletteId] ??= AIR_NAMES.has(blockNameOf(chunk.palette.stateOf(paletteId))));
    // Heightmap.WORLD_SURFACE_WG read live from the chunk, so it always reflects blocks carved so far.
    const heightmap = {
      getHeight(localX: number, localZ: number): number {
        for (let y = chunk.maxY; y >= chunk.minY; y--) {
          if (!isAir(chunk.getId(localX, y, localZ))) return y + 1;
        }
        return chunk.minY;
      },
    };
    const context = new SurfaceRuleContext(services, heightmap, biomeAtBlock);
    return {
      topMaterial(blockX, blockY, blockZ, hasFluid) {
        const isProfiling = isWorkerProfiling();
        if (isProfiling) startWorkerSampledSection("carver.topMaterial", TOP_MATERIAL_SAMPLE_EVERY);
        context.updateXZ(blockX, blockZ);
        context.updateY(1, 1, hasFluid ? blockY + 1 : NO_WATER_HEIGHT, blockX, blockY, blockZ);
        const resultIndex = rule(context);
        if (isProfiling) endWorkerSection();
        return resultIndex === NO_RULE_MATCH ? undefined : resultTable.states[resultIndex];
      },
    };
  };
}
