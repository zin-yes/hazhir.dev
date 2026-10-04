// Test helper (Node side): decodes the real-server fixture chunks, rebuilds the pre-surface stone/water/air column
// from a finished real chunk, and compares our surface blocks against the real ones.

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { BlockPalette, ChunkBlocks } from "../chunk";

export const SEA_LEVEL = 63;
export const WORLD_MIN_Y = -64;
export const WORLD_HEIGHT = 384;

export interface FixtureChunk {
  chunkX: number;
  chunkZ: number;
  biomePalette: string[];
  biomes: Uint8Array;
  blockPalette: string[];
  blocks: Uint16Array;
}

interface FixtureChunkJson {
  chunkX: number;
  chunkZ: number;
  biomePalette: string[];
  biomes: string;
  blockPalette: string[];
  blocks: string;
}

export function chunkKey(chunkX: number, chunkZ: number): string {
  return `${chunkX},${chunkZ}`;
}

export function loadFixtureFile(filePath: string): FixtureChunk[] {
  const parsed = JSON.parse(gunzipSync(readFileSync(filePath)).toString()) as { chunks: FixtureChunkJson[] };
  return parsed.chunks.map((chunk) => {
    const blockBytes = Buffer.from(chunk.blocks, "base64");
    return {
      chunkX: chunk.chunkX,
      chunkZ: chunk.chunkZ,
      biomePalette: chunk.biomePalette,
      biomes: new Uint8Array(Buffer.from(chunk.biomes, "base64")),
      blockPalette: chunk.blockPalette,
      blocks: new Uint16Array(blockBytes.buffer.slice(blockBytes.byteOffset, blockBytes.byteOffset + blockBytes.byteLength)),
    };
  });
}

/** The raw (unzoomed) biome of a quart cell, or undefined outside the loaded chunks. */
export function createRawBiomeLookup(chunksByKey: Map<string, FixtureChunk>) {
  return (quartX: number, quartY: number, quartZ: number): string | undefined => {
    const chunk = chunksByKey.get(chunkKey(quartX >> 2, quartZ >> 2));
    if (!chunk) return undefined;
    const quartYFromBottom = quartY - WORLD_MIN_Y / 4;
    const clampedQuartY = Math.min(Math.max(quartYFromBottom, 0), (WORLD_HEIGHT / 4) - 1);
    const sectionIndex = clampedQuartY >> 2;
    const quartYInSection = clampedQuartY & 3;
    const index = sectionIndex * 64 + ((quartYInSection * 4 + (quartZ & 3)) * 4 + (quartX & 3));
    return chunk.biomePalette[chunk.biomes[index]!];
  };
}

const GROUND_NAME_PREFIXES = [
  "minecraft:stone", "minecraft:deepslate", "minecraft:granite", "minecraft:diorite", "minecraft:andesite",
  "minecraft:tuff", "minecraft:calcite", "minecraft:dripstone", "minecraft:dirt", "minecraft:grass_block",
  "minecraft:coarse_dirt", "minecraft:podzol", "minecraft:mycelium", "minecraft:rooted_dirt", "minecraft:mud",
  "minecraft:sand", "minecraft:red_sand", "minecraft:gravel", "minecraft:clay", "minecraft:terracotta",
  "minecraft:snow_block", "minecraft:packed_ice", "minecraft:blue_ice", "minecraft:bedrock", "minecraft:moss_block",
  "minecraft:smooth_basalt", "minecraft:basalt", "minecraft:blackstone", "minecraft:amethyst_block",
  "minecraft:budding_amethyst", "minecraft:sculk", "minecraft:magma_block", "minecraft:obsidian",
  "terralith:", "minecraft:red_sandstone", "minecraft:sandstone", "minecraft:cobblestone", "minecraft:cobbled",
  "minecraft:pointed_dripstone_never",
];

function isGroundBlockName(name: string): boolean {
  if (name.endsWith("_ore") || name.endsWith("_terracotta")) return true;
  if (name.includes("log") || name.includes("leaves") || name.includes("wood")) return false;
  return GROUND_NAME_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** Blocks the surface rules or features own: for comparison all stone variants and ores count as plain stone. */
export function comparisonCategory(name: string): string {
  if (name.endsWith("_ore") || name === "minecraft:granite" || name === "minecraft:diorite" || name === "minecraft:andesite") {
    return name.includes("deepslate") ? "minecraft:deepslate" : "minecraft:stone";
  }
  if (name === "minecraft:tuff" || name === "minecraft:calcite" || name === "minecraft:dripstone_block") return "minecraft:stone";
  return name;
}

export interface FixtureColumnInfo {
  /** y of the highest ground block, or null for a column without ground. */
  topGroundY: number | null;
}

/**
 * Rebuilds the pre-surface column: ground below the real top ground block becomes stone, sea level water sits above
 * ocean floors, everything else is air. Caves, aquifers and features of the real world are deliberately discarded.
 */
export function buildTerrainFromFixture(fixture: FixtureChunk): { terrain: ChunkBlocks; topGroundY: Array<number | null> } {
  const terrain = new ChunkBlocks(fixture.chunkX, fixture.chunkZ, WORLD_MIN_Y, WORLD_HEIGHT, new BlockPalette());
  const stoneId = terrain.palette.idOf("minecraft:stone");
  const waterId = terrain.palette.idOf("minecraft:water[level=0]");
  const groundByPaletteIndex = fixture.blockPalette.map(isGroundBlockName);
  const topGroundY: Array<number | null> = new Array(256).fill(null);
  for (let localZ = 0; localZ < 16; localZ++) {
    for (let localX = 0; localX < 16; localX++) {
      let topY: number | null = null;
      for (let y = WORLD_MIN_Y + WORLD_HEIGHT - 1; y >= WORLD_MIN_Y; y--) {
        const paletteIndex = fixture.blocks[(y - WORLD_MIN_Y) * 256 + localZ * 16 + localX]!;
        if (groundByPaletteIndex[paletteIndex]) {
          topY = y;
          break;
        }
      }
      topGroundY[localZ * 16 + localX] = topY;
      const solidTop = topY ?? WORLD_MIN_Y - 1;
      for (let y = WORLD_MIN_Y; y <= solidTop; y++) terrain.setId(localX, y, localZ, stoneId);
      for (let y = solidTop + 1; y <= SEA_LEVEL - 1; y++) terrain.setId(localX, y, localZ, waterId);
    }
  }
  return { terrain, topGroundY };
}

export interface ColumnComparison {
  layersCompared: number;
  layersMatching: number;
  mismatches: Array<{ y: number; expected: string; actual: string }>;
}

export function compareColumnLayers(
  fixture: FixtureChunk,
  ours: ChunkBlocks,
  localX: number,
  localZ: number,
  topGroundY: number,
  layerCount: number,
): ColumnComparison {
  const comparison: ColumnComparison = { layersCompared: 0, layersMatching: 0, mismatches: [] };
  for (let depth = 0; depth < layerCount; depth++) {
    const y = topGroundY - depth;
    if (y < WORLD_MIN_Y) break;
    const expected = comparisonCategory(
      fixture.blockPalette[fixture.blocks[(y - WORLD_MIN_Y) * 256 + localZ * 16 + localX]!]!,
    );
    const actualState = ours.getState(localX, y, localZ);
    const actual = comparisonCategory(actualState.includes("[") ? actualState.slice(0, actualState.indexOf("[")) : actualState);
    comparison.layersCompared++;
    if (expected === actual) comparison.layersMatching++;
    else comparison.mismatches.push({ y, expected, actual });
  }
  return comparison;
}
