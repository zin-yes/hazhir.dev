// Test support: the three synthetic scenario worlds GroundReference.java decorates (keep both definitions
// identical; the reference carries terrain samples that prove the two agree). Integer arithmetic only.
//   land:  rolling grass/dirt/sand terrain at y 57..70 with ponds, oak trees, caves below
//   ocean: sandy/gravelly sea floor at y 34..54 under 62 sea level water, caves below
//   peaks: snow/stone/moss terrain at y 70..82 with dark oak trees, caves below

import { BlockPalette, ChunkBlocks } from "../../../../chunk";
import type { BaseColumnSource } from "../../../level/base-column-source";

export const SCENARIO_NAMES = ["land", "ocean", "peaks"] as const;
const LAND = 0;
const OCEAN = 1;

export const TERRAIN_PALETTE = [
  "air", "cave_air", "water", "bedrock", "stone", "deepslate", "dirt", "grass_block", "sand", "gravel", "clay", "podzol",
  "coarse_dirt", "snow_block", "calcite", "tuff", "moss_block", "mud", "andesite", "granite", "diorite", "dripstone_block",
  "oak_log", "oak_leaves", "dark_oak_log", "dark_oak_leaves",
] as const;
const [AIR, CAVE_AIR, WATER, BEDROCK, STONE, DEEPSLATE, DIRT, GRASS, SAND, GRAVEL, CLAY, PODZOL, COARSE_DIRT, SNOW_BLOCK, CALCITE, TUFF, MOSS, MUD, ANDESITE, GRANITE, DIORITE, DRIPSTONE, OAK_LOG, OAK_LEAVES, DARK_OAK_LOG, DARK_OAK_LEAVES] =
  TERRAIN_PALETTE.map((_, index) => index);

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function div(value: number, divisor: number): number {
  return Math.floor(value / divisor);
}

function hash3(x: number, y: number, z: number): number {
  return mod(Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791), 1000);
}

function heightAt(scenario: number, x: number, z: number): number {
  if (scenario === LAND) {
    const base = 62 + mod(x * 7 + z * 13, 9);
    return mod(div(x, 9) * 2 + div(z, 9) * 5, 7) === 0 ? base - 5 : base;
  }
  if (scenario === OCEAN) return 34 + mod(x * 5 + z * 3, 21);
  return 70 + mod(x * 3 + z * 5, 13);
}

function surfaceBlock(scenario: number, x: number, z: number, height: number): number {
  const patch = mod(div(x, 5) * 3 + div(z, 5) * 7, 8);
  if (scenario === LAND) {
    if (height < 62) return (patch & 1) === 0 ? SAND : CLAY;
    return [GRASS, GRASS, DIRT, SAND, GRAVEL, PODZOL, COARSE_DIRT, GRASS][patch]!;
  }
  if (scenario === OCEAN) return [SAND, SAND, GRAVEL, CLAY, DIRT, GRAVEL, SAND, STONE][patch]!;
  return [SNOW_BLOCK, STONE, CALCITE, TUFF, MOSS, MUD, GRASS, SNOW_BLOCK][patch]!;
}

function deepBlock(x: number, y: number, z: number): number {
  const value = hash3(div(x, 3), div(y, 3), div(z, 3));
  if (y < 0) return value < 80 ? TUFF : DEEPSLATE;
  if (value < 12) return ANDESITE;
  if (value < 24) return TUFF;
  if (value < 32) return CALCITE;
  if (value < 42) return GRANITE;
  if (value < 52) return DRIPSTONE;
  if (value < 62) return DIORITE;
  return STONE;
}

/** CAVE_AIR, WATER or -1 (solid). */
function caveBlock(x: number, y: number, z: number): number {
  const room = y >= 12 && y <= 22 && mod(div(x, 8) * 5 + div(z, 8) * 3, 4) === 0 && mod(x * 5 + z * 3, 9) !== 0;
  if (room) return y <= 14 && mod(div(x, 8) + div(z, 8), 2) === 0 ? WATER : CAVE_AIR;
  const pocket = y >= 8 && y <= 30 && mod(x * 3 + z * 5 + div(y, 2) * 7, 11) < 4;
  return pocket ? CAVE_AIR : -1;
}

/** Index into TERRAIN_PALETTE of the scenario block at a position. */
export function scenarioTerrain(scenario: number, x: number, y: number, z: number): number {
  if (y === -64) return BEDROCK;
  const height = heightAt(scenario, x, z);
  if (y <= height) {
    const cave = caveBlock(x, y, z);
    if (cave >= 0) return cave;
    if (y === height) return surfaceBlock(scenario, x, z, height);
    if (y >= height - 3) {
      if (surfaceBlock(scenario, x, z, height) === SAND) return SAND;
      return scenario === 2 ? STONE : DIRT;
    }
    return deepBlock(x, y, z);
  }
  if (y <= 62) return WATER;
  if (scenario !== OCEAN) {
    const centerX = 7 * div(x, 7) + 3;
    const centerZ = 7 * div(z, 7) + 3;
    const deltaX = x - centerX;
    const deltaZ = z - centerZ;
    if (Math.abs(deltaX) <= 2 && Math.abs(deltaZ) <= 2 && mod(div(x, 7) * 5 + div(z, 7) * 3, 3) !== 2) {
      const centerHeight = heightAt(scenario, centerX, centerZ);
      if (centerHeight >= 63) {
        const log = scenario === LAND ? OAK_LOG : DARK_OAK_LOG;
        const leaves = scenario === LAND ? OAK_LEAVES : DARK_OAK_LEAVES;
        if (deltaX === 0 && deltaZ === 0 && y >= centerHeight + 1 && y <= centerHeight + 5) return log;
        if (y === centerHeight + 4 || y === centerHeight + 5) return leaves;
        if (y === centerHeight + 6 && Math.abs(deltaX) <= 1 && Math.abs(deltaZ) <= 1) return leaves;
      }
    }
  }
  return AIR;
}

export class ScenarioWorldSource implements BaseColumnSource {
  readonly settings = { minY: -64, height: 384, seaLevel: 63 };
  readonly palette = new BlockPalette();
  private readonly columns = new Map<string, ChunkBlocks>();
  private readonly paletteIds: number[];

  constructor(private readonly scenario: number) {
    this.paletteIds = TERRAIN_PALETTE.map((name) => this.palette.idOf(`minecraft:${name}`));
  }

  generateBaseColumn(chunkX: number, chunkZ: number): ChunkBlocks {
    const key = `${chunkX},${chunkZ}`;
    const cached = this.columns.get(key);
    if (cached) return cached;
    const column = new ChunkBlocks(chunkX, chunkZ, this.settings.minY, this.settings.height, this.palette);
    for (let y = column.minY; y <= column.maxY; y++) {
      for (let localZ = 0; localZ < 16; localZ++) {
        for (let localX = 0; localX < 16; localX++) {
          column.setId(localX, y, localZ, this.paletteIds[scenarioTerrain(this.scenario, chunkX * 16 + localX, y, chunkZ * 16 + localZ)]!);
        }
      }
    }
    this.columns.set(key, column);
    return column;
  }

  rawBiomeAtQuart(): string {
    return "minecraft:plains";
  }

  biomeAt(): string {
    return "minecraft:plains";
  }
}
