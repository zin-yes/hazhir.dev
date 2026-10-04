// Aquifers and ore veins against the real Minecraft 1.20.6 classes (Terralith, seed 1337), recorded by
// carvers/fixtures/CarversReference.java: whole doFill outputs (Aquifer.NoiseBasedAquifer + OreVeinifier) block by
// block, and NoiseBasedAquifer.computeSubstance at random positions and densities.

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { loadOverworldRouter, TEST_SEED, TERRALITH_DATA_AVAILABLE } from "../density/terralith-test-data.node";
import { createRootRandomFactory } from "../noise";
import { createChunkAquifer, fillChunkColumnDetailed } from "./fill-chunk-column";
import { NULL_SUBSTANCE } from "./aquifer";
import { BLOCK_DEFAULT_FLUID, BLOCK_LAVA, TERRAIN_BLOCK_SYMBOL_COUNT, terrainSymbolStates } from "./terrain-blocks";

interface RecordedFill {
  chunkX: number;
  chunkZ: number;
  blocksPalette: string[];
  blocks: string;
}

interface RecordedAquiferSamples {
  chunkX: number;
  chunkZ: number;
  samples: [number, number, number, number, string][];
}

const MIN_Y = -64;
const HEIGHT = 384;
const SEA_LEVEL = 63;
const suiteStart = performance.now();

const recorded = TERRALITH_DATA_AVAILABLE
  ? (JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/aquifer-reference-vectors.json.gz", import.meta.url))).toString()) as {
      fills: RecordedFill[];
      aquifer: RecordedAquiferSamples[];
    })
  : undefined;

function decodeUint16(base64: string): Uint16Array {
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  return new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}

(recorded ? describe : describe.skip)("aquifers and ore veins versus the real classes", () => {
  const router = loadOverworldRouter();
  const rootRandomFactory = createRootRandomFactory(TEST_SEED);
  const symbolNames = terrainSymbolStates("minecraft:stone", "minecraft:water[level=0]").map((state) => state.split("[")[0]!);

  test("doFill with aquifers and veins reproduces every block of the recorded chunks", () => {
    const fills = recorded!.fills;
    expect(fills.length).toBeGreaterThanOrEqual(10);
    let comparedBlocks = 0;
    let mismatchedBlocks = 0;
    const firstMismatches: string[] = [];
    const symbolCounts = new Array<number>(TERRAIN_BLOCK_SYMBOL_COUNT).fill(0);
    let fillMilliseconds = 0;
    for (const fill of fills) {
      const start = performance.now();
      const { blocks } = fillChunkColumnDetailed({
        router,
        chunkX: fill.chunkX,
        chunkZ: fill.chunkZ,
        minY: MIN_Y,
        height: HEIGHT,
        seaLevel: SEA_LEVEL,
        aquifers: { rootRandomFactory },
      });
      fillMilliseconds += performance.now() - start;
      const realIds = decodeUint16(fill.blocks);
      for (let index = 0; index < blocks.length; index++) {
        symbolCounts[blocks[index]!]!++;
        const ourName = symbolNames[blocks[index]!];
        const realName = fill.blocksPalette[realIds[index]!];
        comparedBlocks++;
        if (ourName !== realName) {
          mismatchedBlocks++;
          if (firstMismatches.length < 5) {
            const y = MIN_Y + Math.floor(index / 256);
            firstMismatches.push(`chunk ${fill.chunkX},${fill.chunkZ} (${index % 16}, ${y}, ${Math.floor((index % 256) / 16)}): ours ${ourName}, real ${realName}`);
          }
        }
      }
    }
    console.log(
      `aquifer fill: ${fills.length} chunks, ${comparedBlocks} blocks, ${mismatchedBlocks} mismatches, ` +
        `${(fillMilliseconds / fills.length).toFixed(0)} ms per chunk; symbols ${symbolCounts.join(",")}`,
    );
    expect(firstMismatches).toEqual([]);
    expect(mismatchedBlocks).toBe(0);
    // The recorded chunks must actually exercise every branch, otherwise exact equality proves little.
    expect(symbolCounts[BLOCK_DEFAULT_FLUID]).toBeGreaterThan(0);
    expect(symbolCounts[BLOCK_LAVA]).toBeGreaterThan(0);
    for (let veinSymbol = BLOCK_LAVA + 1; veinSymbol < TERRAIN_BLOCK_SYMBOL_COUNT; veinSymbol++) {
      expect(symbolCounts[veinSymbol]).toBeGreaterThan(0);
    }
  });

  test("computeSubstance matches at random positions and densities (carvers ask with density 0)", () => {
    const sampleSets = recorded!.aquifer;
    let comparedSamples = 0;
    const nonNullByName = new Map<string, number>();
    const mismatches: string[] = [];
    for (const sampleSet of sampleSets) {
      const aquifer = createChunkAquifer({
        router,
        chunkX: sampleSet.chunkX,
        chunkZ: sampleSet.chunkZ,
        minY: MIN_Y,
        height: HEIGHT,
        seaLevel: SEA_LEVEL,
        rootRandomFactory,
      });
      for (const [blockX, blockY, blockZ, density, realName] of sampleSet.samples) {
        const symbol = aquifer.computeSubstance({ blockX, blockY, blockZ }, density);
        const ourName = symbol === NULL_SUBSTANCE ? "null" : symbolNames[symbol]!;
        comparedSamples++;
        if (ourName !== realName) mismatches.push(`(${blockX}, ${blockY}, ${blockZ}) density ${density}: ours ${ourName}, real ${realName}`);
        if (realName !== "null") nonNullByName.set(realName, (nonNullByName.get(realName) ?? 0) + 1);
      }
    }
    console.log(`aquifer samples: ${comparedSamples} compared, ${mismatches.length} mismatches, real non-null ${JSON.stringify([...nonNullByName])}`);
    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(nonNullByName.get("minecraft:water") ?? 0).toBeGreaterThan(0);
    expect(nonNullByName.get("minecraft:air") ?? 0).toBeGreaterThan(0);
  });
});

afterAll(() => {
  console.log(`aquifer.test.ts: ${(performance.now() - suiteStart).toFixed(0)} ms`);
});
