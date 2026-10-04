// carving_mask is the one modifier the Java oracle cannot exercise (its fake world has no carvers stage), so it is
// checked here with the vanilla minecraft:seagrass_simple placed feature and a mask supplied by the source.

import { afterAll, expect, test } from "bun:test";
import { BlockPos } from "../core/block-pos";
import { CarvingMask, type CarvingStep } from "../core/carving-mask";
import { createDecorationRandom } from "../core/worldgen-random";
import { FeatureDecorator } from "../decoration/feature-decorator";
import { loadFeaturesReference, loadTerralithDatapacks } from "../testing/feature-fixtures.node";
import { SyntheticWorldSource } from "../testing/synthetic-world";

const startedAt = performance.now();

class CarvedSyntheticSource extends SyntheticWorldSource {
  readonly liquidMask = new CarvingMask(-64, 384);

  carvingMask(_chunkX: number, _chunkZ: number, step: CarvingStep): CarvingMask | undefined {
    return step === "liquid" ? this.liquidMask : undefined;
  }
}

test("carving_mask streams the carvers' liquid mask in BitSet order into the rest of the chain", () => {
  const reference = loadFeaturesReference();
  const datapacks = loadTerralithDatapacks();
  const source = new CarvedSyntheticSource("minecraft:plains");
  const decorator = new FeatureDecorator({ source, seed: BigInt(1337), registries: datapacks.registries, blockTags: datapacks.blockTags, possibleBiomes: reference.possibleBiomes });
  const ownerBiome = reference.possibleBiomes.find((biome) => decorator.biomeFeatures.hasFeature(biome, "minecraft:seagrass_simple"));
  expect(ownerBiome).toBeDefined();
  source.biome = ownerBiome!;

  const region = decorator.createRegion(0, 0);
  // Carved, water-filled pockets over stone at y 30 (matching the filter) and carved stone at y 10 (not matching).
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      source.liquidMask.set(x, 30, z);
      source.liquidMask.set(x, 10, z);
      region.setBlock(x, 29, z, "minecraft:stone");
      region.setBlock(x, 30, z, "minecraft:water[level=0]");
      region.setBlock(x, 31, z, "minecraft:water[level=0]");
    }
  }
  const placed = decorator.placedFeatureByKey("minecraft:seagrass_simple");
  expect(placed.placement[0]!.type).toBe("minecraft:carving_mask");
  const random = createDecorationRandom();
  random.setFeatureSeed(random.setDecorationSeed(BigInt(1337), 0, 0), 3, 7);
  const drawsBefore = random.count;
  const positions = placed.placementPositions(region, decorator.generator, random, new BlockPos(0, -64, 0));

  // Every mask bit draws one rarity_filter nextFloat; nothing else in the chain is random.
  expect(random.count - drawsBefore).toBe(512);
  expect(positions.length).toBeGreaterThan(5);
  expect(positions.length).toBeLessThan(60);
  for (const position of positions) expect(position.y).toBe(30);
  const indices = positions.map((position) => position.z * 16 + position.x);
  expect([...indices].sort((first, second) => first - second)).toEqual(indices);
});

afterAll(() => console.log(`carving mask placement tests: ${(performance.now() - startedAt).toFixed(0)} ms`));
