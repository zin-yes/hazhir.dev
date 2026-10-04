// Carvers against the real Minecraft 1.20.6 classes (Terralith, seed 1337): chunks recorded after doFill + buildSurface,
// then after the real applyCarvers loop (fixtures/CarversReference.java), compared block by block with ours, plus
// checks that the real Terralith carver data is read the way Java reads it.

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { blockNameOf } from "../chunk";
import { TERRALITH_DATA_AVAILABLE } from "../density/terralith-test-data.node";
import { parseConfiguredCarver, readBiomeAirCarverIds } from "./carver-config";
import { chunkFromRecordedNames, createChunkAquifer, HEIGHT, loadCarverTestWorld, MIN_Y, SEA_LEVEL } from "./carver-test-world.node";
import { LegacyRandomSource } from "../random";
import { mthCos, mthSin } from "./float-math";
import { parseFloatProvider } from "./value-providers";

interface RecordedCarvedChunk {
  chunkX: number;
  chunkZ: number;
  prePalette: string[];
  pre: string;
  postPalette: string[];
  post: string;
  caveStarts: number;
  canyonStarts: number;
}

const suiteStart = performance.now();

const recorded = TERRALITH_DATA_AVAILABLE
  ? (JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/carvers-reference-vectors.json.gz", import.meta.url))).toString()) as {
      carved: RecordedCarvedChunk[];
    })
  : undefined;

describe("carver value math", () => {
  test("Mth.sin and Mth.cos match the real Mth float lookup table", () => {
    // Printed by the real net.minecraft.util.Mth (Java float values).
    const recordedValues: [number, number, number][] = [
      [1, 0.8414514, 0.54033285],
      [1.5707964, 1, 1.2246469e-16],
      [-0.35, -0.34284085, 0.9393606],
      [3, 0.14113283, -0.98999065],
      [0.5, 0.47940964, 0.87759125],
      [123.456, -0.8038923, -0.59477484],
      [-4.2, 0.87154806, -0.49031004],
    ];
    for (const [angle, expectedSin, expectedCos] of recordedValues) {
      expect(mthSin(Math.fround(angle))).toBe(Math.fround(expectedSin));
      expect(mthCos(Math.fround(angle))).toBe(Math.fround(expectedCos));
    }
  });

  test("float providers sample in Java float arithmetic from a seeded Legacy random", () => {
    const provider = parseFloatProvider({ type: "minecraft:uniform", min_inclusive: 0.7, max_exclusive: 1.4 });
    const random = new LegacyRandomSource(BigInt(42));
    const samples = Array.from({ length: 2000 }, () => provider.sample(random));
    for (const sample of samples) expect(sample).toBe(Math.fround(sample));
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(Math.fround(0.7));
    expect(Math.max(...samples)).toBeLessThan(Math.fround(1.4));
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.6);
  });
});

(TERRALITH_DATA_AVAILABLE ? describe : describe.skip)("real Terralith carver data", () => {
  test("Terralith's canyon override and the vanilla caves parse, with the biome carver order Java uses", () => {
    const { registries, blockTags } = loadCarverTestWorld();
    const canyon = parseConfiguredCarver("minecraft:canyon", registries.configured_carver["minecraft:canyon"]!, blockTags);
    const cave = parseConfiguredCarver("minecraft:cave", registries.configured_carver["minecraft:cave"]!, blockTags);
    const extraCave = parseConfiguredCarver("minecraft:cave_extra_underground", registries.configured_carver["minecraft:cave_extra_underground"]!, blockTags);
    expect(canyon.kind).toBe("canyon");
    expect(canyon.probability).toBe(Math.fround(0.003));
    expect(cave.probability).toBe(Math.fround(0.15));
    expect(extraCave.probability).toBe(Math.fround(0.07));
    expect(cave.replaceable.has("minecraft:stone")).toBe(true);
    expect(cave.replaceable.has("minecraft:grass_block")).toBe(true);
    expect(cave.replaceable.has("minecraft:bedrock")).toBe(false);
    expect(readBiomeAirCarverIds(registries.biome["minecraft:plains"]!)).toEqual([
      "minecraft:cave",
      "minecraft:cave_extra_underground",
      "minecraft:canyon",
    ]);
  });
});

(recorded ? describe : describe.skip)("applyCarvers versus the real classes", () => {
  test("carved chunks match the real post-carve blocks", () => {
    const world = loadCarverTestWorld();
    let comparedBlocks = 0;
    let mismatches = 0;
    let carvedByReal = 0;
    let carvedByUs = 0;
    let dirtReplacedByRealTopMaterial = 0;
    const firstMismatches: string[] = [];
    let carveMilliseconds = 0;
    for (const entry of recorded!.carved) {
      const chunk = chunkFromRecordedNames(entry.chunkX, entry.chunkZ, entry.prePalette, entry.pre);
      const aquifer = createChunkAquifer({
        router: world.router,
        chunkX: entry.chunkX,
        chunkZ: entry.chunkZ,
        minY: MIN_Y,
        height: HEIGHT,
        seaLevel: SEA_LEVEL,
        rootRandomFactory: world.rootRandomFactory,
      });
      const preNames = Array.from(chunk.blocks, (id) => blockNameOf(chunk.palette.stateOf(id)));
      const start = performance.now();
      world.carverSystem.applyCarvers({
        chunk,
        aquifer,
        symbolStates: world.symbolStates,
        topMaterial: world.createTopMaterialSource(chunk, world.biomeAtBlock),
      });
      carveMilliseconds += performance.now() - start;
      const postBytes = new Uint8Array(Buffer.from(entry.post, "base64"));
      const realPostIds = new Uint16Array(postBytes.buffer, postBytes.byteOffset, postBytes.byteLength / 2);
      for (let index = 0; index < chunk.blocks.length; index++) {
        const ourName = blockNameOf(chunk.palette.stateOf(chunk.blocks[index]!));
        const realName = entry.postPalette[realPostIds[index]!];
        comparedBlocks++;
        if (realName !== preNames[index]) carvedByReal++;
        if (preNames[index] === "minecraft:dirt" && realName !== "minecraft:dirt" && realName !== "minecraft:air") dirtReplacedByRealTopMaterial++;
        if (ourName !== preNames[index]) carvedByUs++;
        if (ourName !== realName) {
          mismatches++;
          if (firstMismatches.length < 6) {
            firstMismatches.push(`chunk ${entry.chunkX},${entry.chunkZ} (${index % 16}, ${MIN_Y + Math.floor(index / 256)}, ${Math.floor((index % 256) / 16)}): pre ${preNames[index]}, ours ${ourName}, real ${realName}`);
          }
        }
      }
    }
    console.log(
      `carve: ${recorded!.carved.length} chunks (${recorded!.carved.reduce((sum, entry) => sum + entry.canyonStarts, 0)} canyon starts in range), ` +
        `${comparedBlocks} blocks, real changed ${carvedByReal} (${dirtReplacedByRealTopMaterial} dirt restored by top material), ours changed ${carvedByUs}, ${mismatches} mismatches, ` +
        `${(carveMilliseconds / recorded!.carved.length).toFixed(0)} ms per chunk`,
    );
    expect(carvedByReal).toBeGreaterThan(20_000);
    expect(dirtReplacedByRealTopMaterial).toBeGreaterThan(30);
    expect(firstMismatches).toEqual([]);
    expect(mismatches).toBe(0);
  });

  test("the recorded chunks include canyon starts and real top-material restoration", () => {
    expect(recorded!.carved.some((entry) => entry.canyonStarts > 0)).toBe(true);
    expect(recorded!.carved.some((entry) => entry.caveStarts >= 40)).toBe(true);
  });
});

afterAll(() => {
  console.log(`carvers.test.ts: ${(performance.now() - suiteStart).toFixed(0)} ms`);
});
