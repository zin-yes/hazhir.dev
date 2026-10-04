// Every block a ground feature can place in the Terralith overworld must be accepted by toGameBlock, which throws
// on names it does not know. "Can place" is the closure of the biomes' placed features over nested features and
// state providers, the tag-driven corals, the blocks the feature classes place on their own, and the exact states
// the real classes wrote in the oracle scenarios for those features.

import { afterAll, describe, expect, test } from "bun:test";
import { toGameBlock } from "../../../blocks/minecraft-block-map";
import { loadFeaturesReference, loadTerralithDatapacks } from "../../testing/feature-fixtures.node";
import { collectFeatureClosure } from "./testing/feature-closure";
import { loadGroundReference } from "./testing/ground-reference.node";
import { loadNormalizedBlockTags } from "./testing/normalized-block-tags.node";

const startedAt = performance.now();
const datapacks = loadTerralithDatapacks();

/** Block names and configured feature ids reachable from the overworld biomes' placed features. */
function collectReachablePlaceableBlocks(): { blockNames: Set<string>; configuredFeatureIds: Set<string> } {
  const rootPlacedFeatureIds: string[] = [];
  for (const biomeId of loadFeaturesReference().possibleBiomes) {
    for (const step of datapacks.registries.biome[biomeId]!.features as string[][]) rootPlacedFeatureIds.push(...step);
  }
  return collectFeatureClosure(datapacks.registries, rootPlacedFeatureIds);
}

/** Blocks the feature classes place without reading them from the configuration. */
const BLOCKS_PLACED_BY_FEATURE_CODE = [
  "minecraft:vine", "minecraft:bamboo", "minecraft:podzol", "minecraft:seagrass", "minecraft:tall_seagrass", "minecraft:kelp", "minecraft:kelp_plant",
  "minecraft:sea_pickle", "minecraft:sculk", "minecraft:sculk_vein", "minecraft:sculk_catalyst", "minecraft:sculk_shrieker", "minecraft:sculk_sensor",
  "minecraft:glow_lichen", "minecraft:water", "minecraft:lava", "minecraft:air",
];

describe("blocks placed by the ground feature types", () => {
  test("toGameBlock accepts every reachable block name and every state the oracle recorded for reachable features", () => {
    const { blockNames, configuredFeatureIds } = collectReachablePlaceableBlocks();
    const coralTags = loadNormalizedBlockTags();
    for (const tagId of ["minecraft:coral_blocks", "minecraft:corals", "minecraft:wall_corals"]) {
      expect(coralTags[tagId]!.length).toBeGreaterThan(4);
      for (const name of coralTags[tagId]!) blockNames.add(name);
    }
    for (const name of BLOCKS_PLACED_BY_FEATURE_CODE) blockNames.add(name);
    const reference = loadGroundReference();
    const recordedStates = new Set<string>();
    for (const run of reference.runs) {
      if (!configuredFeatureIds.has(run.feature) || run.writes === undefined) continue;
      for (let index = 3; index < run.writes.length; index += 4) recordedStates.add(reference.states[run.writes[index]!]!);
    }
    const candidates = [...blockNames, ...recordedStates];
    expect(candidates.length).toBeGreaterThan(200);
    expect(recordedStates.size).toBeGreaterThan(60);
    const unmapped = candidates.filter((blockState) => {
      try {
        toGameBlock(blockState);
        return false;
      } catch {
        return true;
      }
    });
    expect(unmapped).toEqual([]);
  });
});

afterAll(() => {
  console.log(`ground block names test: ${(performance.now() - startedAt).toFixed(0)} ms`);
});
