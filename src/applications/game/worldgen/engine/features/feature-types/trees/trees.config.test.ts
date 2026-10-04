// Every vanilla and Terralith tree-like configured feature must parse with the tree feature types, use only the
// placer and decorator types this module implements, and place only blocks the game block map accepts.

import { afterAll, describe, expect, test } from "bun:test";
import { BlockStateCatalog } from "../../../block-state";
import { toGameBlock } from "../../../blocks/minecraft-block-map";
import { FeatureResolver } from "../../feature/feature-parser";
import { FeatureTypeRegistry } from "../../feature/feature-type";
import { loadTerralithDatapacks } from "../../testing/feature-fixtures.node";
import { CORE_FEATURE_TYPES } from "..";
import { TREE_FEATURE_TYPES } from ".";
import { loadTreesReference } from "./trees-reference.node";

const startedAt = performance.now();
const datapacks = loadTerralithDatapacks();
const treeFeatureTypeIds = TREE_FEATURE_TYPES.map((type) => type.id);
const treeLikeConfigurations = Object.entries(datapacks.registries.configured_feature).filter(([, definition]) => treeFeatureTypeIds.includes(String(definition.type)));

function collectBlockNames(json: unknown, into: Set<string>): void {
  if (typeof json !== "object" || json === null) return;
  const object = json as Record<string, unknown>;
  if (typeof object.Name === "string") into.add(object.Name.includes(":") ? object.Name : `minecraft:${object.Name}`);
  for (const value of Object.values(object)) collectBlockNames(value, into);
}

describe("tree configured features", () => {
  test("all of them parse strictly with the registered feature types", () => {
    const blockStates = new BlockStateCatalog({ strict: true });
    const resolver = new FeatureResolver({
      registries: datapacks.registries,
      blockStates,
      featureTypes: new FeatureTypeRegistry([...CORE_FEATURE_TYPES, ...TREE_FEATURE_TYPES]),
      strict: true,
    });
    for (const [id] of treeLikeConfigurations) resolver.configuredFeature(id);
    expect(treeLikeConfigurations.length).toBeGreaterThanOrEqual(200);
    expect(treeLikeConfigurations.filter(([id]) => id.startsWith("terralith:")).length).toBeGreaterThanOrEqual(150);
    expect(blockStates.unknownBlockCounts.size).toBe(0);
  });

  test("they use exactly the trunk, foliage, root and decorator types the module implements", () => {
    const used = { trunk: new Set<string>(), foliage: new Set<string>(), root: new Set<string>(), decorator: new Set<string>(), featureSize: new Set<string>() };
    for (const [, definition] of treeLikeConfigurations) {
      if (definition.type !== "minecraft:tree") continue;
      const config = definition.config as Record<string, any>;
      used.trunk.add(config.trunk_placer.type);
      used.foliage.add(config.foliage_placer.type);
      used.featureSize.add(config.minimum_size.type);
      if (config.root_placer) used.root.add(config.root_placer.type);
      for (const decorator of config.decorators) used.decorator.add(decorator.type);
    }
    expect([...used.trunk].sort()).toEqual(
      ["bending", "cherry", "dark_oak", "fancy", "forking", "giant", "mega_jungle", "straight", "upwards_branching"].map((name) => `minecraft:${name}_trunk_placer`).sort(),
    );
    expect([...used.foliage].sort()).toEqual(
      ["acacia", "blob", "bush", "cherry", "dark_oak", "fancy", "jungle", "mega_pine", "pine", "random_spread", "spruce"].map((name) => `minecraft:${name}_foliage_placer`).sort(),
    );
    expect([...used.root]).toEqual(["minecraft:mangrove_root_placer"]);
    expect([...used.decorator].sort()).toEqual(["alter_ground", "attached_to_leaves", "beehive", "cocoa", "leave_vine", "trunk_vine"].map((name) => `minecraft:${name}`).sort());
    expect([...used.featureSize].sort()).toEqual(["minecraft:three_layers_feature_size", "minecraft:two_layers_feature_size"]);
  });

  test("every block the features can place is accepted by toGameBlock", () => {
    const blockNames = new Set<string>(["minecraft:vine", "minecraft:bee_nest", "minecraft:cocoa"]);
    for (const [, definition] of treeLikeConfigurations) collectBlockNames(definition.config, blockNames);
    for (const state of loadTreesReference().palette) blockNames.add(state.replace(/\[.*$/, ""));
    const catalog = new BlockStateCatalog();
    const unmapped: string[] = [];
    for (const name of blockNames) {
      try {
        toGameBlock(catalog.defaultState(name));
      } catch {
        unmapped.push(name);
      }
    }
    expect(blockNames.size).toBeGreaterThan(40);
    expect(unmapped).toEqual([]);
  });
});

afterAll(() => {
  console.log(`trees config tests: ${(performance.now() - startedAt).toFixed(0)} ms`);
});
