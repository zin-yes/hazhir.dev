// Statistical check of the tree feature types against the real server (seed 1337, Terralith): leaf and log counts of
// chunks decorated through the whole path (overworld pipeline base columns + FeatureDecorator) versus the same
// fixture chunks. Opt-in (RUN_INTEGRATION=1): generating base columns takes a few seconds per chunk.
//
// Counts are not expected to be exact everywhere: vanilla decorates a chunk on top of its neighbors' earlier trees
// (a tree can be blocked by one a neighbor grew first), while every origin here decorates against base terrain only,
// so dense forests come out somewhat fuller. Chunks without such overlaps match exactly.

import { describe, expect, test } from "bun:test";
import { createOverworldGenerator } from "../../../pipeline";
import { FIXTURE_SEED, type FixtureChunk, loadAllFixtureChunks, loadDatapacks, RUN_INTEGRATION, WORLDGEN_DATA_AVAILABLE } from "../../../pipeline/pipeline-fixtures.node";
import { FeatureDecorator } from "../../decoration/feature-decorator";
import { FeatureTypeRegistry } from "../../feature/feature-type";
import { loadFeaturesReference } from "../../testing/feature-fixtures.node";
import { CORE_FEATURE_TYPES } from "..";
import { TREE_FEATURE_TYPES } from ".";

const CHUNKS_PER_BIOME = 2;
const LEAVES = /_leaves$/;
const LOGS = /_(log|wood)$|^minecraft:(mushroom_stem|red_mushroom_block|brown_mushroom_block)$/;
/** Blocks of structures (mineshafts, dungeons, villages, ...): chunks containing them hold logs and leaves that are not trees. */
const STRUCTURE_BLOCKS =
  /planks|fence|rail|torch|spawner|chest|bricks|barrel|lantern|_door|furnace|crafting|_bed|wool|ladder|_sign|trapdoor|_stairs|bookshelf|button|pressure_plate|^minecraft:cobblestone$|_slab/;

function countMatching(names: string[], blocks: ArrayLike<number>, pattern: RegExp): number {
  const matchesByPaletteId = names.map((name) => pattern.test(name));
  let count = 0;
  for (let index = 0; index < blocks.length; index++) if (matchesByPaletteId[blocks[index]!]) count++;
  return count;
}

/** The most common biome of the chunk's section at y 64..79. */
function surfaceBiomeOf(chunk: FixtureChunk): string {
  const counts = new Map<number, number>();
  for (let quart = 8 * 64; quart < 9 * 64; quart++) counts.set(chunk.biomes[quart]!, (counts.get(chunk.biomes[quart]!) ?? 0) + 1);
  const dominant = [...counts].sort((first, second) => second[1] - first[1])[0]![0];
  return chunk.biomePalette[dominant]!;
}

describe.skipIf(!WORLDGEN_DATA_AVAILABLE || !RUN_INTEGRATION)("tree features through the decoration path vs real server fixtures", () => {
  test("leaf and log counts per chunk are close to the real ones, and exact where no tree overlaps another", () => {
    const startedAt = performance.now();
    const { registries, overworldDimension, blockTags } = loadDatapacks();
    const generator = createOverworldGenerator({ registries, overworldDimension: overworldDimension!, blockTags, seed: FIXTURE_SEED });
    const decorator = new FeatureDecorator({
      source: generator,
      seed: FIXTURE_SEED,
      registries,
      blockTags,
      possibleBiomes: loadFeaturesReference().possibleBiomes,
      featureTypes: new FeatureTypeRegistry([...CORE_FEATURE_TYPES, ...TREE_FEATURE_TYPES]),
    });
    const chunksByBiome = new Map<string, FixtureChunk[]>();
    for (const chunk of loadAllFixtureChunks()) {
      if (chunk.blockPalette.some((name) => STRUCTURE_BLOCKS.test(name))) continue;
      const biome = surfaceBiomeOf(chunk);
      chunksByBiome.set(biome, [...(chunksByBiome.get(biome) ?? []), chunk]);
    }
    const rows: string[] = [];
    let realLeaves = 0;
    let ourLeaves = 0;
    let realLogs = 0;
    let ourLogs = 0;
    let exactChunksWithTrees = 0;
    let chunksWithTrees = 0;
    for (const [biome, chunks] of [...chunksByBiome].sort(([first], [second]) => first.localeCompare(second))) {
      for (const chunk of chunks.slice(0, CHUNKS_PER_BIOME)) {
        const chunkStartedAt = performance.now();
        const decorated = decorator.generateDecoratedColumn(chunk.chunkX, chunk.chunkZ);
        const ourNames = Array.from({ length: decorated.palette.size }, (_, id) => decorated.palette.stateOf(id).replace(/\[.*$/, ""));
        const real = { leaves: countMatching(chunk.blockPalette, chunk.blocks, LEAVES), logs: countMatching(chunk.blockPalette, chunk.blocks, LOGS) };
        const ours = { leaves: countMatching(ourNames, decorated.blocks, LEAVES), logs: countMatching(ourNames, decorated.blocks, LOGS) };
        realLeaves += real.leaves;
        ourLeaves += ours.leaves;
        realLogs += real.logs;
        ourLogs += ours.logs;
        if (real.leaves + real.logs > 0) {
          chunksWithTrees++;
          if (real.leaves === ours.leaves && real.logs === ours.logs) exactChunksWithTrees++;
        }
        rows.push(`${biome} (${chunk.chunkX}, ${chunk.chunkZ}): leaves ${ours.leaves}/${real.leaves}, logs ${ours.logs}/${real.logs}, ${(performance.now() - chunkStartedAt).toFixed(0)} ms`);
      }
    }
    console.log(
      `[trees] ours/real per chunk\n${rows.join("\n")}\n[trees] leaves ratio ${(ourLeaves / realLeaves).toFixed(3)}, logs ratio ${(ourLogs / realLogs).toFixed(3)}, exact chunks ${exactChunksWithTrees}/${chunksWithTrees}, ${(performance.now() - startedAt).toFixed(0)} ms`,
    );
    expect(realLeaves).toBeGreaterThan(1000);
    expect(ourLeaves / realLeaves).toBeGreaterThan(0.8);
    expect(ourLeaves / realLeaves).toBeLessThan(1.4);
    expect(ourLogs / realLogs).toBeGreaterThan(0.8);
    expect(ourLogs / realLogs).toBeLessThan(1.5);
    expect(exactChunksWithTrees).toBeGreaterThanOrEqual(Math.ceil(chunksWithTrees / 3));
    expect(decorator.diagnostics.parseErrors.size).toBe(0);
    expect(decorator.diagnostics.placementErrors.size).toBe(0);
  }, 900_000);
});
