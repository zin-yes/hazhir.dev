// Profiler plumbing for biome decoration. Every helper is a no-op unless a worker task is profiling.
//
// The recorder credits a section's SELF time to one dimension key, so each dimension gets the section that
// makes its numbers meaningful:
//   feature.placed       worldgenFeature      key = placed feature id: self = placement chain (modifiers), total = all
//   placement.modifier.* worldgenFeature      same key: modifier cost lands on the feature that owns the chain
//   feature.biome        worldgenBiome        key = biome: units = placements, total = all work done in that biome
//   feature.place.<type> worldgenFeatureType  key = feature type id: total is inclusive of nested features, units = blocks the type itself placed
//   feature.body         worldgenBiomeFeature key = `${biome}|${feature}`: self = the feature body (type code,
//                        sub-steps, nested placements), the cross matrix sums to per-biome and per-feature body cost
// Open sections are counted here so a throwing feature can be unwound without leaking the call tree.

import { DIMENSIONS } from "@/applications/game/profiler/dimensions";
import {
  addWorkerCounter,
  addWorkerKeyedUnits,
  endWorkerSection,
  isWorkerProfiling,
  startWorkerSampledSection,
  startWorkerSection,
} from "@/applications/game/profiler/worker-recorder";
import type { WorldGenLevel } from "../level/world-gen-level";

export const NESTED_SAMPLE_EVERY = 32;

export const featureProfileState = {
  openSectionDepth: 0,
  activeFeatureKey: "",
  placementDepth: 0,
  activePairKey: "",
  blocksClaimedByTypes: 0,
};

const UNATTRIBUTED_PAIR_KEY = "unattributed|unattributed";

export function pairKeyForSections(): string {
  return featureProfileState.activePairKey || UNATTRIBUTED_PAIR_KEY;
}

export function blockWritesOf(level: WorldGenLevel): number {
  return level.blockWriteCount ?? 0;
}

export function openFeatureSection(name: string, dimension?: string, key?: string): void {
  startWorkerSection(name, dimension, key);
  featureProfileState.openSectionDepth++;
}

export function openSampledFeatureSection(name: string, sampleEvery: number, dimension?: string, key?: string): void {
  startWorkerSampledSection(name, sampleEvery, dimension, key);
  featureProfileState.openSectionDepth++;
}

export function closeFeatureSection(): void {
  endWorkerSection();
  featureProfileState.openSectionDepth--;
}

/** Closes every section opened since `depth` was read (exception safety for feature code). */
export function recoverOpenSections(depth: number): void {
  while (featureProfileState.openSectionDepth > depth) closeFeatureSection();
}

/** Plain section (decoration step, origin, region work) that is not attributed to a feature type. */
export function startDecorationSection(name: string): void {
  if (isWorkerProfiling()) openFeatureSection(name);
}

export function startSampledDecorationSection(name: string, sampleEvery: number): void {
  if (isWorkerProfiling()) openSampledFeatureSection(name, sampleEvery);
}

const stepSectionNames: string[] = [];

export function stepSectionName(step: number, stepLabel: string | undefined): string {
  let name = stepSectionNames[step];
  if (name === undefined) {
    name = `feature.step.${stepLabel ?? step}`;
    stepSectionNames[step] = name;
  }
  return name;
}

export function endDecorationSection(): void {
  if (isWorkerProfiling()) closeFeatureSection();
}

export function isFeatureProfilingActive(): boolean {
  return isWorkerProfiling();
}

/**
 * Sub-step of a feature type's place(): a section attributed to the running biome x feature pair. Returns the level's
 * block write count so endFeatureStep can report how many blocks the step placed (counter named like the section).
 */
export function startFeatureStep(name: string, level?: WorldGenLevel): number {
  if (!isWorkerProfiling()) return 0;
  openFeatureSection(name, DIMENSIONS.worldgenBiomeFeature, pairKeyForSections());
  return level === undefined ? 0 : blockWritesOf(level);
}

export function endFeatureStep(name: string, level?: WorldGenLevel, writesAtStart = 0): void {
  if (!isWorkerProfiling()) return;
  closeFeatureSection();
  if (level !== undefined) {
    const blocksPlaced = blockWritesOf(level) - writesAtStart;
    if (blocksPlaced > 0) addWorkerCounter(name, blocksPlaced);
  }
}

/** Counter for work that is not blocks (veins, clusters, spread steps). Callers accumulate locally and flush once. */
export function addFeatureCounter(name: string, amount: number): void {
  if (amount !== 0) addWorkerCounter(name, amount);
}

const typePlaceSectionNames = new Map<string, string>();

export function typePlaceSectionName(typeId: string): string {
  let name = typePlaceSectionNames.get(typeId);
  if (name === undefined) {
    name = `feature.place.${typeId.slice(typeId.indexOf(":") + 1)}`;
    typePlaceSectionNames.set(typeId, name);
  }
  return name;
}

interface ModifierTally {
  readonly sectionName: string;
  readonly counterPrefix: string;
  calls: number;
  positionsOut: number;
}

const modifierTallies = new Map<string, ModifierTally>();

export function modifierTallyOf(modifierType: string): ModifierTally {
  let tally = modifierTallies.get(modifierType);
  if (tally === undefined) {
    const shortName = modifierType.slice(modifierType.indexOf(":") + 1);
    tally = { sectionName: `placement.modifier.${shortName}`, counterPrefix: `placement.${shortName}`, calls: 0, positionsOut: 0 };
    modifierTallies.set(modifierType, tally);
  }
  return tally;
}

const typeBlockUnits = new Map<string, number>();

export function addTypeBlockUnits(typeId: string, blocks: number): void {
  typeBlockUnits.set(typeId, (typeBlockUnits.get(typeId) ?? 0) + blocks);
}

const biomeFeatureKeys = new Map<string, Map<string, string>>();

export function biomeFeatureKey(biome: string, featureKey: string): string {
  let byFeature = biomeFeatureKeys.get(biome);
  if (byFeature === undefined) {
    byFeature = new Map();
    biomeFeatureKeys.set(biome, byFeature);
  }
  let key = byFeature.get(featureKey);
  if (key === undefined) {
    key = `${biome}|${featureKey}`;
    byFeature.set(featureKey, key);
  }
  return key;
}

export const placementTally = {
  succeeded: 0,
  failed: 0,
  nestedSucceeded: 0,
  nestedFailed: 0,
};

const biomePlacementUnits = new Map<string, number>();

export function addBiomePlacementUnit(biome: string): void {
  biomePlacementUnits.set(biome, (biomePlacementUnits.get(biome) ?? 0) + 1);
}

/** Flushed after every top-level placement: the biome units that are accumulated locally while placing. */
export function flushPlacementUnits(): void {
  for (const [typeId, blocks] of typeBlockUnits) addWorkerKeyedUnits(DIMENSIONS.worldgenFeatureType, typeId, blocks);
  typeBlockUnits.clear();
  for (const [biome, placements] of biomePlacementUnits) addWorkerKeyedUnits(DIMENSIONS.worldgenBiome, biome, placements);
  biomePlacementUnits.clear();
}

/** Flushed once per decorated origin: modifier pass rates, placement outcomes and region traffic. */
export function flushOriginCounters(level: WorldGenLevel): void {
  for (const tally of modifierTallies.values()) {
    if (tally.calls === 0) continue;
    addWorkerCounter(`${tally.counterPrefix}.calls`, tally.calls);
    addWorkerCounter(`${tally.counterPrefix}.positionsOut`, tally.positionsOut);
    tally.calls = 0;
    tally.positionsOut = 0;
  }
  addWorkerCounter("decoration.placementsSucceeded", placementTally.succeeded);
  addWorkerCounter("decoration.placementsFailed", placementTally.failed);
  addWorkerCounter("decoration.nestedPlacementsSucceeded", placementTally.nestedSucceeded);
  addWorkerCounter("decoration.nestedPlacementsFailed", placementTally.nestedFailed);
  placementTally.succeeded = 0;
  placementTally.failed = 0;
  placementTally.nestedSucceeded = 0;
  placementTally.nestedFailed = 0;
  level.flushProfileCounters?.();
}

/** Drops state left behind by an aborted task so the next one starts clean. */
export function resetFeatureProfileState(): void {
  featureProfileState.blocksClaimedByTypes = 0;
  featureProfileState.activeFeatureKey = "";
  featureProfileState.placementDepth = 0;
  featureProfileState.activePairKey = "";
  biomePlacementUnits.clear();
  typeBlockUnits.clear();
  for (const tally of modifierTallies.values()) {
    tally.calls = 0;
    tally.positionsOut = 0;
  }
  placementTally.succeeded = 0;
  placementTally.failed = 0;
  placementTally.nestedSucceeded = 0;
  placementTally.nestedFailed = 0;
}
