// End to end: decorate synthetic columns with the real Terralith biome feature lists (only the core feature types
// are registered here, everything else is a counted no-op), plus the region semantics decoration relies on.

import { afterAll, describe, expect, test } from "bun:test";
import { BlockStateCatalog, BlockTagIndex } from "../../block-state";
import { DecorationRegion } from "../level/decoration-region";
import { loadFeaturesReference, loadTerralithDatapacks } from "../testing/feature-fixtures.node";
import { SyntheticWorldSource, syntheticLandHeight, syntheticTerrainHeight } from "../testing/synthetic-world";
import { FeatureDecorator, type OriginDecorationTrace } from "./feature-decorator";

const startedAt = performance.now();
const reference = loadFeaturesReference();
const datapacks = loadTerralithDatapacks();
const BIRCH_FOREST = "minecraft:old_growth_birch_forest";

function createDecorator(source: SyntheticWorldSource, maxCachedOrigins?: number): FeatureDecorator {
  return new FeatureDecorator({
    source,
    seed: BigInt(1337),
    registries: datapacks.registries,
    blockTags: datapacks.blockTags,
    possibleBiomes: reference.possibleBiomes,
    maxCachedOrigins,
  });
}

function countBlocks(states: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const state of states) {
    const name = state.split("[")[0]!;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

describe("FeatureDecorator", () => {
  test("decorated old growth birch forest columns carry grass and flower patches at plausible densities", () => {
    const decorator = createDecorator(new SyntheticWorldSource(BIRCH_FOREST, syntheticLandHeight));
    const states: string[] = [];
    let columns = 0;
    for (let chunkZ = 0; chunkZ < 2; chunkZ++) {
      for (let chunkX = 0; chunkX < 2; chunkX++) {
        const column = decorator.generateDecoratedColumn(chunkX, chunkZ);
        columns++;
        for (let y = 60; y <= 80; y++) for (let localZ = 0; localZ < 16; localZ++) for (let localX = 0; localX < 16; localX++) states.push(column.getState(localX, y, localZ));
      }
    }
    const counts = countBlocks(states);
    const shortGrassPerColumn = (counts.get("minecraft:short_grass") ?? 0) / columns;
    // The real server averages 38 short grass per old growth birch forest chunk (ground-truth fixtures, which also
    // have trees and real terrain); the synthetic all-grass hills should land in the same order of magnitude.
    expect(shortGrassPerColumn).toBeGreaterThan(10);
    expect(shortGrassPerColumn).toBeLessThan(80);
    const flowerKinds = ["minecraft:lilac", "minecraft:pink_tulip", "minecraft:white_tulip", "minecraft:cornflower", "minecraft:peony", "minecraft:rose_bush", "minecraft:lily_of_the_valley"];
    expect(flowerKinds.filter((kind) => (counts.get(kind) ?? 0) > 0).length).toBeGreaterThanOrEqual(2);
    expect(counts.get("minecraft:oak_leaves") ?? counts.get("minecraft:birch_leaves") ?? 0).toBeGreaterThan(0);
    expect([...decorator.diagnostics.unsupportedFeatureTypes.keys()]).toEqual([]);
    expect(decorator.diagnostics.placementErrors.size).toBe(0);
  });

  test("a decorated column is a pure function of (seed, chunk): request order and cache size do not matter", () => {
    const first = createDecorator(new SyntheticWorldSource(BIRCH_FOREST, syntheticLandHeight));
    const expected = first.generateDecoratedColumn(1, 1);
    const second = createDecorator(new SyntheticWorldSource(BIRCH_FOREST, syntheticLandHeight), 1);
    second.generateDecoratedColumn(2, 2);
    second.generateDecoratedColumn(0, 1);
    const actual = second.generateDecoratedColumn(1, 1);
    let differences = 0;
    for (let index = 0; index < expected.blocks.length; index++) {
      if (expected.palette.stateOf(expected.blocks[index]!) !== actual.palette.stateOf(actual.blocks[index]!)) differences++;
    }
    expect(differences).toBe(0);
    const base = new SyntheticWorldSource(BIRCH_FOREST, syntheticLandHeight).generateBaseColumn(1, 1);
    let decoratedBlocks = 0;
    for (let index = 0; index < expected.blocks.length; index++) if (expected.palette.stateOf(expected.blocks[index]!) !== base.palette.stateOf(base.blocks[index]!)) decoratedBlocks++;
    expect(decoratedBlocks).toBeGreaterThan(10);
  });

  test("origin patches stay inside the 3x3 chunks and the step loop runs Java's feature indices in order", () => {
    const decorator = createDecorator(new SyntheticWorldSource(BIRCH_FOREST, syntheticLandHeight));
    const trace: OriginDecorationTrace[] = [];
    const decoration = decorator.decorateOrigin(5, -3, trace);
    for (const patch of decoration.patches) {
      expect(Math.abs(patch.chunkX - 5)).toBeLessThanOrEqual(1);
      expect(Math.abs(patch.chunkZ + 3)).toBeLessThanOrEqual(1);
    }
    expect(decoration.patches.length).toBeGreaterThan(1);
    // Within one origin's decoration every double plant has its lower half directly below its upper half. (Merged
    // columns can break pairs where two origins' patches overlap: see the README's deviation notes.)
    const region = decorator.createRegion(5, -3);
    decorator.decorateInRegion(region);
    let upperHalves = 0;
    for (const patch of region.extractPatches()) {
      for (let position = 0; position < patch.indices.length; position++) {
        const state = region.blockPalette!.stateOf(patch.paletteIds[position]!);
        if (!state.includes("half=upper")) continue;
        upperHalves++;
        const index = patch.indices[position]!;
        const x = patch.chunkX * 16 + (index & 15);
        const y = Math.floor(index / 256) + region.minY;
        const z = patch.chunkZ * 16 + ((index >> 4) & 15);
        expect(region.getBlockState(x, y - 1, z)).toBe(state.replace("half=upper", "half=lower"));
      }
    }
    expect(upperHalves).toBeGreaterThan(0);
    expect(decoration.biomes).toEqual([BIRCH_FOREST]);
    const birchSteps = decorator.biomeFeatures.stepsOf(BIRCH_FOREST);
    expect(trace.length).toBe(birchSteps.flat().length);
    for (let position = 1; position < trace.length; position++) {
      const previous = trace[position - 1]!;
      const current = trace[position]!;
      expect(current.step > previous.step || (current.step === previous.step && current.featureIndex > previous.featureIndex)).toBe(true);
    }
    for (const entry of trace) expect(reference.featuresPerStep[entry.step]![entry.featureIndex]).toBe(entry.featureKey);
  });
});

describe("DecorationRegion", () => {
  const blockStates = new BlockStateCatalog({ strict: true });
  const blockTags = new BlockTagIndex(datapacks.blockTags);

  function createRegion(): DecorationRegion {
    return new DecorationRegion({ source: new SyntheticWorldSource(BIRCH_FOREST), seed: BigInt(1337), centerChunkX: 0, centerChunkZ: 0, blockStates, blockTags });
  }

  test("heightmaps: *_WG frozen at base terrain, POST_FEATURES heightmaps follow writes", () => {
    const region = createRegion();
    const x = 5;
    const z = 9;
    const surface = syntheticTerrainHeight(x, z);
    const firstFree = Math.max(surface, 62) + 1;
    expect(region.getHeight("WORLD_SURFACE", x, z)).toBe(firstFree);
    expect(region.getHeight("OCEAN_FLOOR", x, z)).toBe(surface + 1);
    region.setBlock(x, firstFree, z, "minecraft:short_grass");
    expect(region.getHeight("WORLD_SURFACE", x, z)).toBe(firstFree + 1);
    expect(region.getHeight("WORLD_SURFACE_WG", x, z)).toBe(firstFree);
    expect(region.getHeight("MOTION_BLOCKING", x, z)).toBe(firstFree);
    region.setBlock(x, firstFree + 3, z, "minecraft:oak_leaves[distance=1,persistent=false,waterlogged=false]");
    expect(region.getHeight("MOTION_BLOCKING", x, z)).toBe(firstFree + 4);
    expect(region.getHeight("MOTION_BLOCKING_NO_LEAVES", x, z)).toBe(firstFree);
    region.setBlock(x, firstFree + 3, z, "minecraft:air");
    expect(region.getHeight("MOTION_BLOCKING", x, z)).toBe(firstFree);
    expect(region.getHeight("WORLD_SURFACE", x, z)).toBe(firstFree + 1);
  });

  test("writes are clipped to the 3x3 chunks; reads outside see base terrain and void air past the build height", () => {
    const region = createRegion();
    expect(region.setBlock(40, 70, 0, "minecraft:stone")).toBe(false);
    expect(region.setBlock(-17, 100, 31, "minecraft:stone")).toBe(false);
    expect(region.setBlock(-16, 100, 31, "minecraft:stone")).toBe(true);
    expect(region.getBlockState(-16, 100, 31)).toBe("minecraft:stone");
    expect(region.getBlockState(40, -64, 0)).toBe("minecraft:bedrock");
    expect(region.setBlock(0, 400, 0, "minecraft:stone")).toBe(true);
    expect(region.getBlockState(0, 400, 0)).toBe("minecraft:void_air");
    expect(region.getBlockState(0, 300, 0)).toBe("minecraft:air");
    expect(region.extractPatches().map((patch) => [patch.chunkX, patch.chunkZ, patch.indices.length])).toEqual([[-1, 1, 1]]);
  });
});

afterAll(() => console.log(`feature-decorator tests: ${(performance.now() - startedAt).toFixed(0)} ms`));
