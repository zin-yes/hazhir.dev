// Open-versus-solid comparison of fully wired columns (aquifers, ore veins, carvers) with real server chunks away from
// structures. Real chunks also hold features (dripstone, moss, ore blobs), so agreement is high but never perfect.
// The default run samples a few chunks; RUN_INTEGRATION=1 samples a few hundred.

import { describe, expect, test } from "bun:test";
import { createOverworldGenerator } from "./index";
import {
  chunkHoldsStructureBlocks,
  FIXTURE_SEED,
  isOpenBlockName,
  loadAllFixtureChunks,
  loadDatapacks,
  MIN_Y,
  RUN_INTEGRATION,
  sampleEvenly,
  WORLDGEN_DATA_AVAILABLE,
} from "./pipeline-fixtures.node";

const FIRST_COMPARED_Y = -60;
const LAST_CAVE_Y = 35;
const LAST_COMPARED_Y = 120;
const REPORT_BAND_HEIGHT = 12;
const SAMPLED_CHUNK_COUNT = RUN_INTEGRATION ? 300 : 6;
const BLOCKS_PER_LAYER = 256;

describe.skipIf(!WORLDGEN_DATA_AVAILABLE)("fully wired columns versus real chunks", () => {
  test("open fraction per y level follows the real world and the underground has lakes, veins and carved caves", () => {
    const startedAt = performance.now();
    const { registries, overworldDimension, blockTags } = loadDatapacks();
    const generator = createOverworldGenerator({ registries, overworldDimension: overworldDimension!, blockTags, seed: FIXTURE_SEED });
    const candidates = loadAllFixtureChunks().filter((chunk) => !chunkHoldsStructureBlocks(chunk));
    const chunks = sampleEvenly(candidates, Math.max(1, Math.floor(candidates.length / SAMPLED_CHUNK_COUNT))).slice(0, SAMPLED_CHUNK_COUNT);
    expect(chunks.length).toBeGreaterThanOrEqual(SAMPLED_CHUNK_COUNT);

    const levelCount = LAST_COMPARED_Y - FIRST_COMPARED_Y + 1;
    const realOpenByLevel = new Float64Array(levelCount);
    const oursOpenByLevel = new Float64Array(levelCount);
    let agreeingBlocks = 0;
    let comparedBlocks = 0;
    let oursWaterBelowSurfaceBlocks = 0;
    let oursLavaBlocks = 0;
    let oursOreVeinBlocks = 0;
    let coldMilliseconds = 0;
    for (const chunk of chunks) {
      const columnStartedAt = performance.now();
      const column = generator.generateBaseColumn(chunk.chunkX, chunk.chunkZ);
      coldMilliseconds += performance.now() - columnStartedAt;
      const realIsOpen = chunk.blockPalette.map(isOpenBlockName);
      for (let blockY = FIRST_COMPARED_Y; blockY <= LAST_COMPARED_Y; blockY++) {
        const level = blockY - FIRST_COMPARED_Y;
        const layerStart = (blockY - MIN_Y) * BLOCKS_PER_LAYER;
        for (let localIndex = 0; localIndex < BLOCKS_PER_LAYER; localIndex++) {
          const realOpen = realIsOpen[chunk.blocks[layerStart + localIndex]!]!;
          const oursName = column.palette.stateOf(column.blocks[layerStart + localIndex]!).split("[")[0]!;
          const oursOpen = isOpenBlockName(oursName);
          if (realOpen) realOpenByLevel[level]!++;
          if (oursOpen) oursOpenByLevel[level]!++;
          if (blockY <= LAST_CAVE_Y) {
            comparedBlocks++;
            if (realOpen === oursOpen) agreeingBlocks++;
            if (oursName === "minecraft:water") oursWaterBelowSurfaceBlocks++;
            if (oursName === "minecraft:lava") oursLavaBlocks++;
            if (oursName.endsWith("_ore") || oursName === "minecraft:granite" || oursName === "minecraft:tuff" || oursName.startsWith("minecraft:raw_")) oursOreVeinBlocks++;
          }
        }
      }
    }

    const blocksPerLevel = chunks.length * BLOCKS_PER_LAYER;
    const bandReports: string[] = [];
    let summedAbsoluteDifference = 0;
    for (let bandStart = 0; bandStart < levelCount; bandStart += REPORT_BAND_HEIGHT) {
      let realOpen = 0;
      let oursOpen = 0;
      const bandEnd = Math.min(levelCount, bandStart + REPORT_BAND_HEIGHT);
      for (let level = bandStart; level < bandEnd; level++) {
        realOpen += realOpenByLevel[level]!;
        oursOpen += oursOpenByLevel[level]!;
        if (level + FIRST_COMPARED_Y <= LAST_CAVE_Y) summedAbsoluteDifference += Math.abs(realOpenByLevel[level]! - oursOpenByLevel[level]!) / blocksPerLevel;
      }
      const bandBlocks = (bandEnd - bandStart) * blocksPerLevel;
      bandReports.push(`  y ${bandStart + FIRST_COMPARED_Y}..${bandEnd - 1 + FIRST_COMPARED_Y}: real open ${((100 * realOpen) / bandBlocks).toFixed(2)}% ours ${((100 * oursOpen) / bandBlocks).toFixed(2)}%`);
    }
    const caveLevelCount = LAST_CAVE_Y - FIRST_COMPARED_Y + 1;
    const meanAbsoluteOpenFractionDifference = summedAbsoluteDifference / caveLevelCount;
    const agreement = agreeingBlocks / comparedBlocks;
    console.log(
      `[pipeline] carved columns: ${chunks.length} chunks away from structures, ${(performance.now() - startedAt).toFixed(0)} ms (${(coldMilliseconds / chunks.length).toFixed(0)} ms per column), ` +
        `y ${FIRST_COMPARED_Y}..${LAST_CAVE_Y} agreement ${(100 * agreement).toFixed(2)}%, mean |open fraction difference| per y ${(100 * meanAbsoluteOpenFractionDifference).toFixed(3)} points, ` +
        `ours: water ${oursWaterBelowSurfaceBlocks} lava ${oursLavaBlocks} vein blocks ${oursOreVeinBlocks}\n${bandReports.join("\n")}`,
    );
    expect(agreement).toBeGreaterThan(0.96);
    expect(meanAbsoluteOpenFractionDifference).toBeLessThan(0.03);
    if (RUN_INTEGRATION) expect(oursOreVeinBlocks).toBeGreaterThan(0);
    expect(oursLavaBlocks).toBeGreaterThan(0);
  }, 1_800_000);

  test("the carvers' point biome sampler picks the stored biome at every chunk's source corner", () => {
    const { registries, overworldDimension, blockTags } = loadDatapacks();
    const generator = createOverworldGenerator({ registries, overworldDimension: overworldDimension!, blockTags, seed: FIXTURE_SEED });
    const chunks = sampleEvenly(loadAllFixtureChunks(), RUN_INTEGRATION ? 10 : 60);
    expect(chunks.length).toBeGreaterThan(20);
    const quartYZeroSection = 4;
    let mismatches = 0;
    for (const chunk of chunks) {
      const storedBiome = chunk.biomePalette[chunk.biomes[quartYZeroSection * 64]!]!;
      if (generator.rawBiomeAtQuart(chunk.chunkX * 4, 0, chunk.chunkZ * 4) !== storedBiome) mismatches++;
    }
    expect(mismatches).toBe(0);
  });
});
