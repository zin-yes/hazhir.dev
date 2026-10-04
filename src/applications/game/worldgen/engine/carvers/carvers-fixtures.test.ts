// Whole generated columns (fill with aquifers and veins -> surface -> carvers) against chunks of the real Terralith
// server (seed 1337, $SCRATCH/fixtures). The real chunks also hold features, structures and lava/water springs, so
// only open-versus-solid below the surface is compared, as agreement rates and per-class fractions.
// Default: a few chunks per region. RUN_INTEGRATION=1: a larger sample over every region.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { blockNameOf } from "../chunk";
import { GROUND_TRUTH_FIXTURE_DIRECTORY, TERRALITH_DATA_AVAILABLE } from "../density/terralith-test-data.node";
import { generateCarvedColumn } from "./full-column-test-world.node";

interface GroundTruthChunk {
  chunkX: number;
  chunkZ: number;
  blockPalette: string[];
  blocks: string;
}

const MIN_Y = -64;
const BAND_FIRST_Y = -60;
const BAND_LAST_Y = 35;
const FULL_RUN = process.env.RUN_INTEGRATION === "1";
const REGION_FILES = FULL_RUN
  ? ["r.0.0.json.gz", "r.-1.-1.json.gz", "r.23.23.json.gz", "r.-12.4.json.gz", "r.8.8.json.gz", "r.-11.3.json.gz"]
  : ["r.0.0.json.gz", "r.23.23.json.gz", "r.-12.4.json.gz"];
const CHUNKS_PER_REGION = FULL_RUN ? 40 : 2;
const suiteStart = performance.now();
const fixturesAvailable = TERRALITH_DATA_AVAILABLE && REGION_FILES.every((file) => existsSync(`${GROUND_TRUTH_FIXTURE_DIRECTORY}/${file}`));

const OPEN_BLOCK_NAMES = new Set(["minecraft:air", "minecraft:cave_air", "minecraft:water", "minecraft:lava"]);

(fixturesAvailable ? describe : describe.skip)("carved columns versus the real Terralith world", () => {
  test("open space below the surface matches, and the carvers are what makes it match", () => {
    let comparedBlocks = 0;
    let agreeingWithCarvers = 0;
    let agreeingWithoutCarvers = 0;
    let realOpen = 0;
    let oursOpen = 0;
    let realCaveAirBlocks = 0;
    let oursCaveAirBlocks = 0;
    let carveMilliseconds = 0;
    let generatedChunks = 0;
    const bandStartIndex = (BAND_FIRST_Y - MIN_Y) * 256;
    const bandEndIndex = (BAND_LAST_Y - MIN_Y + 1) * 256;
    for (const fileName of REGION_FILES) {
      const { chunks } = JSON.parse(gunzipSync(readFileSync(`${GROUND_TRUTH_FIXTURE_DIRECTORY}/${fileName}`)).toString()) as { chunks: GroundTruthChunk[] };
      const stride = Math.max(1, Math.floor(chunks.length / CHUNKS_PER_REGION));
      for (let chunkIndex = 0; chunkIndex < chunks.length && generatedChunks < REGION_FILES.length * CHUNKS_PER_REGION; chunkIndex += stride) {
        const real = chunks[chunkIndex]!;
        const realBytes = new Uint8Array(Buffer.from(real.blocks, "base64"));
        const realIds = new Uint16Array(realBytes.buffer, realBytes.byteOffset, realBytes.byteLength / 2);
        const realIsOpen = real.blockPalette.map((name) => OPEN_BLOCK_NAMES.has(name));
        const generated = generateCarvedColumn(real.chunkX, real.chunkZ);
        generatedChunks++;
        carveMilliseconds += generated.carveMilliseconds;
        const palette = generated.chunk.palette;
        const ourIsOpenById: boolean[] = [];
        const isOpen = (paletteId: number) => (ourIsOpenById[paletteId] ??= OPEN_BLOCK_NAMES.has(blockNameOf(palette.stateOf(paletteId))));
        for (let index = bandStartIndex; index < bandEndIndex; index++) {
          const realOpenHere = realIsOpen[realIds[index]!]!;
          const carvedOpenHere = isOpen(generated.chunk.blocks[index]!);
          const uncarvedOpenHere = isOpen(generated.preCarveBlocks[index]!);
          comparedBlocks++;
          if (realOpenHere === carvedOpenHere) agreeingWithCarvers++;
          if (realOpenHere === uncarvedOpenHere) agreeingWithoutCarvers++;
          if (realOpenHere) realOpen++;
          if (carvedOpenHere) oursOpen++;
          if (real.blockPalette[realIds[index]!] === "minecraft:cave_air") realCaveAirBlocks++;
          if (blockNameOf(palette.stateOf(generated.chunk.blocks[index]!)) === "minecraft:cave_air") oursCaveAirBlocks++;
        }
      }
    }
    const agreementWithCarvers = agreeingWithCarvers / comparedBlocks;
    const agreementWithoutCarvers = agreeingWithoutCarvers / comparedBlocks;
    console.log(
      `carved columns: ${generatedChunks} chunks, y ${BAND_FIRST_Y}..${BAND_LAST_Y}: open/solid agreement ${(100 * agreementWithCarvers).toFixed(2)}% ` +
        `(${(100 * agreementWithoutCarvers).toFixed(2)}% without carvers), open fraction real ${(100 * realOpen / comparedBlocks).toFixed(2)}% ours ${(100 * oursOpen / comparedBlocks).toFixed(2)}%, ` +
        `cave_air blocks real ${realCaveAirBlocks} ours ${oursCaveAirBlocks}, carve ${(carveMilliseconds / generatedChunks).toFixed(1)} ms per chunk`,
    );
    expect(generatedChunks).toBeGreaterThanOrEqual(REGION_FILES.length * 2);
    expect(realOpen).toBeGreaterThan(generatedChunks * 500);
    expect(agreementWithCarvers).toBeGreaterThan(0.97);
    expect(agreementWithCarvers - agreementWithoutCarvers).toBeGreaterThan(0.005);
    expect(Math.abs(oursOpen - realOpen) / comparedBlocks).toBeLessThan(0.01);
  }, 600_000);
});

afterAll(() => {
  console.log(`carvers-fixtures.test.ts: ${(performance.now() - suiteStart).toFixed(0)} ms`);
});
