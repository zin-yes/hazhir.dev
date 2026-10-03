// Per-column plants: grass, flowers, ferns, mushrooms, reeds and lily pads on
// land, and coral on warm shallow seabeds. Flowers grow in clumps, shade
// lovers thrive where trees are dense, and sun lovers prefer clearings.

import { BlockType } from "@/applications/game/blocks";
import { CHUNK_HEIGHT, CHUNK_LENGTH } from "@/applications/game/config";
import { BiomeId } from "../biomes";
import type { ColumnInfo } from "../column-grid";
import { hashToUnit, smoothstep, smoothValueNoise } from "../math";
import { IS_PLANTABLE_GROUND, IS_SANDY } from "./block-classes";
import { groveFactorAt } from "./tree-placement";

const MAX_PLANT_SLOPE = 1.6;
const SANDY_GROUND_PLANTS = new Set<BlockType>([
  BlockType.DEAD_BUSH,
  BlockType.AGAVE,
  BlockType.REEDS,
  BlockType.SAVANNA_GRASS,
]);
const CORAL_BLOCKS = [BlockType.CORAL_PINK, BlockType.CORAL_ORANGE, BlockType.CORAL_BLUE];

export interface ColumnPlantRequest {
  column: ColumnInfo;
  /** Block id found at the column's top solid block. */
  groundBlock: BlockType;
  seed: number;
}

/** World y and block to place for this column, or null for nothing. */
export function chooseGroundCover(request: ColumnPlantRequest): { y: number; block: BlockType; height: number } | null {
  const { column, groundBlock, seed } = request;
  const { worldX, worldZ, biome } = column;

  if (column.isSubmerged) return chooseWaterCover(column, seed);
  if (column.slope > MAX_PLANT_SLOPE || biome.groundCover.length === 0) return null;

  const isSandy = IS_SANDY[groundBlock] === 1;
  if (!isSandy && !IS_PLANTABLE_GROUND[groundBlock]) return null;

  const shadeLevel = Math.min(1, biome.treeDensity * groveFactorAt(worldX, worldZ, seed));
  for (let entryIndex = 0; entryIndex < biome.groundCover.length; entryIndex++) {
    const entry = biome.groundCover[entryIndex];
    if (isSandy && !SANDY_GROUND_PLANTS.has(entry.block)) continue;
    let chance = entry.chance;
    if (entry.patch) {
      const patchValue = smoothValueNoise(worldX / entry.patch.scale, worldZ / entry.patch.scale, seed + 900 + entryIndex);
      if (patchValue < entry.patch.threshold) continue;
      chance *= 0.5 + smoothstep(entry.patch.threshold, 1, patchValue);
    }
    if (entry.shadeAffinity) chance *= Math.max(0.1, 1 + entry.shadeAffinity * (shadeLevel - 0.35) * 2.2);
    if (hashToUnit(worldX, worldZ, seed + 700 + entryIndex) < chance) {
      return { y: column.groundTopY + 1, block: entry.block, height: 1 };
    }
  }
  return null;
}

function chooseWaterCover(column: ColumnInfo, seed: number): { y: number; block: BlockType; height: number } | null {
  const { worldX, worldZ, biome } = column;
  const depth = column.waterLevel - column.groundTopY - 1;

  const lilyPad = biome.groundCover.find((entry) => entry.block === BlockType.LILY_PAD);
  if (lilyPad && depth <= 4 && depth >= 1) {
    const patchValue = lilyPad.patch
      ? smoothValueNoise(worldX / lilyPad.patch.scale, worldZ / lilyPad.patch.scale, seed + 950)
      : 1;
    if (patchValue >= (lilyPad.patch?.threshold ?? 0) && hashToUnit(worldX, worldZ, seed + 951) < lilyPad.chance) {
      return { y: column.waterLevel, block: BlockType.LILY_PAD, height: 1 };
    }
  }
  const isFreshwaterPond = biome.id === BiomeId.River || biome.id === BiomeId.Swamp;
  if (isFreshwaterPond && depth >= 1 && depth <= 3 && column.temperature > -0.1) {
    const reedPatch = smoothValueNoise(worldX / 7, worldZ / 7, seed + 952);
    const isBankColumn = column.sample.height > column.waterLevel - 3;
    if (isBankColumn && reedPatch > 0.62 && hashToUnit(worldX, worldZ, seed + 953) < 0.35) {
      return { y: column.groundTopY + 1, block: BlockType.REEDS, height: 1 };
    }
  }

  const supportsCoral =
    biome.id === BiomeId.WarmOcean && column.temperature > 0.4 && depth >= 2 && depth <= 16;
  if (supportsCoral) {
    const reefValue = smoothValueNoise(worldX / 16, worldZ / 16, seed + 960);
    if (reefValue > 0.64 && hashToUnit(worldX, worldZ, seed + 961) < 0.55) {
      const colorIndex = Math.floor(smoothValueNoise(worldX / 40, worldZ / 40, seed + 962) * CORAL_BLOCKS.length);
      const moundHeight = 1 + Math.floor(hashToUnit(worldX, worldZ, seed + 963) * 3 * smoothstep(0.64, 0.85, reefValue));
      return {
        y: column.groundTopY + 1,
        block: CORAL_BLOCKS[Math.min(colorIndex, CORAL_BLOCKS.length - 1)],
        height: moundHeight,
      };
    }
  }
  return null;
}

export function writeColumnPlant(
  blocks: Uint8Array,
  localX: number,
  localZ: number,
  chunkWorldY: number,
  cover: { y: number; block: BlockType; height: number },
): boolean {
  let wrote = false;
  for (let layer = 0; layer < cover.height; layer++) {
    const localY = cover.y + layer - chunkWorldY;
    if (localY < 0 || localY >= CHUNK_HEIGHT) continue;
    const index = localX * CHUNK_HEIGHT * CHUNK_LENGTH + localY * CHUNK_LENGTH + localZ;
    const existing = blocks[index];
    const isOpenSpace = existing === BlockType.AIR || (layer > 0 && existing === BlockType.WATER);
    const isWaterSurfacePlant = cover.block === BlockType.LILY_PAD && existing === BlockType.AIR;
    const isCoralInWater = cover.block !== BlockType.LILY_PAD && existing === BlockType.WATER;
    if (isOpenSpace || isWaterSurfacePlant || isCoralInWater) {
      blocks[index] = cover.block;
      wrote = true;
    }
  }
  return wrote;
}
