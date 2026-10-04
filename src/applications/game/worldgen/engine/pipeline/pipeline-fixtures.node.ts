// Node-only test helper: real-server fixture chunks (seed 1337, Terralith) and the merged datapack registries.
// Everything is skipped by the tests when the scratch data is absent (env WORLDGEN_SCRATCH points at it).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { loadTerralithOnVanilla, type DatapackLoadResult } from "../registry/datapack-loader";

export const SCRATCH_ROOT =
  process.env.WORLDGEN_SCRATCH ??
  "/private/tmp/claude-501/-Users-hazhir-code-zin-yes-hazhir-dev/72290beb-a2c3-4424-af2e-7aec7d1ca7d0/scratchpad";
export const FIXTURE_DIRECTORY = `${SCRATCH_ROOT}/fixtures`;
export const WORLDGEN_DATA_AVAILABLE =
  existsSync(`${SCRATCH_ROOT}/Terralith`) && existsSync(`${SCRATCH_ROOT}/mc/vanilla/data`) && existsSync(FIXTURE_DIRECTORY);
export const FIXTURE_SEED = BigInt(1337);
export const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";

export const MIN_Y = -64;
export const SECTION_COUNT = 24;
/** The extractor allocated only 16 x 64 biome cells (a bug), so stored biomes cover sections 0-15 only (y -64..191). */
export const BIOME_FIXTURE_SECTION_COUNT = 16;
export const QUARTS_PER_SECTION = 64;

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

let loadedDatapacks: DatapackLoadResult | undefined;
export function loadDatapacks(): DatapackLoadResult {
  loadedDatapacks ??= loadTerralithOnVanilla(`${SCRATCH_ROOT}/mc/vanilla/data`, `${SCRATCH_ROOT}/Terralith`);
  return loadedDatapacks;
}

export function loadAllFixtureChunks(): FixtureChunk[] {
  const chunks: FixtureChunk[] = [];
  for (const fileName of readdirSync(FIXTURE_DIRECTORY).sort()) {
    if (!fileName.endsWith(".json.gz")) continue;
    const parsed = JSON.parse(gunzipSync(readFileSync(`${FIXTURE_DIRECTORY}/${fileName}`)).toString()) as { chunks: FixtureChunkJson[] };
    for (const chunk of parsed.chunks) {
      const blockBytes = Buffer.from(chunk.blocks, "base64");
      chunks.push({
        chunkX: chunk.chunkX,
        chunkZ: chunk.chunkZ,
        biomePalette: chunk.biomePalette,
        biomes: new Uint8Array(Buffer.from(chunk.biomes, "base64")),
        blockPalette: chunk.blockPalette,
        blocks: new Uint16Array(blockBytes.buffer.slice(blockBytes.byteOffset, blockBytes.byteOffset + blockBytes.byteLength)),
      });
    }
  }
  return chunks;
}

/** Every `stride`-th chunk, so a default run covers all fixture regions but stays fast. */
export function sampleEvenly<Item>(items: Item[], stride: number): Item[] {
  return items.filter((_, index) => index % stride === 0);
}

export interface BiomeComparison {
  cellsCompared: number;
  cellsMatching: number;
  mismatchCountsByPair: Map<string, number>;
}

/** Compares our raw biome at all stored quart cells (16 sections x 64, see BIOME_FIXTURE_SECTION_COUNT) with the stored biomes. Index: section*64 + (quartY*4 + quartZ)*4 + quartX. */
export function compareChunkBiomes(
  chunk: FixtureChunk,
  rawBiomeAtQuart: (quartX: number, quartY: number, quartZ: number) => string,
  into: BiomeComparison,
): void {
  const minQuartY = MIN_Y >> 2;
  for (let sectionIndex = 0; sectionIndex < BIOME_FIXTURE_SECTION_COUNT; sectionIndex++) {
    for (let quartYInSection = 0; quartYInSection < 4; quartYInSection++) {
      for (let quartZ = 0; quartZ < 4; quartZ++) {
        for (let quartX = 0; quartX < 4; quartX++) {
          const index = sectionIndex * QUARTS_PER_SECTION + (quartYInSection * 4 + quartZ) * 4 + quartX;
          const expected = chunk.biomePalette[chunk.biomes[index]!]!;
          const actual = rawBiomeAtQuart(
            chunk.chunkX * 4 + quartX,
            minQuartY + sectionIndex * 4 + quartYInSection,
            chunk.chunkZ * 4 + quartZ,
          );
          into.cellsCompared++;
          if (actual === expected) into.cellsMatching++;
          else {
            const pair = `${expected} (real) vs ${actual} (ours)`;
            into.mismatchCountsByPair.set(pair, (into.mismatchCountsByPair.get(pair) ?? 0) + 1);
          }
        }
      }
    }
  }
}

const AMBIGUOUS_STONE_PATCH_PREFIXES = [
  "minecraft:granite", "minecraft:diorite", "minecraft:andesite", "minecraft:tuff", "minecraft:calcite",
  "minecraft:dripstone_block", "minecraft:raw_", "minecraft:infested_", "minecraft:cobblestone", "minecraft:mossy_cobblestone",
  "minecraft:smooth_basalt", "minecraft:amethyst", "minecraft:budding_amethyst", "minecraft:sculk", "minecraft:magma_block",
  "minecraft:obsidian", "minecraft:basalt",
];

const TERRAIN_NAME_PREFIXES = [
  "minecraft:stone", "minecraft:deepslate", "minecraft:dirt", "minecraft:grass_block", "minecraft:coarse_dirt", "minecraft:podzol",
  "minecraft:mycelium", "minecraft:rooted_dirt", "minecraft:mud", "minecraft:sand", "minecraft:red_sand", "minecraft:gravel",
  "minecraft:clay", "minecraft:terracotta", "minecraft:snow_block", "minecraft:packed_ice", "minecraft:blue_ice", "minecraft:ice",
  "minecraft:bedrock", "minecraft:moss_block", "minecraft:red_sandstone", "minecraft:sandstone", "terralith:",
];

export type RealTerrainClass =
  | { kind: "ignore" }
  | { kind: "terrain"; expectedName: string | null; isDefaultStoneFamily: boolean };

/**
 * Classifies a real block. Only plain terrain is compared: air, water, lava, plants, logs, structures and other
 * feature output are ignored; ores count as the stone or deepslate they replaced; granite/tuff/etc. patches count
 * as "some stone-family solid" (expectedName null); `isDefaultStoneFamily` marks stone-like ground for the
 * "is it solid" metric.
 */
export function classifyRealBlock(blockName: string): RealTerrainClass {
  if (blockName.endsWith("_ore")) {
    return { kind: "terrain", expectedName: blockName.startsWith("minecraft:deepslate_") ? "minecraft:deepslate" : "minecraft:stone", isDefaultStoneFamily: true };
  }
  if (AMBIGUOUS_STONE_PATCH_PREFIXES.some((prefix) => blockName.startsWith(prefix))) {
    return { kind: "terrain", expectedName: null, isDefaultStoneFamily: true };
  }
  if (blockName.includes("stairs") || blockName.includes("slab") || blockName.includes("wall") || blockName.includes("brick")) return { kind: "ignore" };
  if (TERRAIN_NAME_PREFIXES.some((prefix) => blockName.startsWith(prefix))) {
    const isStoneFamily = blockName === "minecraft:stone" || blockName === "minecraft:deepslate";
    return { kind: "terrain", expectedName: blockName, isDefaultStoneFamily: isStoneFamily };
  }
  return { kind: "ignore" };
}

export interface TerrainComparison {
  /** Real plain-terrain blocks examined, after dropping underground ore-blob / structure-foundation features. */
  blocksCompared: number;
  /** Of those, blocks where ours is the same terrain block (or any solid for stone-patch blocks). */
  blocksMatching: number;
  /** Real stone-family ground where ours is air or fluid (a terrain-shape error, not a surface-rule error). */
  solidnessMismatches: number;
  /** Compared blocks within SURFACE_BAND_DEPTH of the real column top (where surface rules decide the block). */
  surfaceBandCompared: number;
  surfaceBandMatching: number;
  mismatchCountsByPair: Map<string, number>;
}

export function createTerrainComparison(): TerrainComparison {
  return {
    blocksCompared: 0,
    blocksMatching: 0,
    solidnessMismatches: 0,
    surfaceBandCompared: 0,
    surfaceBandMatching: 0,
    mismatchCountsByPair: new Map(),
  };
}

const NON_SOLID_NAMES = new Set(["minecraft:air", "minecraft:water", "minecraft:lava"]);
const SURFACE_BAND_DEPTH = 8;
/** Deeper than the surface band, these replacing stone are ore blobs (dirt, gravel, clay), lush-cave clay or foundations. */
const UNDERGROUND_FEATURE_NAMES = new Set([
  "minecraft:dirt", "minecraft:gravel", "minecraft:clay", "minecraft:sandstone", "minecraft:red_sandstone",
  "minecraft:moss_block", "minecraft:rooted_dirt", "minecraft:mud", "minecraft:sand", "minecraft:red_sand",
]);
const STONE_FAMILY_NAMES = new Set(["minecraft:stone", "minecraft:deepslate"]);

/** Ore vein output (ores, raw blocks, granite, tuff) is solid ground that stands in for the stone or deepslate it replaced. */
function isOreVeinBlock(blockName: string): boolean {
  return blockName.endsWith("_ore") || blockName.startsWith("minecraft:raw_") || blockName === "minecraft:granite" || blockName === "minecraft:tuff";
}

/**
 * Compares our generated column with the real chunk on plain-terrain blocks only (see classifyRealBlock).
 * Underground blobs of dirt/gravel/clay/sandstone/moss (features, not terrain) are dropped where ours is stone or
 * deepslate and the block lies at least SURFACE_BAND_DEPTH below the real column top.
 */
export function compareChunkTerrain(
  chunk: FixtureChunk,
  ours: { getState(localX: number, y: number, localZ: number): string },
  into: TerrainComparison,
): void {
  const classByPaletteIndex = chunk.blockPalette.map((name) => classifyRealBlock(name));
  const topY = MIN_Y + SECTION_COUNT * 16 - 1;
  for (let localZ = 0; localZ < 16; localZ++) {
    for (let localX = 0; localX < 16; localX++) {
      let realColumnTop = MIN_Y - 1;
      for (let blockY = topY; blockY >= MIN_Y; blockY--) {
        if (classByPaletteIndex[chunk.blocks[(blockY - MIN_Y) * 256 + localZ * 16 + localX]!]!.kind === "terrain") {
          realColumnTop = blockY;
          break;
        }
      }
      for (let blockY = realColumnTop; blockY >= MIN_Y; blockY--) {
        const paletteIndex = chunk.blocks[(blockY - MIN_Y) * 256 + localZ * 16 + localX]!;
        const realClass = classByPaletteIndex[paletteIndex]!;
        if (realClass.kind === "ignore") continue;
        const oursName = ours.getState(localX, blockY, localZ).split("[")[0]!;
        const insideSurfaceBand = realColumnTop - blockY < SURFACE_BAND_DEPTH;
        if (
          !insideSurfaceBand &&
          realClass.expectedName !== null &&
          UNDERGROUND_FEATURE_NAMES.has(realClass.expectedName) &&
          STONE_FAMILY_NAMES.has(oursName)
        ) {
          continue;
        }
        into.blocksCompared++;
        if (insideSurfaceBand) into.surfaceBandCompared++;
        const oursIsVeinSolid = STONE_FAMILY_NAMES.has(realClass.expectedName ?? "") && isOreVeinBlock(oursName);
        const matches = realClass.expectedName === null ? !NON_SOLID_NAMES.has(oursName) : oursName === realClass.expectedName || oursIsVeinSolid;
        if (matches) {
          into.blocksMatching++;
          if (insideSurfaceBand) into.surfaceBandMatching++;
          continue;
        }
        if (realClass.isDefaultStoneFamily && NON_SOLID_NAMES.has(oursName)) into.solidnessMismatches++;
        const pair = `${chunk.blockPalette[paletteIndex]} (real) vs ${oursName} (ours)`;
        into.mismatchCountsByPair.set(pair, (into.mismatchCountsByPair.get(pair) ?? 0) + 1);
      }
    }
  }
}

export function formatTopPairs(counts: Map<string, number>, limit: number): string {
  return [...counts.entries()]
    .sort((first, second) => second[1] - first[1])
    .slice(0, limit)
    .map(([pair, count]) => `  ${String(count).padStart(8)}  ${pair}`)
    .join("\n");
}

const OPEN_BLOCK_NAMES = new Set(["minecraft:air", "minecraft:cave_air", "minecraft:water", "minecraft:lava"]);
/** Blocks that only structures (mineshafts, strongholds, villages, ruins, dungeons) place; chunks holding them are skipped. */
const STRUCTURE_BLOCK_MARKERS = ["planks", "fence", "rail", "cobweb", "spawner", "chest", "bricks", "torch", "lantern", "barrel", "bookshelf", "terracotta_"];

export function isOpenBlockName(blockName: string): boolean {
  return OPEN_BLOCK_NAMES.has(blockName);
}

export function chunkHoldsStructureBlocks(chunk: FixtureChunk): boolean {
  return chunk.blockPalette.some((name) => STRUCTURE_BLOCK_MARKERS.some((marker) => name.includes(marker)));
}
