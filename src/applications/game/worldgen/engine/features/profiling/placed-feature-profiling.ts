// The profiled twin of PlacedFeature's placement walk and ConfiguredFeature.place. Only entered while a worker
// task is profiling; it performs exactly the same calls in the same order (output and RNG draws are identical)
// and adds sections, tallies and keyed units around them. Top-level placements (from the decorator) get full
// biome/feature attribution; placements nested inside composite features (random_patch, selectors) are sampled.

import { DIMENSIONS } from "@/applications/game/profiler/dimensions";
import { addWorkerKeyedUnits } from "@/applications/game/profiler/worker-recorder";
import type { RandomSource } from "../../random";
import { BlockPos } from "../core/block-pos";
import type { ConfiguredFeature, PlacedFeature } from "../feature/placed-feature";
import type { FeatureChunkGenerator } from "../feature/feature-type";
import type { WorldGenLevel } from "../level/world-gen-level";
import type { PlacementContext } from "../placement/placement-modifier";
import {
  NESTED_SAMPLE_EVERY,
  addBiomePlacementUnit,
  addTypeBlockUnits,
  biomeFeatureKey,
  blockWritesOf,
  chainTallyOf,
  closeFeatureSection,
  featureOutcomeKey,
  featureProfileState,
  flushPlacementUnits,
  modifierTallyOf,
  openFeatureSection,
  openSampledFeatureSection,
  pairKeyForSections,
  placementTally,
  recoverOpenSections,
  typePlaceSectionName,
} from "./feature-profiling";

function outcomeName(placed: boolean, isNested: boolean): string {
  if (isNested) return placed ? "placedNested" : "rejectedNested";
  return placed ? "placed" : "rejected";
}

export function placeConfiguredFeatureProfiled(
  feature: ConfiguredFeature,
  level: WorldGenLevel,
  generator: FeatureChunkGenerator,
  random: RandomSource,
  origin: BlockPos,
): boolean {
  const typeId = feature.type.id;
  const isNested = featureProfileState.placementDepth > 1;
  const sampleEvery = isNested ? NESTED_SAMPLE_EVERY : 1;
  const savedSectionDepth = featureProfileState.openSectionDepth;
  const writesBefore = blockWritesOf(level);
  const claimedBefore = featureProfileState.blocksClaimedByTypes;
  const previousTypeId = featureProfileState.activeTypeId;
  featureProfileState.activeTypeId = typeId;
  openSampledFeatureSection(typePlaceSectionName(typeId), sampleEvery, DIMENSIONS.worldgenFeatureType, typeId);
  openSampledFeatureSection("feature.body", sampleEvery, DIMENSIONS.worldgenBiomeFeature, pairKeyForSections());
  let placed = false;
  try {
    placed = feature.type.place({ level, generator, random, origin, config: feature.config });
  } finally {
    recoverOpenSections(savedSectionDepth);
    featureProfileState.activeTypeId = previousTypeId;
  }
  addWorkerKeyedUnits(DIMENSIONS.worldgenFeatureOutcome, featureOutcomeKey(typeId, outcomeName(placed, isNested)), 1);
  const blocksWritten = blockWritesOf(level) - writesBefore;
  const ownBlocks = blocksWritten - (featureProfileState.blocksClaimedByTypes - claimedBefore);
  featureProfileState.blocksClaimedByTypes = claimedBefore + blocksWritten;
  if (ownBlocks > 0) addTypeBlockUnits(typeId, ownBlocks);
  if (isNested) {
    if (placed) placementTally.nestedSucceeded++;
    else placementTally.nestedFailed++;
  } else if (placed) placementTally.succeeded++;
  else placementTally.failed++;
  return placed;
}

export function placePlacedFeatureProfiled(
  placedFeature: PlacedFeature,
  context: PlacementContext,
  random: RandomSource,
  origin: BlockPos,
): boolean {
  const isTopLevel = featureProfileState.placementDepth === 0;
  const savedSectionDepth = featureProfileState.openSectionDepth;
  const previousFeatureKey = featureProfileState.activeFeatureKey;
  const writesBefore = blockWritesOf(context.level);
  let placedAny = false;
  featureProfileState.placementDepth++;
  if (isTopLevel) {
    featureProfileState.activeFeatureKey = placedFeature.key;
    openFeatureSection("feature.placed", DIMENSIONS.worldgenFeature, placedFeature.key);
  }
  try {
    placedAny = walkPositionsProfiled(placedFeature, context, random, origin, isTopLevel);
  } finally {
    featureProfileState.placementDepth--;
    recoverOpenSections(savedSectionDepth);
    featureProfileState.activeFeatureKey = previousFeatureKey;
  }
  if (isTopLevel) {
    addWorkerKeyedUnits(DIMENSIONS.worldgenFeature, placedFeature.key, blockWritesOf(context.level) - writesBefore);
    flushPlacementUnits();
  }
  return placedAny;
}

function walkPositionsProfiled(placedFeature: PlacedFeature, context: PlacementContext, random: RandomSource, origin: BlockPos, isTopLevel: boolean): boolean {
  const modifiers = placedFeature.placement;
  let placedAny = false;

  const visit = (modifierIndex: number, position: BlockPos): void => {
    if (modifierIndex === modifiers.length) {
      if (placeAtPosition(placedFeature, context, random, position, isTopLevel)) placedAny = true;
      return;
    }
    const modifier = modifiers[modifierIndex]!;
    const tally = modifierTallyOf(modifier.type);
    const nextPositions = modifier.getPositions(context, random, position);
    tally.calls++;
    tally.positionsOut += nextPositions.length;
    if (isTopLevel) {
      const chainTally = chainTallyOf(placedFeature.key, modifier.type);
      chainTally.positionsIn++;
      chainTally.positionsOut += nextPositions.length;
    }
    for (const next of nextPositions) visit(modifierIndex + 1, next);
  };
  visit(0, origin instanceof BlockPos ? origin : BlockPos.of(origin));
  return placedAny;
}

function placeAtPosition(placedFeature: PlacedFeature, context: PlacementContext, random: RandomSource, position: BlockPos, isTopLevel: boolean): boolean {
  const level = context.level;
  if (!isTopLevel) return placedFeature.feature.place(level, context.generator, random, position);
  const biome = context.lastCheckedBiome ?? level.getBiome(position.x, position.y, position.z);
  const writesBefore = blockWritesOf(level);
  openFeatureSection("feature.biome", DIMENSIONS.worldgenBiome, biome);
  const pairKey = biomeFeatureKey(biome, placedFeature.key);
  featureProfileState.activePairKey = pairKey;
  const placed = placedFeature.feature.place(level, context.generator, random, position);
  featureProfileState.activePairKey = "";
  closeFeatureSection();
  addWorkerKeyedUnits(DIMENSIONS.worldgenBiomeFeature, pairKey, blockWritesOf(level) - writesBefore);
  addBiomePlacementUnit(biome);
  return placed;
}
