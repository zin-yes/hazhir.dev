// Mirrors LakeFeature (minecraft:lake) with its Configuration (fluid and barrier state providers). Vanilla and
// Terralith only use lava lakes. A water fluid would also freeze the surface where the biome allows it
// (Biome.shouldFreeze needs temperature data this engine does not model), so that last step is skipped.
// Fluid scheduled ticks and post-processing marks have no effect on generated blocks and are omitted.

import { defineFeatureType } from "../../feature/feature-type";
import { asObject } from "../../providers/json-fields";
import type { BlockStateProvider } from "../../providers/block-state-providers";

export interface LakeConfig {
  readonly fluid: BlockStateProvider;
  readonly barrier: BlockStateProvider;
}

const CAVE_AIR = "minecraft:cave_air";
const FEATURES_CANNOT_REPLACE_TAG = "minecraft:features_cannot_replace";
const LAVA_POOL_STONE_CANNOT_REPLACE_TAG = "minecraft:lava_pool_stone_cannot_replace";

const LAKE_SIZE_X = 16;
const LAKE_SIZE_Z = 16;
const LAKE_SIZE_Y = 8;

function shapeIndex(x: number, z: number, y: number): number {
  return (x * LAKE_SIZE_Z + z) * LAKE_SIZE_Y + y;
}

/** True where the cell is outside the lake but touches a lake cell on one of six sides. */
function isLakeEdge(shape: Uint8Array, x: number, z: number, y: number): boolean {
  if (shape[shapeIndex(x, z, y)]) return false;
  return (
    (x < LAKE_SIZE_X - 1 && shape[shapeIndex(x + 1, z, y)] === 1) ||
    (x > 0 && shape[shapeIndex(x - 1, z, y)] === 1) ||
    (z < LAKE_SIZE_Z - 1 && shape[shapeIndex(x, z + 1, y)] === 1) ||
    (z > 0 && shape[shapeIndex(x, z - 1, y)] === 1) ||
    (y < LAKE_SIZE_Y - 1 && shape[shapeIndex(x, z, y + 1)] === 1) ||
    (y > 0 && shape[shapeIndex(x, z, y - 1)] === 1)
  );
}

export const lakeFeature = defineFeatureType<LakeConfig>({
  id: "minecraft:lake",
  parseConfig(json, parser) {
    const config = asObject(json, "lake config");
    return {
      fluid: parser.blockStateProvider(config.fluid, "lake.fluid"),
      barrier: parser.blockStateProvider(config.barrier, "lake.barrier"),
    };
  },
  place({ level, random, origin, config }) {
    if (origin.y <= level.minY + 4) return false;
    const baseX = origin.x;
    const baseY = origin.y - 4;
    const baseZ = origin.z;
    const shape = new Uint8Array(LAKE_SIZE_X * LAKE_SIZE_Z * LAKE_SIZE_Y);
    const blobCount = random.nextIntBounded(4) + 4;
    for (let blob = 0; blob < blobCount; blob++) {
      const sizeX = random.nextDouble() * 6 + 3;
      const sizeY = random.nextDouble() * 4 + 2;
      const sizeZ = random.nextDouble() * 6 + 3;
      const centerX = random.nextDouble() * (16 - sizeX - 2) + 1 + sizeX / 2;
      const centerY = random.nextDouble() * (8 - sizeY - 4) + 2 + sizeY / 2;
      const centerZ = random.nextDouble() * (16 - sizeZ - 2) + 1 + sizeZ / 2;
      for (let x = 1; x < 15; x++) {
        for (let z = 1; z < 15; z++) {
          for (let y = 1; y < 7; y++) {
            const normalizedX = (x - centerX) / (sizeX / 2);
            const normalizedY = (y - centerY) / (sizeY / 2);
            const normalizedZ = (z - centerZ) / (sizeZ / 2);
            const distanceSquared = normalizedX * normalizedX + normalizedY * normalizedY + normalizedZ * normalizedZ;
            if (distanceSquared < 1) shape[shapeIndex(x, z, y)] = 1;
          }
        }
      }
    }
    const fluidState = config.fluid.getState(random, baseX, baseY, baseZ);
    for (let x = 0; x < LAKE_SIZE_X; x++) {
      for (let z = 0; z < LAKE_SIZE_Z; z++) {
        for (let y = 0; y < LAKE_SIZE_Y; y++) {
          if (!isLakeEdge(shape, x, z, y)) continue;
          const existing = level.getBlockInfo(baseX + x, baseY + y, baseZ + z);
          if (y >= 4 && existing.isLiquid) return false;
          if (y >= 4 || existing.isSolid || level.blockStates.normalize(existing.state) === fluidState) continue;
          return false;
        }
      }
    }
    for (let x = 0; x < LAKE_SIZE_X; x++) {
      for (let z = 0; z < LAKE_SIZE_Z; z++) {
        for (let y = 0; y < LAKE_SIZE_Y; y++) {
          if (!shape[shapeIndex(x, z, y)]) continue;
          const name = level.getBlockInfo(baseX + x, baseY + y, baseZ + z).name;
          if (level.blockTags.is(name, FEATURES_CANNOT_REPLACE_TAG)) continue;
          level.setBlock(baseX + x, baseY + y, baseZ + z, y >= 4 ? CAVE_AIR : fluidState, 2);
        }
      }
    }
    const barrierState = config.barrier.getState(random, baseX, baseY, baseZ);
    if (!level.blockStates.info(barrierState).isAir) {
      for (let x = 0; x < LAKE_SIZE_X; x++) {
        for (let z = 0; z < LAKE_SIZE_Z; z++) {
          for (let y = 0; y < LAKE_SIZE_Y; y++) {
            if (!isLakeEdge(shape, x, z, y)) continue;
            if (y >= 4 && random.nextIntBounded(2) === 0) continue;
            const existing = level.getBlockInfo(baseX + x, baseY + y, baseZ + z);
            if (!existing.isSolid || level.blockTags.is(existing.name, LAVA_POOL_STONE_CANNOT_REPLACE_TAG)) continue;
            level.setBlock(baseX + x, baseY + y, baseZ + z, barrierState, 2);
          }
        }
      }
    }
    return true;
  },
});
