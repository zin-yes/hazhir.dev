// Per-seed engine instances for the game (one set per thread): the full generator used for chunk blocks, and a
// terrain-only generator (noise fill without biomes-to-surface work) that answers cheap ground-height questions.

import {
  createNoiseFillStage,
  createOverworldGenerator,
  type ColumnStage,
  type OverworldGenerator,
} from "./engine/pipeline";
import { loadTerralithRegistries } from "./terralith/load-terralith-registries";

const MAX_CACHED_SEEDS = 2;
const FULL_GENERATOR_CACHED_COLUMNS = 96;
const TERRAIN_ONLY_GENERATOR_CACHED_COLUMNS = 24;

/**
 * Registration point for stages that are not part of the base pipeline (aquifers, carvers, features). Each entry is
 * spliced into the full generator's stage list after the stage named `insertAfterStageName`.
 */
export interface AdditionalStageRegistration {
  insertAfterStageName: string;
  createStage(): ColumnStage;
}
export const ADDITIONAL_STAGE_REGISTRATIONS: AdditionalStageRegistration[] = [];

function createFullGenerator(seed: number): OverworldGenerator {
  const { registries, overworldDimension } = loadTerralithRegistries();
  const generator = createOverworldGenerator({
    registries,
    overworldDimension,
    seed: BigInt(Math.trunc(seed)),
    maxCachedColumns: FULL_GENERATOR_CACHED_COLUMNS,
  });
  for (const registration of ADDITIONAL_STAGE_REGISTRATIONS) {
    const anchorIndex = generator.stages.findIndex((stage) => stage.name === registration.insertAfterStageName);
    if (anchorIndex === -1) throw new Error(`No stage named "${registration.insertAfterStageName}" to insert after`);
    generator.stages.splice(anchorIndex + 1, 0, registration.createStage());
  }
  return generator;
}

function createTerrainOnlyGenerator(seed: number): OverworldGenerator {
  const { registries, overworldDimension } = loadTerralithRegistries();
  return createOverworldGenerator({
    registries,
    overworldDimension,
    seed: BigInt(Math.trunc(seed)),
    stages: [createNoiseFillStage()],
    maxCachedColumns: TERRAIN_ONLY_GENERATOR_CACHED_COLUMNS,
  });
}

const generatorsBySeed = new Map<number, { full?: OverworldGenerator; terrainOnly?: OverworldGenerator }>();

function entryForSeed(seed: number) {
  let entry = generatorsBySeed.get(seed);
  if (entry === undefined) {
    entry = {};
    if (generatorsBySeed.size >= MAX_CACHED_SEEDS) generatorsBySeed.delete(generatorsBySeed.keys().next().value as number);
  } else {
    generatorsBySeed.delete(seed);
  }
  generatorsBySeed.set(seed, entry);
  return entry;
}

export function getFullGenerator(seed: number): OverworldGenerator {
  const entry = entryForSeed(seed);
  return (entry.full ??= createFullGenerator(seed));
}

export function getTerrainOnlyGenerator(seed: number): OverworldGenerator {
  const entry = entryForSeed(seed);
  return (entry.terrainOnly ??= createTerrainOnlyGenerator(seed));
}
