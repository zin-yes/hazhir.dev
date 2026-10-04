// Compares our surface stage with the real Minecraft 1.20.6 + Terralith server (seed 1337) on the fixture chunks.
// The pre-surface column comes from the real chunk (see surface-fixture.node.ts), the biomes from the real biome
// storage zoomed by BiomeManager, and everything else (noises, rules, preliminary surface level) is ours.
// Needs the scratch datapack and fixtures, so it skips itself when WORLDGEN_SCRATCH data is absent.

import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { BiomeManager } from "../biome-source";
import { buildSurface } from "./surface-system";
import {
  buildTerrainFromFixture,
  chunkKey,
  compareColumnLayers,
  createRawBiomeLookup,
  loadFixtureFile,
  type FixtureChunk,
} from "./surface-fixture.node";
import { createSeedNoiseStack, FIXTURE_DIRECTORY, HAS_WORLDGEN_DATA, TEST_SEED } from "./surface-test-world.node";

const COMPARED_LAYER_COUNT = 6;
const CHUNK_STRIDE = Number(process.env.SURFACE_FIXTURE_STRIDE ?? 12);

interface BiomeTally {
  columns: number;
  exactColumns: number;
  layers: number;
  matchingLayers: number;
  sampleMismatches: string[];
}

describe.skipIf(!HAS_WORLDGEN_DATA)("surface stage vs real server fixtures", () => {
  test("top layers match the real world per biome", () => {
    const startedAt = performance.now();
    const chunksByKey = new Map<string, FixtureChunk>();
    for (const fileName of readdirSync(FIXTURE_DIRECTORY)) {
      for (const chunk of loadFixtureFile(`${FIXTURE_DIRECTORY}/${fileName}`)) {
        chunksByKey.set(chunkKey(chunk.chunkX, chunk.chunkZ), chunk);
      }
    }
    const world = createSeedNoiseStack();
    const router = world.createRouter();
    const rawBiome = createRawBiomeLookup(chunksByKey);
    const biomeManager = new BiomeManager((quartX, quartY, quartZ) => rawBiome(quartX, quartY, quartZ) ?? "minecraft:plains", TEST_SEED);

    const interiorChunks = [...chunksByKey.values()].filter((chunk) => {
      for (let deltaX = -1; deltaX <= 1; deltaX++) {
        for (let deltaZ = -1; deltaZ <= 1; deltaZ++) {
          if (!chunksByKey.has(chunkKey(chunk.chunkX + deltaX, chunk.chunkZ + deltaZ))) return false;
        }
      }
      return true;
    });
    const sampledChunks = interiorChunks.filter((_, index) => index % CHUNK_STRIDE === 0);
    expect(sampledChunks.length).toBeGreaterThan(20);

    const talliesByBiome = new Map<string, BiomeTally>();
    const overall: BiomeTally = { columns: 0, exactColumns: 0, layers: 0, matchingLayers: 0, sampleMismatches: [] };
    let surfaceMilliseconds = 0;
    for (const fixture of sampledChunks) {
      const { terrain, topGroundY } = buildTerrainFromFixture(fixture);
      const surfaceStartedAt = performance.now();
      buildSurface({
        chunk: terrain,
        router,
        noises: world.noises,
        randomFactory: world.randomFactory,
        biomeAt: (blockX, blockY, blockZ) => biomeManager.getBiome(blockX, blockY, blockZ),
        surfaceRule: world.surfaceRule,
        seaLevel: world.seaLevel,
        defaultBlock: "minecraft:stone",
        biomeClimate: world.biomeClimate,
      });
      surfaceMilliseconds += performance.now() - surfaceStartedAt;
      for (let localZ = 0; localZ < 16; localZ++) {
        for (let localX = 0; localX < 16; localX++) {
          const columnTopY = topGroundY[localZ * 16 + localX];
          if (columnTopY === null || columnTopY === undefined) continue;
          const comparison = compareColumnLayers(fixture, terrain, localX, localZ, columnTopY, COMPARED_LAYER_COUNT);
          const biome = biomeManager.getBiome(fixture.chunkX * 16 + localX, columnTopY + 1, fixture.chunkZ * 16 + localZ);
          let tally = talliesByBiome.get(biome);
          if (!tally) {
            tally = { columns: 0, exactColumns: 0, layers: 0, matchingLayers: 0, sampleMismatches: [] };
            talliesByBiome.set(biome, tally);
          }
          for (const target of [tally, overall]) {
            target.columns++;
            target.layers += comparison.layersCompared;
            target.matchingLayers += comparison.layersMatching;
            if (comparison.layersMatching === comparison.layersCompared) target.exactColumns++;
            else if (target.sampleMismatches.length < 3) {
              const first = comparison.mismatches[0]!;
              target.sampleMismatches.push(
                `(${fixture.chunkX * 16 + localX},${first.y},${fixture.chunkZ * 16 + localZ}) expected ${first.expected} got ${first.actual}`,
              );
            }
          }
        }
      }
    }

    const report = [...talliesByBiome.entries()]
      .sort((first, second) => second[1].columns - first[1].columns)
      .map(
        ([biome, tally]) =>
          `${biome.padEnd(40)} cols ${String(tally.columns).padStart(6)}  exact ${((100 * tally.exactColumns) / tally.columns).toFixed(1).padStart(5)}%  layers ${((100 * tally.matchingLayers) / tally.layers).toFixed(1).padStart(5)}%` +
          (tally.exactColumns < tally.columns ? `  e.g. ${tally.sampleMismatches.join("; ")}` : ""),
      );
    console.log(report.join("\n"));
    console.log(
      `OVERALL chunks ${sampledChunks.length} columns ${overall.columns} exact-column ${((100 * overall.exactColumns) / overall.columns).toFixed(2)}% layer ${((100 * overall.matchingLayers) / overall.layers).toFixed(2)}%`,
    );
    console.log(
      `surface-fixtures.test.ts: total ${(performance.now() - startedAt).toFixed(0)} ms, buildSurface ${surfaceMilliseconds.toFixed(0)} ms (${(surfaceMilliseconds / sampledChunks.length).toFixed(1)} ms per chunk)`,
    );
    expect(overall.matchingLayers / overall.layers).toBeGreaterThan(0.93);
  }, 600_000);
});
