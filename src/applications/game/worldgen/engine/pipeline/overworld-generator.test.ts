// Verifies the base overworld pipeline against the real Minecraft 1.20.6 + Terralith server (seed 1337) chunks.
// Needs the scratch datapacks and fixtures (env WORLDGEN_SCRATCH), so every test skips itself when they are absent.
// The default run samples a few dozen fixture chunks; RUN_INTEGRATION=1 compares all of them.

import { describe, expect, test } from "bun:test";
import { createOverworldGenerator, type ColumnStage, type OverworldGenerator } from "./index";
import {
  compareChunkBiomes,
  compareChunkTerrain,
  createTerrainComparison,
  FIXTURE_SEED,
  formatTopPairs,
  loadAllFixtureChunks,
  loadDatapacks,
  RUN_INTEGRATION,
  sampleEvenly,
  WORLDGEN_DATA_AVAILABLE,
  type BiomeComparison,
  type FixtureChunk,
} from "./pipeline-fixtures.node";

const DEFAULT_RUN_CHUNK_STRIDE = 50;
const chunkStride = RUN_INTEGRATION ? 1 : DEFAULT_RUN_CHUNK_STRIDE;

function createGenerator(extra: { stages?: ColumnStage[] } = {}): OverworldGenerator {
  const { registries, overworldDimension, blockTags } = loadDatapacks();
  return createOverworldGenerator({ registries, overworldDimension: overworldDimension!, blockTags, seed: FIXTURE_SEED, ...extra });
}

function selectChunks(): FixtureChunk[] {
  return sampleEvenly(loadAllFixtureChunks(), chunkStride);
}

function logDuration(label: string, startedAt: number, detail = ""): void {
  console.log(`[pipeline] ${label}: ${(performance.now() - startedAt).toFixed(0)} ms ${detail}`);
}

describe.skipIf(!WORLDGEN_DATA_AVAILABLE)("overworld pipeline vs real server fixtures", () => {
  test("raw biomes equal the stored biomes at every quart cell", () => {
    const startedAt = performance.now();
    const generator = createGenerator();
    const chunks = selectChunks();
    expect(chunks.length).toBeGreaterThan(20);
    const comparison: BiomeComparison = { cellsCompared: 0, cellsMatching: 0, mismatchCountsByPair: new Map() };
    for (const chunk of chunks) compareChunkBiomes(chunk, generator.rawBiomeAtQuart, comparison);
    const distinctBiomes = new Set<string>();
    for (const chunk of chunks) for (const biomeIndex of chunk.biomes) distinctBiomes.add(chunk.biomePalette[biomeIndex]!);
    logDuration(
      "biomes",
      startedAt,
      `${chunks.length} chunks, ${comparison.cellsCompared} cells, ${((100 * comparison.cellsMatching) / comparison.cellsCompared).toFixed(4)}% exact, ${distinctBiomes.size} distinct biomes\n${formatTopPairs(comparison.mismatchCountsByPair, 10)}`,
    );
    expect(distinctBiomes.size).toBeGreaterThan(8);
    expect(comparison.cellsCompared).toBeGreaterThanOrEqual(chunks.length * 1024);
    expect(comparison.cellsMatching).toBe(comparison.cellsCompared);
  }, 600_000);

  test("terrain and surface blocks match the real plain-terrain blocks", () => {
    const startedAt = performance.now();
    const generator = createGenerator();
    const chunks = selectChunks();
    const comparison = createTerrainComparison();
    let coldMilliseconds = 0;
    let warmMilliseconds = 0;
    chunks.forEach((chunk, chunkIndex) => {
      const columnStartedAt = performance.now();
      const column = generator.generateBaseColumn(chunk.chunkX, chunk.chunkZ);
      const elapsed = performance.now() - columnStartedAt;
      if (chunkIndex === 0) coldMilliseconds = elapsed;
      else warmMilliseconds += elapsed;
      compareChunkTerrain(chunk, column, comparison);
    });
    const overallRate = comparison.blocksMatching / comparison.blocksCompared;
    const surfaceBandRate = comparison.surfaceBandMatching / comparison.surfaceBandCompared;
    logDuration(
      "terrain",
      startedAt,
      `${chunks.length} chunks, cold column ${coldMilliseconds.toFixed(0)} ms, warm ${(warmMilliseconds / (chunks.length - 1)).toFixed(1)} ms/column, ` +
        `overall ${(100 * overallRate).toFixed(3)}% of ${comparison.blocksCompared}, surface band ${(100 * surfaceBandRate).toFixed(3)}% of ${comparison.surfaceBandCompared}, ` +
        `real ground that is air/fluid in ours ${comparison.solidnessMismatches}\n${formatTopPairs(comparison.mismatchCountsByPair, 12)}`,
    );
    expect(comparison.blocksCompared).toBeGreaterThan(500_000);
    expect(comparison.surfaceBandCompared).toBeGreaterThan(30_000);
    expect(overallRate).toBeGreaterThan(0.99);
    expect(surfaceBandRate).toBeGreaterThan(0.96);
    expect(comparison.solidnessMismatches / comparison.blocksCompared).toBeLessThan(0.005);
  }, 1_800_000);

  test("a column does not depend on which neighbours were generated first", () => {
    const startedAt = performance.now();
    const chunks = selectChunks();
    const target = chunks[3]!;
    const freshGenerator = createGenerator();
    const expected = freshGenerator.generateBaseColumn(target.chunkX, target.chunkZ);
    const warmedGenerator = createGenerator();
    warmedGenerator.generateBaseColumn(target.chunkX + 1, target.chunkZ - 1);
    warmedGenerator.generateBaseColumn(target.chunkX - 1, target.chunkZ);
    const actual = warmedGenerator.generateBaseColumn(target.chunkX, target.chunkZ);
    let differingBlocks = 0;
    for (let y = expected.minY; y <= expected.maxY; y++) {
      for (let localZ = 0; localZ < 16; localZ++) {
        for (let localX = 0; localX < 16; localX++) {
          if (expected.getState(localX, y, localZ) !== actual.getState(localX, y, localZ)) differingBlocks++;
        }
      }
    }
    logDuration("order independence", startedAt, `${differingBlocks} differing blocks`);
    expect(differingBlocks).toBe(0);
    expect(freshGenerator.generateBaseColumn(target.chunkX, target.chunkZ)).toBe(expected);
  }, 120_000);

  test("surfaceHeight follows the generated column and ocean floor never exceeds world surface", () => {
    const startedAt = performance.now();
    const generator = createGenerator();
    const chunks = sampleEvenly(loadAllFixtureChunks(), 200);
    let columnsWithWater = 0;
    for (const chunk of chunks) {
      const column = generator.generateBaseColumn(chunk.chunkX, chunk.chunkZ);
      for (let localZ = 0; localZ < 16; localZ += 5) {
        for (let localX = 0; localX < 16; localX += 5) {
          const blockX = chunk.chunkX * 16 + localX;
          const blockZ = chunk.chunkZ * 16 + localZ;
          const worldSurface = generator.surfaceHeight(blockX, blockZ, "WORLD_SURFACE_WG");
          const oceanFloor = generator.surfaceHeight(blockX, blockZ, "OCEAN_FLOOR_WG");
          expect(column.getState(localX, worldSurface - 1, localZ)).not.toBe("minecraft:air");
          if (worldSurface < column.maxY) expect(column.getState(localX, worldSurface, localZ)).toBe("minecraft:air");
          expect(oceanFloor).toBeLessThanOrEqual(worldSurface);
          if (oceanFloor < worldSurface) {
            columnsWithWater++;
            expect(column.getState(localX, worldSurface - 1, localZ)).toContain("water");
          }
        }
      }
    }
    logDuration("surface height", startedAt, `${columnsWithWater} columns with fluid above the floor`);
    expect(columnsWithWater).toBeGreaterThan(0);
  }, 120_000);

  test("stages run once per column in list order and cached columns are reused", () => {
    const executionLog: string[] = [];
    const recordingStage = (name: string): ColumnStage => ({
      name,
      run(column, context) {
        executionLog.push(`${name}@${context.chunkX},${context.chunkZ}`);
        column.setState(0, column.minY, 0, `minecraft:${name}`);
      },
    });
    const generator = createGenerator({ stages: [recordingStage("stone"), recordingStage("dirt")] });
    const first = generator.generateBaseColumn(3, -2);
    const second = generator.generateBaseColumn(3, -2);
    generator.generateBaseColumn(4, -2);
    expect(second).toBe(first);
    expect(executionLog).toEqual(["stone@3,-2", "dirt@3,-2", "stone@4,-2", "dirt@4,-2"]);
    expect(first.getState(0, -64, 0)).toBe("minecraft:dirt");
  });
});
