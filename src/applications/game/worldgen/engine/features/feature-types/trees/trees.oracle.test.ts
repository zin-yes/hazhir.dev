// Places every vanilla and Terralith tree, root system and huge mushroom configured feature on the synthetic
// world and compares with the real 1.20.6 classes (fixtures/trees-reference.json.gz, recorded by
// fixtures/TreesReference.java): the result, every accepted block write in call order, and the random state after.

import { afterAll, describe, expect, test } from "bun:test";
import { BlockStateCatalog, BlockTagIndex } from "../../../block-state";
import { XoroshiroRandomSource } from "../../../random";
import { BlockPos } from "../../core/block-pos";
import { WorldgenRandom } from "../../core/worldgen-random";
import { FeatureResolver } from "../../feature/feature-parser";
import { type FeatureChunkGenerator, FeatureTypeRegistry } from "../../feature/feature-type";
import { DecorationRegion } from "../../level/decoration-region";
import { loadTerralithDatapacks } from "../../testing/feature-fixtures.node";
import { CORE_FEATURE_TYPES } from "..";
import { TREE_FEATURE_TYPES } from ".";
import { treesBaseState, TreesTestWorldSource } from "./trees-test-world";
import { loadTreesReference, type RecordedTreeRun } from "./trees-reference.node";

const startedAt = performance.now();
const reference = loadTreesReference();
const datapacks = loadTerralithDatapacks();
const generator = { minY: -64, genDepth: 384, seaLevel: 63, biomeHasFeature: () => true } as unknown as FeatureChunkGenerator;

class RecordingRegion extends DecorationRegion {
  readonly writes: Array<[number, number, number, string]> = [];

  override setBlock(x: number, y: number, z: number, state: string, flags?: number): boolean {
    const accepted = super.setBlock(x, y, z, state, flags);
    if (accepted && !this.isOutsideBuildHeight(y)) this.writes.push([x, y, z, this.blockStates.normalize(state)]);
    return accepted;
  }
}

function createResolver(blockStates: BlockStateCatalog): FeatureResolver {
  return new FeatureResolver({
    registries: datapacks.registries,
    blockStates,
    featureTypes: new FeatureTypeRegistry([...CORE_FEATURE_TYPES, ...TREE_FEATURE_TYPES]),
    strict: true,
  });
}

function runOnSyntheticWorld(resolver: FeatureResolver, blockStates: BlockStateCatalog, source: TreesTestWorldSource, run: RecordedTreeRun) {
  const region = new RecordingRegion({ source, seed: BigInt(1337), centerChunkX: 3, centerChunkZ: -7, blockStates, blockTags: new BlockTagIndex(datapacks.blockTags) });
  const random = new WorldgenRandom(new XoroshiroRandomSource(BigInt(run.seed)));
  const placed = resolver.configuredFeature(run.id).place(region, generator, random, new BlockPos(...run.origin));
  return { region, placed, nextLong: random.nextLong().toString() };
}

describe("tree feature types against the real classes", () => {
  test("every recorded run writes the same blocks in the same order and leaves the random in the same state", () => {
    const blockStates = new BlockStateCatalog({ strict: true });
    const resolver = createResolver(blockStates);
    const source = new TreesTestWorldSource();
    const mismatches: string[] = [];
    const placedConfigurations = new Set<string>();
    let comparedWrites = 0;
    let placedRuns = 0;
    for (const run of reference.runs) {
      expect(run.error).toBeUndefined();
      const { region, placed, nextLong } = runOnSyntheticWorld(resolver, blockStates, source, run);
      const expectedWrites = run.writes!;
      comparedWrites += expectedWrites.length / 4;
      if (run.placed) {
        placedRuns++;
        placedConfigurations.add(run.id);
      }
      if (placed !== run.placed) {
        mismatches.push(`${run.id} at ${run.origin}: placed ${placed}, expected ${run.placed}`);
        continue;
      }
      const writeCountMatches = region.writes.length === expectedWrites.length / 4;
      let firstDifference = writeCountMatches ? -1 : Math.min(region.writes.length, expectedWrites.length / 4);
      for (let index = 0; writeCountMatches && index < region.writes.length; index++) {
        const [x, y, z, state] = region.writes[index]!;
        if (x !== expectedWrites[index * 4] || y !== expectedWrites[index * 4 + 1] || z !== expectedWrites[index * 4 + 2] || state !== reference.palette[expectedWrites[index * 4 + 3]!]) {
          firstDifference = index;
          break;
        }
      }
      if (firstDifference >= 0) {
        const actual = region.writes[firstDifference];
        const expected = expectedWrites.slice(firstDifference * 4, firstDifference * 4 + 4);
        mismatches.push(`${run.id} at ${run.origin}: write ${firstDifference} of ${region.writes.length}/${expectedWrites.length / 4}: ${JSON.stringify(actual)} vs ${JSON.stringify([...expected.slice(0, 3), reference.palette[expected[3]!]])}`);
      } else if (nextLong !== run.nextLong) {
        mismatches.push(`${run.id} at ${run.origin}: random state differs after placement`);
      }
    }
    expect(mismatches.slice(0, 12)).toEqual([]);
    expect(placedRuns).toBeGreaterThan(800);
    expect(placedConfigurations.size).toBe(new Set(reference.runs.map((run) => run.id)).size);
    expect(comparedWrites).toBeGreaterThan(200000);
    expect(blockStates.unknownBlockCounts.size).toBe(0);
  });

  test("the recorded runs exercise every decorator, root placer and mushroom type", () => {
    const written = new Set(reference.palette.map((state) => state.replace(/\[.*$/, "")));
    for (const name of ["bee_nest", "cocoa", "vine", "mangrove_roots", "muddy_mangrove_roots", "mangrove_propagule", "moss_carpet", "rooted_dirt", "podzol", "red_mushroom_block", "brown_mushroom_block", "mushroom_stem", "hanging_roots"]) {
      expect(written.has(`minecraft:${name}`)).toBe(true);
    }
    const attachedStates = reference.palette.filter((state) => state.startsWith("minecraft:mangrove_propagule"));
    expect(attachedStates.some((state) => state.includes("hanging=true"))).toBe(true);
  });

  test("the synthetic world used here is the one the reference was recorded on", () => {
    const origins = new Set(reference.runs.map((run) => `${run.origin[0]},${run.origin[2]}`));
    expect(origins.size).toBeGreaterThanOrEqual(6);
    for (const run of reference.runs.slice(0, 6)) {
      expect(treesBaseState(run.origin[0], run.origin[1] - 1, run.origin[2])).toMatch(/grass_block|sand/);
      expect(treesBaseState(run.origin[0], run.origin[1] + 40, run.origin[2])).toBe("minecraft:air");
    }
  });
});

afterAll(() => {
  console.log(`trees oracle tests: ${(performance.now() - startedAt).toFixed(0)} ms`);
});
