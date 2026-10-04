// fillChunkColumn against ground truth from the real Terralith server (seed 1337, $WORLDGEN_SCRATCH/fixtures):
// per column, our highest stone block versus the real highest terrain block (ignoring fluids, ice, vegetation, logs).
// The real chunks also contain carvers, features and structures, which this stage does not generate, so the match is
// high but not total; columns topped by man-made blocks are skipped.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { GROUND_TRUTH_FIXTURE_DIRECTORY, loadOverworldRouter, TERRALITH_DATA_AVAILABLE } from "../density/terralith-test-data.node";
import { BLOCK_DEFAULT_BLOCK, fillChunkColumn } from "./fill-chunk-column";

interface GroundTruthChunk {
  chunkX: number;
  chunkZ: number;
  blockPalette: string[];
  blocks: string;
}

const NOT_TERRAIN =
  /:air$|cave_air|water|lava|bubble_column|leaves|_log$|_wood$|stem$|short_grass|tall_grass|fern|tulip|daisy|poppy|dandelion|allium|cornflower|lilac|peony|rose_bush|orchid|bluet|lily|mushroom|vine|kelp|seagrass|sea_pickle|cactus|bamboo|sugar_cane|dead_bush|azalea|dripleaf|carpet|^minecraft:snow$|lichen|roots|blossom|pumpkin|bee_nest|berry|^minecraft:ice$|packed_ice|blue_ice|cobweb|pointed_dripstone/;
const MAN_MADE =
  /planks|stairs|slab|fence|door|_wall|torch|bricks|cobblestone|chest|table|barrel|_bed|bookshelf|lantern|rail|glass|wool|banner|sign|furnace|loom|lectern|cauldron|ladder|button|plate|lever|pot|candle|chain|bars|spawner|tnt|grindstone|tripwire|honey|copper_block|cut_copper|gold_block|coal_block|glazed|cut_|chiseled|obsidian|netherrack|fire|mud|bone_block|stripped|crying|hay|raw_/;
const REGION_FILES = ["r.0.0.json.gz", "r.23.23.json.gz", "r.-12.4.json.gz"];
const CHUNKS_PER_REGION = 24;
const suiteStart = performance.now();
const groundTruthAvailable = TERRALITH_DATA_AVAILABLE && REGION_FILES.every((file) => existsSync(`${GROUND_TRUTH_FIXTURE_DIRECTORY}/${file}`));

function highestMatchingY(height: number, isMatch: (blockIndex: number) => boolean, localX: number, localZ: number): number {
  for (let yOffset = height - 1; yOffset >= 0; yOffset--) {
    if (isMatch(yOffset * 256 + localZ * 16 + localX)) return yOffset;
  }
  return -1;
}

(groundTruthAvailable ? describe : describe.skip)("fillChunkColumn versus the real Terralith world", () => {
  test(`surface height matches across ${REGION_FILES.length * CHUNKS_PER_REGION} chunks in three regions`, () => {
    const router = loadOverworldRouter();
    let comparedColumns = 0;
    let exactColumns = 0;
    let absoluteErrorSum = 0;
    let fillMilliseconds = 0;
    let oceanColumns = 0;
    let landColumns = 0;
    for (const fileName of REGION_FILES) {
      const { chunks } = JSON.parse(gunzipSync(readFileSync(`${GROUND_TRUTH_FIXTURE_DIRECTORY}/${fileName}`)).toString()) as { chunks: GroundTruthChunk[] };
      for (const chunk of chunks.slice(0, CHUNKS_PER_REGION)) {
        const realBlocks = new Uint16Array(new Uint8Array(Buffer.from(chunk.blocks, "base64")).buffer);
        const realIsTerrain = chunk.blockPalette.map((name) => !NOT_TERRAIN.test(name));
        const realIsManMade = chunk.blockPalette.map((name) => MAN_MADE.test(name));
        const fillStart = performance.now();
        const ours = fillChunkColumn({ router, chunkX: chunk.chunkX, chunkZ: chunk.chunkZ, minY: -64, height: 384, seaLevel: 63 });
        fillMilliseconds += performance.now() - fillStart;
        for (let localZ = 0; localZ < 16; localZ++) {
          for (let localX = 0; localX < 16; localX++) {
            const realTop = highestMatchingY(384, (index) => realIsTerrain[realBlocks[index]], localX, localZ);
            if (realTop >= 0 && realIsManMade[realBlocks[realTop * 256 + localZ * 16 + localX]]) continue;
            const ourTop = highestMatchingY(384, (index) => ours[index] === BLOCK_DEFAULT_BLOCK, localX, localZ);
            comparedColumns++;
            if (ourTop === realTop) exactColumns++;
            absoluteErrorSum += Math.abs(ourTop - realTop);
            if (ourTop - 64 < 62) oceanColumns++;
            else landColumns++;
          }
        }
      }
    }
    const exactMatchRate = exactColumns / comparedColumns;
    const meanAbsoluteError = absoluteErrorSum / comparedColumns;
    const millisecondsPerChunk = fillMilliseconds / (REGION_FILES.length * CHUNKS_PER_REGION);
    console.log(
      `surface height: ${comparedColumns} columns, exact ${(100 * exactMatchRate).toFixed(2)}%, MAE ${meanAbsoluteError.toFixed(3)} blocks, ` +
        `${oceanColumns} ocean / ${landColumns} land columns, ${millisecondsPerChunk.toFixed(1)} ms per 16x16x384 chunk`,
    );
    expect(comparedColumns).toBeGreaterThan(REGION_FILES.length * CHUNKS_PER_REGION * 200);
    expect(exactMatchRate).toBeGreaterThan(0.95);
    expect(meanAbsoluteError).toBeLessThan(0.3);
    expect(oceanColumns).toBeGreaterThan(0);
    expect(landColumns).toBeGreaterThan(0);
  }, 120_000);
});

afterAll(() => {
  console.log(`fill-chunk-column.test.ts: ${(performance.now() - suiteStart).toFixed(0)} ms`);
});
