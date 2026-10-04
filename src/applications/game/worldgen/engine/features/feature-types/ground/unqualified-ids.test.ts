// Terralith writes some ids without the minecraft: namespace ("block_column", "random_selector", "basalt",
// "#base_stone_overworld"); Minecraft's ResourceLocation codec reads them as minecraft: ids. Features written with
// every minecraft: prefix removed must resolve and place exactly like the qualified originals.

import { afterAll, describe, expect, test } from "bun:test";
import { BlockStateCatalog, BlockTagIndex, SurvivalRules } from "../../../block-state";
import type { JsonObject, JsonValue } from "../../../registry/datapack-loader";
import { BlockPos } from "../../core/block-pos";
import { createDecorationRandom } from "../../core/worldgen-random";
import { FeatureResolver } from "../../feature/feature-parser";
import { type FeatureChunkGenerator, FeatureTypeRegistry } from "../../feature/feature-type";
import { DecorationRegion } from "../../level/decoration-region";
import { loadTerralithDatapacks } from "../../testing/feature-fixtures.node";
import { CORE_FEATURE_TYPES } from "../index";
import { GROUND_FEATURE_TYPES } from "./index";
import { collectFeatureClosure } from "./testing/feature-closure";
import { loadGroundReference } from "./testing/ground-reference.node";
import { loadNormalizedBlockTags } from "./testing/normalized-block-tags.node";
import { ScenarioWorldSource } from "./testing/scenario-world";

const startedAt = performance.now();
const datapacks = loadTerralithDatapacks();
const reference = loadGroundReference();

function stripMinecraftNamespace(value: JsonValue): JsonValue {
  if (typeof value === "string") return value.replace(/^(#?)minecraft:/, "$1");
  if (Array.isArray(value)) return value.map(stripMinecraftNamespace);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, stripMinecraftNamespace(child)]));
  }
  return value;
}

const ROOT_FEATURES = [
  "minecraft:moss_patch",
  "minecraft:disk_sand",
  "minecraft:glow_lichen",
  "minecraft:seagrass_tall",
  "minecraft:kelp",
  "minecraft:warm_ocean_vegetation",
  "minecraft:spring_water",
  "minecraft:pile_ice",
];

describe("ids without the minecraft: namespace", () => {
  test("features with every minecraft: prefix stripped place the same blocks", () => {
    const closure = collectFeatureClosure(datapacks.registries, ROOT_FEATURES);
    const strippedRegistries = { configured_feature: {} as Record<string, JsonObject>, placed_feature: {} as Record<string, JsonObject> };
    let strippedCount = 0;
    for (const id of closure.configuredFeatureIds) {
      strippedRegistries.configured_feature[id] = stripMinecraftNamespace(datapacks.registries.configured_feature[id]!) as JsonObject;
      if (JSON.stringify(strippedRegistries.configured_feature[id]) !== JSON.stringify(datapacks.registries.configured_feature[id])) strippedCount++;
    }
    for (const id of closure.placedFeatureIds) strippedRegistries.placed_feature[id] = stripMinecraftNamespace(datapacks.registries.placed_feature[id]!) as JsonObject;
    expect(strippedCount).toBeGreaterThanOrEqual(ROOT_FEATURES.length);

    const blockStates = new BlockStateCatalog({ strict: true });
    const survival = new SurvivalRules(blockStates);
    const blockTags = new BlockTagIndex(loadNormalizedBlockTags());
    const featureTypes = new FeatureTypeRegistry([...CORE_FEATURE_TYPES, ...GROUND_FEATURE_TYPES]);
    const qualified = new FeatureResolver({ registries: datapacks.registries, blockStates, featureTypes, strict: true });
    const unqualified = new FeatureResolver({ registries: strippedRegistries, blockStates, featureTypes, strict: true });
    const generator: FeatureChunkGenerator = { minY: -64, genDepth: 384, seaLevel: 63, biomeHasFeature: () => true };
    const sources = [0, 1, 2].map((scenario) => new ScenarioWorldSource(scenario));

    const placeAndRecord = (resolver: FeatureResolver, featureId: string, scenario: number, originIndex: number) => {
      const origin = reference.origins[scenario]![originIndex]!;
      const region = new DecorationRegion({ source: sources[scenario]!, seed: BigInt(1337), centerChunkX: 3, centerChunkZ: -7, blockStates, blockTags, survival });
      const random = createDecorationRandom();
      random.setFeatureSeed(random.setDecorationSeed(BigInt(1337), 48, -112), 7 + originIndex, 5);
      const placed = resolver.configuredFeature(featureId).place(region, generator, random, new BlockPos(origin[0]!, origin[1]!, origin[2]!));
      const writes = region.extractPatches().map((patch) => [patch.chunkX, patch.chunkZ, [...patch.indices], [...patch.paletteIds].map((id) => region.blockPalette!.stateOf(id))]);
      return JSON.stringify({ placed, writes, next: random.nextLong().toString() });
    };

    let comparedWrites = 0;
    for (const featureId of ROOT_FEATURES) {
      for (const scenario of [0, 1, 2]) {
        for (const originIndex of [0, 1, 2, 3, 4, 5]) {
          const expected = placeAndRecord(qualified, featureId, scenario, originIndex);
          expect(placeAndRecord(unqualified, featureId, scenario, originIndex)).toBe(expected);
          comparedWrites += JSON.parse(expected).writes.length;
        }
      }
    }
    expect(comparedWrites).toBeGreaterThan(50);
  });
});

afterAll(() => {
  console.log(`unqualified ids test: ${(performance.now() - startedAt).toFixed(0)} ms`);
});
