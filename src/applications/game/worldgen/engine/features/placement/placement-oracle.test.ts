// Runs every placed feature that a Terralith overworld biome lists on the synthetic world and compares with the
// real 1.20.6 classes (fixtures/features-reference.json.gz, recorded by ../fixtures/FeaturesReference.java with the
// same origin chunk (3, -7), decoration seed and per-step feature index):
//   - the placement modifier chain's positions and the random state afterwards (all 15 modifier types, the
//     int/height providers and block predicates as they occur in production data);
//   - placeWithBiomeCheck's final block writes for features built only from the registered feature types.

import { afterAll, describe, expect, test } from "bun:test";
import { BlockPos } from "../core/block-pos";
import { createDecorationRandom } from "../core/worldgen-random";
import { FeatureDecorator } from "../decoration/feature-decorator";
import { loadFeaturesReference, loadTerralithDatapacks, type RecordedPlacedFeatureRun } from "../testing/feature-fixtures.node";
import { SyntheticWorldSource } from "../testing/synthetic-world";

const startedAt = performance.now();
const reference = loadFeaturesReference();
const datapacks = loadTerralithDatapacks();
const origin = new BlockPos(48, -64, -112);
const JAVA_WRITE_LOG_LIMIT = 4096;
// Registered as deliberate no-ops: they draw random numbers in Java that the port skips (the writes are checked).
const UNPORTED_FEATURE_TYPE_IDS = new Set(["minecraft:monster_room", "minecraft:fossil"]);

function createDecorator(source: SyntheticWorldSource, strict: boolean): FeatureDecorator {
  return new FeatureDecorator({
    source,
    seed: BigInt(1337),
    registries: datapacks.registries,
    blockTags: datapacks.blockTags,
    possibleBiomes: reference.possibleBiomes,
    strict,
  });
}

function seededRandom(run: RecordedPlacedFeatureRun) {
  const random = createDecorationRandom();
  const decorationSeed = random.setDecorationSeed(BigInt(1337), 48, -112);
  random.setFeatureSeed(decorationSeed, run.featureIndex, run.step);
  return random;
}

describe("placement modifiers against the real classes", () => {
  test("every recorded modifier chain yields the same positions and leaves the random in the same state", () => {
    const source = new SyntheticWorldSource("minecraft:plains");
    const decorator = createDecorator(source, false);
    const runs = reference.placedFeatureRuns.filter((run) => run.positions !== undefined);
    expect(runs.length).toBeGreaterThan(400);
    const modifierTypesSeen = new Set<string>();
    const mismatches: string[] = [];
    let totalPositions = 0;
    for (const run of runs) {
      source.biome = run.biome;
      const placed = decorator.placedFeatureByKey(run.id);
      for (const modifier of placed.placement) modifierTypesSeen.add(modifier.type);
      const random = seededRandom(run);
      const region = decorator.createRegion(3, -7);
      const positions = placed.placementPositions(region, decorator.generator, random, origin).slice(0, 512);
      const actual = JSON.stringify(positions.map((position) => [position.x, position.y, position.z]));
      totalPositions += positions.length;
      if (actual !== JSON.stringify(run.positions)) mismatches.push(`${run.id}: ${actual.slice(0, 200)} vs ${JSON.stringify(run.positions).slice(0, 200)}`);
      else if (positions.length < 512 && random.nextLong().toString() !== run.nextLongAfterPositions) mismatches.push(`${run.id}: random state differs after placement`);
    }
    expect(mismatches.slice(0, 10)).toEqual([]);
    expect(totalPositions).toBeGreaterThan(5000);
    // carving_mask is listed by one cave feature but needs a carvers-stage mask, which the fake Java world cannot supply.
    for (const type of ["count", "biome", "in_square", "heightmap", "block_predicate_filter", "height_range", "random_offset", "noise_based_count", "environment_scan", "rarity_filter", "surface_water_depth_filter", "count_on_every_layer", "surface_relative_threshold_filter", "noise_threshold_count"]) {
      expect(modifierTypesSeen.has(`minecraft:${type}`)).toBe(true);
    }
    expect(decorator.diagnostics.parseErrors.size).toBe(0);
  });
});

describe("core feature types against the real classes", () => {
  test("placeWithBiomeCheck writes the same final blocks for every feature built from registered types", () => {
    const source = new SyntheticWorldSource("minecraft:plains");
    const lenient = createDecorator(source, false);
    const strict = createDecorator(source, true);
    const comparable: RecordedPlacedFeatureRun[] = [];
    for (const run of reference.placedFeatureRuns) {
      if (run.writes === undefined) continue;
      // The Java recorder stops logging at 4096 writes, so a longer run has no complete reference to compare.
      if (run.writes.length >= JAVA_WRITE_LOG_LIMIT) continue;
      try {
        strict.placedFeatureByKey(run.id);
        comparable.push(run);
      } catch {
        // uses a feature type another module will register (trees, ores, disks, ...)
      }
    }
    const mismatches: string[] = [];
    let comparedWrites = 0;
    const featureTypesUsed = new Set<string>();
    for (const run of comparable) {
      source.biome = run.biome;
      const placed = lenient.placedFeatureByKey(run.id);
      featureTypesUsed.add(placed.feature.type.id);
      const region = lenient.createRegion(3, -7);
      const random = seededRandom(run);
      const placedResult = placed.placeWithBiomeCheck(region, lenient.generator, random, origin);
      const expected = new Map<string, string>();
      for (const [x, y, z, state] of run.writes!) expected.set(`${x},${y},${z}`, state);
      const actual = new Map<string, string>();
      for (const patch of region.extractPatches()) {
        for (let position = 0; position < patch.indices.length; position++) {
          const index = patch.indices[position]!;
          const y = Math.floor(index / 256) + region.minY;
          const x = patch.chunkX * 16 + (index & 15);
          const z = patch.chunkZ * 16 + ((index >> 4) & 15);
          actual.set(`${x},${y},${z}`, region.blockPalette!.stateOf(patch.paletteIds[position]!));
        }
      }
      comparedWrites += expected.size;
      const expectedText = JSON.stringify([...expected].sort());
      const actualText = JSON.stringify([...actual].sort());
      if (expectedText !== actualText) mismatches.push(`${run.id}: ${actualText.slice(0, 300)} vs ${expectedText.slice(0, 300)}`);
      else if (placedResult !== run.placed) mismatches.push(`${run.id}: placed ${placedResult} vs ${run.placed}`);
      else if (!UNPORTED_FEATURE_TYPE_IDS.has(placed.feature.type.id) && random.nextLong().toString() !== run.nextLongAfterPlacement) mismatches.push(`${run.id}: random state differs`);
    }
    expect(mismatches.slice(0, 10)).toEqual([]);
    expect(comparable.length).toBeGreaterThan(100);
    expect(comparedWrites).toBeGreaterThan(300);
    for (const type of ["random_patch", "flower", "simple_block", "random_selector", "block_column"]) expect(featureTypesUsed.has(`minecraft:${type}`)).toBe(true);
  });
});

afterAll(() => {
  console.log(`placement oracle tests: ${(performance.now() - startedAt).toFixed(0)} ms`);
});
