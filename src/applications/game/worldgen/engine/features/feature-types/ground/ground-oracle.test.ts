// Runs every configured feature of the ground feature types (vanilla and Terralith) at several origins in three
// synthetic scenario worlds and compares with the real 1.20.6 classes (fixtures/ground-reference.json.gz, recorded
// by fixtures/GroundReference.java): the return value, the final block written at every position, and the random
// state afterwards (so the number of draws matches too). Features that nest a feature type outside the core and
// ground registries (trees, ores, ...) are skipped.

import { afterAll, describe, expect, test } from "bun:test";
import { BlockStateCatalog, BlockTagIndex, SurvivalRules } from "../../../block-state";
import { BlockPos } from "../../core/block-pos";
import { createDecorationRandom } from "../../core/worldgen-random";
import { FeatureResolver } from "../../feature/feature-parser";
import { type AnyFeatureType, type FeatureChunkGenerator, FeatureTypeRegistry } from "../../feature/feature-type";
import type { ConfiguredFeature } from "../../feature/placed-feature";
import { DecorationRegion } from "../../level/decoration-region";
import { loadTerralithDatapacks } from "../../testing/feature-fixtures.node";
import { CORE_FEATURE_TYPES } from "../index";
import { GROUND_FEATURE_TYPES } from "./index";
import { loadGroundReference, type RecordedGroundRun } from "./testing/ground-reference.node";
import { loadNormalizedBlockTags } from "./testing/normalized-block-tags.node";
import { SCENARIO_NAMES, ScenarioWorldSource, scenarioTerrain, TERRAIN_PALETTE } from "./testing/scenario-world";

const startedAt = performance.now();

const reference = loadGroundReference();
const datapacks = loadTerralithDatapacks();

const blockStates = new BlockStateCatalog({ strict: true });
const survival = new SurvivalRules(blockStates);
const blockTags = new BlockTagIndex(loadNormalizedBlockTags());
const successfulPlacementsByType = new Map<string, number>();
const countedGroundTypes: AnyFeatureType[] = GROUND_FEATURE_TYPES.map((type) => ({
  id: type.id,
  parseConfig: (json, parser) => type.parseConfig(json, parser),
  place: (context) => {
    const placed = type.place(context);
    if (placed) successfulPlacementsByType.set(type.id, (successfulPlacementsByType.get(type.id) ?? 0) + 1);
    return placed;
  },
}));
const featureTypes = new FeatureTypeRegistry([...CORE_FEATURE_TYPES, ...countedGroundTypes]);
const resolver = new FeatureResolver({ registries: datapacks.registries, blockStates, featureTypes, strict: true });
const generator: FeatureChunkGenerator = { minY: -64, genDepth: 384, seaLevel: 63, biomeHasFeature: () => true };
const sources = SCENARIO_NAMES.map((_, scenario) => new ScenarioWorldSource(scenario));

const resolvableFeatures = new Map<string, ConfiguredFeature>();
const skippedFeatures: string[] = [];
for (const featureId of reference.featureIds) {
  try {
    resolvableFeatures.set(featureId, resolver.configuredFeature(featureId));
  } catch {
    skippedFeatures.push(featureId);
  }
}

function runFeature(run: RecordedGroundRun, configured: ConfiguredFeature) {
  const origin = reference.origins[run.scenario]![run.originIndex]!;
  const region = new DecorationRegion({ source: sources[run.scenario]!, seed: BigInt(1337), centerChunkX: 3, centerChunkZ: -7, blockStates, blockTags, survival });
  const random = createDecorationRandom();
  const decorationSeed = random.setDecorationSeed(BigInt(1337), 48, -112);
  random.setFeatureSeed(decorationSeed, run.featureIndex, reference.step);
  const placed = configured.place(region, generator, random, new BlockPos(origin[0]!, origin[1]!, origin[2]!));
  const actualWrites = new Map<string, string>();
  for (const patch of region.extractPatches()) {
    for (let position = 0; position < patch.indices.length; position++) {
      const index = patch.indices[position]!;
      const y = Math.floor(index / 256) + region.minY;
      const x = patch.chunkX * 16 + (index & 15);
      const z = patch.chunkZ * 16 + ((index >> 4) & 15);
      actualWrites.set(`${x - origin[0]!},${y - origin[1]!},${z - origin[2]!}`, region.blockPalette!.stateOf(patch.paletteIds[position]!));
    }
  }
  return { placed, actualWrites, nextLong: random.nextLong().toString() };
}

describe("scenario worlds", () => {
  test("the TypeScript terrain matches the terrain Java decorated", () => {
    expect(reference.terrainSamples.length).toBeGreaterThan(2000);
    const mismatches = reference.terrainSamples.filter(([scenario, x, y, z, paletteIndex]) => scenarioTerrain(scenario, x, y, z) !== paletteIndex);
    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(TERRAIN_PALETTE.length).toBe(reference.palette.length);
    const distinctBlocks = new Set(reference.terrainSamples.map((sample) => sample[4]));
    expect(distinctBlocks.size).toBeGreaterThanOrEqual(20);
  });
});

describe("ground feature types against the real classes", () => {
  test("every resolvable configured feature places the same blocks and consumes the same randomness", () => {
    const mismatches: string[] = [];
    let comparedWrites = 0;
    let comparedRuns = 0;
    for (const run of reference.runs) {
      const configured = resolvableFeatures.get(run.feature);
      if (!configured || run.error !== undefined) continue;
      comparedRuns++;
      const expectedWrites = new Map<string, string>();
      for (let index = 0; index < run.writes!.length; index += 4) {
        expectedWrites.set(`${run.writes![index]},${run.writes![index + 1]},${run.writes![index + 2]}`, reference.states[run.writes![index + 3]!]!);
      }
      let actual: ReturnType<typeof runFeature>;
      try {
        actual = runFeature(run, configured);
      } catch (error) {
        mismatches.push(`${run.feature} scenario ${run.scenario} origin ${run.originIndex}: threw ${(error as Error).message}`);
        continue;
      }
      comparedWrites += expectedWrites.size;
      const expectedText = JSON.stringify([...expectedWrites].sort());
      const actualText = JSON.stringify([...actual.actualWrites].sort());
      const label = `${run.feature} scenario ${SCENARIO_NAMES[run.scenario]} origin ${run.originIndex}`;
      if (expectedText !== actualText) mismatches.push(`${label}: writes ${actualText.slice(0, 240)} vs ${expectedText.slice(0, 240)}`);
      else if (actual.placed !== run.placed) mismatches.push(`${label}: placed ${actual.placed} vs ${run.placed}`);
      else if (actual.nextLong !== run.nextLong) mismatches.push(`${label}: random state differs`);
    }
    expect(mismatches.slice(0, 12)).toEqual([]);
    expect(comparedRuns).toBeGreaterThan(2000);
    expect(comparedWrites).toBeGreaterThan(50000);
    console.log(`ground oracle: ${comparedRuns} runs, ${comparedWrites} written blocks, ${resolvableFeatures.size}/${reference.featureIds.length} features resolvable, skipped ${skippedFeatures.length}`);
    console.log(`successful placements by type: ${JSON.stringify(Object.fromEntries(successfulPlacementsByType))}`);
    // Every ported type must have placed something, otherwise the comparison above says nothing about it.
    const minimumPlacements: Record<string, number> = {
      "minecraft:disk": 50,
      "minecraft:vegetation_patch": 50,
      "minecraft:waterlogged_vegetation_patch": 3,
      "minecraft:multiface_growth": 20,
      "minecraft:vines": 10,
      "minecraft:bamboo": 10,
      "minecraft:seagrass": 10,
      "minecraft:kelp": 3,
      "minecraft:sea_pickle": 3,
      "minecraft:coral_tree": 2,
      "minecraft:coral_claw": 2,
      "minecraft:coral_mushroom": 2,
      "minecraft:spring_feature": 3,
      "minecraft:sculk_patch": 10,
      "minecraft:block_pile": 20,
    };
    for (const [typeId, minimum] of Object.entries(minimumPlacements)) {
      const placements = successfulPlacementsByType.get(typeId) ?? 0;
      expect(placements >= minimum ? "enough placements" : `${typeId} placed only ${placements} times (needs ${minimum})`).toBe("enough placements");
    }
  });
});

afterAll(() => {
  console.log(`ground oracle tests: ${(performance.now() - startedAt).toFixed(0)} ms`);
});
