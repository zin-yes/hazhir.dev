// Decoration under the worker profiler: call tree and breakdowns for features, feature types and biomes, balanced
// section nesting, per-feature block units that add up to the blocks the region really wrote, and unchanged output.

import { describe, expect, test } from "bun:test";
import { DIMENSIONS } from "@/applications/game/profiler/dimensions";
import { beginWorkerTask, finishWorkerTask, type WorkerTaskProfile } from "@/applications/game/profiler/worker-recorder";
import { loadFeaturesReference, loadTerralithDatapacks } from "../testing/feature-fixtures.node";
import { SyntheticWorldSource, syntheticLandHeight } from "../testing/synthetic-world";
import { FeatureDecorator } from "./feature-decorator";

const reference = loadFeaturesReference();
const datapacks = loadTerralithDatapacks();
const BIRCH_FOREST = "minecraft:old_growth_birch_forest";

function createDecorator(): FeatureDecorator {
  return new FeatureDecorator({
    source: new SyntheticWorldSource(BIRCH_FOREST, syntheticLandHeight),
    seed: BigInt(1337),
    registries: datapacks.registries,
    blockTags: datapacks.blockTags,
    possibleBiomes: reference.possibleBiomes,
  });
}

function sumUnits(profile: WorkerTaskProfile, dimension: string): number {
  return (profile.breakdowns[dimension] ?? []).reduce((total, entry) => total + entry.units, 0);
}

function profileRegionDecoration(): { profile: WorkerTaskProfile; blocksWritten: number } {
  const decorator = createDecorator();
  const region = decorator.createRegion(4, 4);
  beginWorkerTask(true);
  decorator.decorateInRegion(region);
  const profile = finishWorkerTask()!;
  return { profile, blocksWritten: region.blockWriteCount };
}

describe("decoration profiling", () => {
  test("a decorated column records feature, feature type, biome and biome x feature breakdowns", () => {
    const decorator = createDecorator();
    beginWorkerTask(true);
    decorator.generateDecoratedColumn(4, 4);
    const profile = finishWorkerTask()!;

    const featureEntries = profile.breakdowns[DIMENSIONS.worldgenFeature]!;
    expect(featureEntries.length).toBeGreaterThan(10);
    expect(featureEntries.some((entry) => entry.units > 0)).toBe(true);
    const typeEntries = profile.breakdowns[DIMENSIONS.worldgenFeatureType]!;
    expect(typeEntries.some((entry) => entry.key === "minecraft:tree" && entry.units > 0)).toBe(true);
    const biomeEntries = profile.breakdowns[DIMENSIONS.worldgenBiome]!;
    expect(biomeEntries.map((entry) => entry.key)).toContain(BIRCH_FOREST);
    expect(biomeEntries.find((entry) => entry.key === BIRCH_FOREST)!.units).toBeGreaterThan(100);
    const pairEntries = profile.breakdowns[DIMENSIONS.worldgenBiomeFeature]!;
    expect(pairEntries.every((entry) => entry.key.startsWith(`${BIRCH_FOREST}|`))).toBe(true);
    expect(pairEntries.some((entry) => entry.units > 0 && entry.selfMs > 0)).toBe(true);

    expect(profile.counters["decoration.originCacheMisses"]).toBe(9);
    expect(profile.counters["decoration.placementsSucceeded"]).toBeGreaterThan(0);
    expect(profile.counters["placement.in_square.calls"]).toBeGreaterThan(
      profile.counters["placement.in_square.positionsOut"]! - 1,
    );
    expect(profile.counters["placement.biome.positionsOut"]).toBeGreaterThan(0);
    expect(profile.counters["region.heightLookups"]).toBeGreaterThan(0);
    expect(profile.counters["region.columnLoads"]).toBeGreaterThan(0);
  });

  test("the call tree is balanced: every node has its parent and step sections wrap the placements", () => {
    const decorator = createDecorator();
    beginWorkerTask(true);
    decorator.generateDecoratedColumn(4, 4);
    const profile = finishWorkerTask()!;

    const paths = new Set(profile.callTree.map((node) => node.path));
    for (const path of paths) {
      const parentPath = path.slice(0, Math.max(0, path.lastIndexOf(">")));
      if (parentPath !== "") expect(paths.has(parentPath)).toBe(true);
    }
    const originNode = profile.callTree.find((node) => node.path === "feature.origin")!;
    expect(originNode.calls).toBe(9);
    expect(paths.has("feature.origin>feature.step.vegetal_decoration>feature.placed")).toBe(true);
    // Placement modifiers are too hot for sections: they are counted, not timed.
    expect([...paths].some((path) => path.includes("placement.modifier."))).toBe(false);
    expect(profile.counters["placement.in_square.calls"]).toBeGreaterThan(0);
    expect(profile.callTree.some((node) => node.path.includes("feature.place.tree>feature.body"))).toBe(true);
    expect(profile.callTree.some((node) => node.path.endsWith("feature.tree.trunk") && node.calls > 0)).toBe(true);
  });

  test("per-feature and per-pair units add up to the blocks the region wrote", () => {
    const { profile, blocksWritten } = profileRegionDecoration();
    expect(blocksWritten).toBeGreaterThan(500);
    expect(sumUnits(profile, DIMENSIONS.worldgenFeature)).toBe(blocksWritten);
    expect(sumUnits(profile, DIMENSIONS.worldgenBiomeFeature)).toBe(blocksWritten);
    expect(sumUnits(profile, DIMENSIONS.worldgenFeatureType)).toBe(blocksWritten);
    expect(profile.counters["region.blockWrites"]).toBe(blocksWritten);
  });

  test("profiling does not change the decorated blocks", () => {
    const plainColumn = createDecorator().generateDecoratedColumn(4, 4);
    const profiledDecorator = createDecorator();
    beginWorkerTask(true);
    const profiledColumn = profiledDecorator.generateDecoratedColumn(4, 4);
    finishWorkerTask();
    let differences = 0;
    for (let index = 0; index < plainColumn.blocks.length; index++) {
      if (plainColumn.palette.stateOf(plainColumn.blocks[index]!) !== profiledColumn.palette.stateOf(profiledColumn.blocks[index]!)) differences++;
    }
    expect(differences).toBe(0);
  });

  test("an unprofiled run records nothing and leaves no state for the next task", () => {
    const decorator = createDecorator();
    beginWorkerTask(false);
    decorator.generateDecoratedColumn(4, 4);
    expect(finishWorkerTask()).toBeNull();
    const { profile } = profileRegionDecoration();
    expect(profile.callTree[0]!.path).toBe("feature.origin");
  });
});
