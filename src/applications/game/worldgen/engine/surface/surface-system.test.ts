// Surface rules on the real Terralith `surface_rule` with hand-built columns, plus the clay bands against the
// values produced by Minecraft 1.20.6 itself (SurfaceSystem.generateBands for seed 1337).

import { describe, expect, test } from "bun:test";
import { BlockPalette, ChunkBlocks } from "../chunk";
import { generateClayBands } from "./clay-bands";
import { createSurfaceSystem } from "./surface-system";
import type { SurfaceNoiseRouter } from "./surface-types";
import { createSeedNoiseStack, HAS_WORLDGEN_DATA } from "./surface-test-world.node";

// Recorded from the real class: root factory of seed 1337, fromHashOf("minecraft:clay_bands"), generateBands.
// t terracotta, o orange, y yellow, b brown, r red, w white, l light gray.
const JAVA_CLAY_BANDS_SEED_1337 =
  "wbbrbtrrrttyyyylwltttblwttotlwlttottwlotrrrrrrrtlwlttottttottttotttowlyyytttoyytttotlwltlwltttotbbbbtttotlwltlwttotrwtotytttotttttyrtttotttrrotrotottttorrrbbttotttbbbbtototttottottttotttottott";
const BAND_LETTER_BY_STATE: Record<string, string> = {
  "minecraft:terracotta": "t",
  "minecraft:orange_terracotta": "o",
  "minecraft:yellow_terracotta": "y",
  "minecraft:brown_terracotta": "b",
  "minecraft:red_terracotta": "r",
  "minecraft:white_terracotta": "w",
  "minecraft:light_gray_terracotta": "l",
};

const SEA_LEVEL = 63;
const startedAt = performance.now();

function createStoneColumnChunk(chunkX: number, chunkZ: number, surfaceYAt: (blockX: number, blockZ: number) => number) {
  const chunk = new ChunkBlocks(chunkX, chunkZ, -64, 384, new BlockPalette());
  const stoneId = chunk.palette.idOf("minecraft:stone");
  const waterId = chunk.palette.idOf("minecraft:water[level=0]");
  for (let localZ = 0; localZ < 16; localZ++) {
    for (let localX = 0; localX < 16; localX++) {
      const surfaceY = surfaceYAt(chunkX * 16 + localX, chunkZ * 16 + localZ);
      for (let y = -64; y <= surfaceY; y++) chunk.setId(localX, y, localZ, stoneId);
      for (let y = surfaceY + 1; y < SEA_LEVEL; y++) chunk.setId(localX, y, localZ, waterId);
    }
  }
  return chunk;
}

/** Terrain whose initial density is positive exactly at and below the given surface, as real terrain is. */
function createRouterForSurface(surfaceYAt: (blockX: number, blockZ: number) => number): SurfaceNoiseRouter {
  return {
    initialDensityWithoutJaggedness: {
      compute: ({ blockX, blockY, blockZ }) => (blockY <= surfaceYAt(blockX, blockZ) ? 1 : -1),
    },
  };
}

function columnBlocks(chunk: ChunkBlocks, localX: number, localZ: number, fromY: number, toY: number): string[] {
  const names: string[] = [];
  for (let y = fromY; y >= toY; y--) names.push(chunk.getState(localX, y, localZ).replace(/\[.*\]/, ""));
  return names;
}

describe.skipIf(!HAS_WORLDGEN_DATA)("surface system on real Terralith rules", () => {
  const world = createSeedNoiseStack();
  const system = createSurfaceSystem({
    noises: world.noises,
    randomFactory: world.randomFactory,
    surfaceRule: world.surfaceRule,
    seaLevel: world.seaLevel,
    defaultBlock: "minecraft:stone",
    biomeClimate: world.biomeClimate,
  });

  function runChunk(biome: string, surfaceYAt: (blockX: number, blockZ: number) => number, chunkX = 7, chunkZ = 3) {
    const chunk = createStoneColumnChunk(chunkX, chunkZ, surfaceYAt);
    system.buildSurface({ chunk, router: createRouterForSurface(surfaceYAt), biomeAt: () => biome });
    return chunk;
  }

  test("clay bands match Minecraft's generateBands", () => {
    const bands = generateClayBands(world.randomFactory.fromHashOf("minecraft:clay_bands"));
    expect(bands.map((state) => BAND_LETTER_BY_STATE[state]).join("")).toBe(JAVA_CLAY_BANDS_SEED_1337);
  });

  test("a plains hill is grass over dirt over stone, with deepslate and bedrock at depth", () => {
    const chunk = runChunk("minecraft:plains", () => 90);
    const names = columnBlocks(chunk, 5, 5, 90, -64);
    expect(names[0]).toBe("minecraft:grass_block");
    const dirtLayers = names.slice(1).findIndex((name) => name !== "minecraft:dirt");
    expect(dirtLayers).toBeGreaterThanOrEqual(1);
    expect(names[1 + dirtLayers]).toBe("minecraft:stone");
    expect(names[names.length - 1]).toBe("minecraft:bedrock");
    expect(names.filter((name) => name === "minecraft:bedrock").length).toBeLessThanOrEqual(5);
    expect(chunk.getState(5, -30, 5)).toBe("minecraft:deepslate[axis=y]");
    expect(chunk.getState(5, 30, 5)).toBe("minecraft:stone");
  });

  test("a desert is sand over sandstone, with stone below", () => {
    const chunk = runChunk("minecraft:desert", () => 90);
    const names = columnBlocks(chunk, 8, 8, 90, 60);
    expect(names.slice(0, 2).every((name) => name === "minecraft:sand")).toBe(true);
    expect(names).toContain("minecraft:sandstone");
    expect(names[names.length - 1]).toBe("minecraft:stone");
  });

  test("an ocean floor below the water surface is not grass", () => {
    const chunk = runChunk("minecraft:ocean", () => 40);
    expect(chunk.getState(8, 40, 8)).not.toContain("grass_block");
    expect(chunk.getState(8, 62, 8)).toBe("minecraft:water[level=0]");
  });

  test("a steep step makes the cliff edge stone while flat ground keeps its soil", () => {
    const stepAtX = 7 * 16 + 8;
    const surfaceYAt = (blockX: number) => (blockX < stepAtX ? 90 : 80);
    const chunk = runChunk("terralith:lush_valley", surfaceYAt);
    expect(chunk.getState(7, 90, 5)).toBe("minecraft:stone");
    expect(chunk.getState(8, 80, 5)).toBe("minecraft:stone");
    expect(chunk.getState(2, 90, 5)).not.toBe("minecraft:stone");
    expect(chunk.getState(14, 80, 5)).not.toBe("minecraft:stone");
  });

  test("badlands columns use clay bands that vary with height", () => {
    const chunk = runChunk("minecraft:badlands", () => 100);
    const seenBandBlocks = new Set(columnBlocks(chunk, 3, 3, 99, 70).filter((name) => name.endsWith("terracotta")));
    expect(seenBandBlocks.size).toBeGreaterThanOrEqual(3);
    for (const name of seenBandBlocks) expect(Object.keys(BAND_LETTER_BY_STATE)).toContain(name);
  });

  test("the same column is deterministic across repeated runs", () => {
    const surfaceYAt = (blockX: number, blockZ: number) => 70 + ((blockX * 7 + blockZ * 3) % 9);
    const first = runChunk("terralith:forested_highlands", surfaceYAt);
    const second = runChunk("terralith:forested_highlands", surfaceYAt);
    expect(first.blocks).toEqual(second.blocks);
  });

  test("reports duration", () => {
    console.log(`surface-system.test.ts: ${(performance.now() - startedAt).toFixed(0)} ms`);
  });
});
