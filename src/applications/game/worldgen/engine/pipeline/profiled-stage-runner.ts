// Runs the column stages while a worker profile is being recorded: every stage gets a section named after it, tagged
// in three breakdowns (stage, biome, biome x stage) with the biome at the column center. The stage sections nest as
// pipeline.biome > pipeline.biomeStage > <stage name>, so each dimension's inclusive time (totalMs) is the stage's
// full cost. Density evaluations are counted per stage and flushed once when the stage ends.

import { DIMENSIONS } from "@/applications/game/profiler/dimensions";
import {
  addWorkerCounter,
  addWorkerKeyedUnits,
  endWorkerSection,
  startWorkerSection,
} from "@/applications/game/profiler/worker-recorder";
import type { ChunkBlocks } from "../chunk";
import { getPreliminarySurfaceLevelCache } from "../terrain";
import { startDensityEvaluationCounting, stopDensityEvaluationCounting } from "../density/density-evaluation-counter";
import type { ColumnStage, ColumnStageContext } from "./column-stage";

const COLUMN_CENTER_OFFSET = 8;
const QUARTS_PER_CHUNK_SIDE = 4;
const NOISE_CELL_HEIGHT = 4;
const NO_SURFACE_LEVEL = 2147483647;

/**
 * The column's biome is the one at its center at the preliminary surface height (the surface biome, not a cave biome).
 * The biome grids of the column and its eight neighbors are filled here, before any stage runs, because the surface
 * stage would otherwise trigger the neighbor fills lazily inside its own sampled sections and skew their estimates.
 * Grid contents do not depend on fill order, so this never changes the generated blocks.
 */
function resolveColumnBiome(context: ColumnStageContext): string {
  startWorkerSection("pipeline.resolveColumnBiome");
  try {
    for (let neighborX = -1; neighborX <= 1; neighborX++) {
      for (let neighborZ = -1; neighborZ <= 1; neighborZ++) {
        context.rawBiomeAtQuart((context.chunkX + neighborX) * QUARTS_PER_CHUNK_SIDE, 0, (context.chunkZ + neighborZ) * QUARTS_PER_CHUNK_SIDE);
      }
    }
    const centerX = context.chunkX * 16 + COLUMN_CENTER_OFFSET;
    const centerZ = context.chunkZ * 16 + COLUMN_CENTER_OFFSET;
    const { minY, height, seaLevel } = context.settings;
    const surfaceLevel = getPreliminarySurfaceLevelCache(context.router, minY, height, NOISE_CELL_HEIGHT).get(centerX, centerZ);
    return context.biomeAt(centerX, surfaceLevel === NO_SURFACE_LEVEL ? seaLevel : surfaceLevel, centerZ);
  } finally {
    endWorkerSection();
  }
}

export function runStagesWithProfiling(stages: readonly ColumnStage[], column: ChunkBlocks, context: ColumnStageContext): void {
  const biome = resolveColumnBiome(context);
  addWorkerCounter("columnsGenerated", 1);
  addWorkerKeyedUnits(DIMENSIONS.worldgenBiome, biome, 1);
  for (const stage of stages) {
    const stageName = stage.name;
    const biomeStageKey = `${biome}|${stageName}`;
    addWorkerKeyedUnits(DIMENSIONS.worldgenStage, stageName, 1);
    addWorkerKeyedUnits(DIMENSIONS.worldgenBiomeStage, biomeStageKey, 1);
    startWorkerSection("pipeline.biome", DIMENSIONS.worldgenBiome, biome);
    startWorkerSection("pipeline.biomeStage", DIMENSIONS.worldgenBiomeStage, biomeStageKey);
    startWorkerSection(stageName, DIMENSIONS.worldgenStage, stageName);
    startDensityEvaluationCounting();
    try {
      stage.run(column, context);
    } finally {
      stopDensityEvaluationCounting();
      endWorkerSection();
      endWorkerSection();
      endWorkerSection();
    }
  }
}
