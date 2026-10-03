// Decides which block sits at a given height of a column: soil layers per
// biome, exposed rock on cliffs, banks and beds around water, layered strata
// in badlands and canyons, and the deep rock underneath.

import { BlockType } from "@/applications/game/blocks";
import { hashToUnit, smoothValueNoise } from "./math";
import { SEA_LEVEL } from "./constants";
import { BiomeId } from "./biomes";
import type { ColumnInfo } from "./column-grid";

const CLIFF_FACE_MIN_DROP = 2;
const STEEP_TOP_SLOPE = 1.6;
const BANK_MAX_HEIGHT_ABOVE_WATER = 1.7;
const SHALLOW_WATER_DEPTH = 9;

const DEEP_ROCK_LAYERS: { block: BlockType; thickness: number }[] = [
  { block: BlockType.STONE, thickness: 62 },
  { block: BlockType.GRANITE, thickness: 22 },
  { block: BlockType.PHYLLITE, thickness: 100 },
];

const BADLANDS_BANDS = [
  BlockType.TERRACOTTA, BlockType.TERRACOTTA_RED, BlockType.TERRACOTTA_ORANGE,
  BlockType.TERRACOTTA_WHITE, BlockType.TERRACOTTA_YELLOW, BlockType.TERRACOTTA_BROWN,
  BlockType.TERRACOTTA_RED, BlockType.TERRACOTTA_ORANGE, BlockType.TERRACOTTA_PURPLE,
  BlockType.TERRACOTTA_WHITE, BlockType.TERRACOTTA, BlockType.TERRACOTTA_YELLOW,
];

const CANYON_BANDS = [
  BlockType.RED_SANDSTONE, BlockType.RED_SANDSTONE, BlockType.TERRACOTTA_ORANGE,
  BlockType.SANDSTONE, BlockType.TERRACOTTA_RED, BlockType.RED_SANDSTONE,
  BlockType.TERRACOTTA_YELLOW, BlockType.SANDSTONE, BlockType.SANDSTONE,
  BlockType.TERRACOTTA_BROWN, BlockType.RED_SANDSTONE, BlockType.TERRACOTTA_WHITE,
];

function bandedBlock(bands: BlockType[], y: number, bandThickness: number): BlockType {
  const bandIndex = Math.floor(y / bandThickness);
  const wrapped = ((bandIndex % bands.length) + bands.length) % bands.length;
  return bands[wrapped];
}

function deepRockBlock(depthBelowSoil: number): BlockType {
  let remaining = depthBelowSoil;
  for (const layer of DEEP_ROCK_LAYERS) {
    if (remaining < layer.thickness) return layer.block;
    remaining -= layer.thickness;
  }
  return BlockType.SHALE;
}

function waterFloorBlock(column: ColumnInfo, worldX: number, worldZ: number, seed: number): BlockType {
  const depthBelowWater = column.waterLevel - column.groundTopY;
  const { biome } = column;
  const patch = smoothValueNoise(worldX / 13, worldZ / 13, seed + 301);
  const isFreshwater = biome.id === BiomeId.River || biome.id === BiomeId.FrozenRiver;
  if (isFreshwater && patch > 0.7) return BlockType.CLAY;
  if (depthBelowWater < SHALLOW_WATER_DEPTH) {
    return patch > 0.78 && !isFreshwater ? BlockType.GRAVEL : biome.shallowWaterFloor;
  }
  return patch > 0.74 ? BlockType.CLAY : biome.deepWaterFloor;
}

function bankBlock(column: ColumnInfo, worldX: number, worldZ: number, seed: number): BlockType {
  const patch = smoothValueNoise(worldX / 9, worldZ / 9, seed + 302);
  if (column.biome.id === BiomeId.Swamp || column.biome.id === BiomeId.MangroveSwamp) return BlockType.MUD;
  if (patch > 0.8) return BlockType.CLAY;
  if (column.temperature < -0.1 || column.sample.mountainMask > 0.3) return BlockType.GRAVEL;
  return BlockType.SAND;
}

function isWaterBank(column: ColumnInfo): boolean {
  const { sample } = column;
  const bordersFreshWater = sample.riverValleyWeight > 0.05 || sample.lakeWeight > 0;
  return (
    bordersFreshWater &&
    sample.waterLevel > SEA_LEVEL - 1 &&
    sample.height - sample.waterLevel <= BANK_MAX_HEIGHT_ABOVE_WATER
  );
}

/** Block of the solid ground at `y`, which must be at or below the column's top. */
export function solidBlockAt(column: ColumnInfo, y: number, worldX: number, worldZ: number, seed: number): BlockType {
  const depth = column.groundTopY - y;
  const { biome } = column;

  if (column.isSubmerged && depth < 3) return waterFloorBlock(column, worldX, worldZ, seed);

  const isExposedCliffFace =
    column.groundTopY - Math.floor(column.lowestNeighborHeight) >= CLIFF_FACE_MIN_DROP &&
    y > Math.floor(column.lowestNeighborHeight);
  if (isExposedCliffFace && (depth > 0 || column.slope > STEEP_TOP_SLOPE)) {
    if (biome.strataStyle === "badlands") return bandedBlock(BADLANDS_BANDS, y, 3);
    if (biome.strataStyle === "canyon") return bandedBlock(CANYON_BANDS, y, 3);
    return biome.rockBlock;
  }

  if (biome.strataStyle && depth > 0) {
    const bands = biome.strataStyle === "badlands" ? BADLANDS_BANDS : CANYON_BANDS;
    if (depth < 70) return bandedBlock(bands, y, 3);
  }

  if (depth < 3 && isWaterBank(column)) return bankBlock(column, worldX, worldZ, seed);

  if (depth < biome.topDepth) return surfaceTopBlock(column, worldX, worldZ, seed);
  if (depth < biome.topDepth + biome.fillerDepth) return biome.fillerBlock;
  return deepRockBlock(depth - biome.topDepth - biome.fillerDepth);
}

export function surfaceTopBlock(column: ColumnInfo, worldX: number, worldZ: number, seed: number): BlockType {
  const { biome } = column;
  switch (biome.id) {
    case BiomeId.Swamp:
      if (column.sample.height - SEA_LEVEL < 2.2) return BlockType.MUD;
      break;
    case BiomeId.VolcanicCrater:
      return hashToUnit(worldX >> 1, worldZ >> 1, seed + 303) > 0.45 ? BlockType.MAGMA : BlockType.OBSIDIAN;
    case BiomeId.VolcanicSlopes: {
      const patch = smoothValueNoise(worldX / 6, worldZ / 6, seed + 308);
      if (patch > 0.68) return BlockType.BASALT;
      if (patch < 0.15) return BlockType.GRAVEL;
      break;
    }
    case BiomeId.Badlands:
      if (column.slope < 0.5) return BlockType.RED_SAND;
      return bandedBlock(BADLANDS_BANDS, column.groundTopY, 3);
    case BiomeId.RockyPeaks: {
      const patch = smoothValueNoise(worldX / 7, worldZ / 7, seed + 304);
      if (patch > 0.7) return BlockType.GRAVEL;
      if (patch < 0.22) return BlockType.SLATE;
      break;
    }
    case BiomeId.Tundra: {
      const patch = smoothValueNoise(worldX / 8, worldZ / 8, seed + 305);
      if (patch > 0.68) return BlockType.MOSS;
      break;
    }
    case BiomeId.OldGrowthForest: {
      const patch = smoothValueNoise(worldX / 6, worldZ / 6, seed + 306);
      if (patch > 0.72) return BlockType.PODZOL;
      if (patch < 0.18) return BlockType.MOSS;
      break;
    }
    case BiomeId.Forest:
    case BiomeId.Taiga: {
      const patch = smoothValueNoise(worldX / 7, worldZ / 7, seed + 307);
      if (patch > 0.8) return BlockType.PODZOL;
      break;
    }
    default:
      break;
  }
  return biome.topBlock;
}
