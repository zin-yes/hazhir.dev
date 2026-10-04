// Mirrors DesertWellFeature (minecraft:desert_well): the code-built (not NBT) sandstone well with a water core,
// sand below it and two suspicious sand blocks hidden beneath the water. The loot table of the brushable block
// entity is not modelled (worldgen blocks only).

import { Direction } from "../../core/direction";
import { defineFeatureType } from "../../feature/feature-type";
import type { WorldGenLevel } from "../../level/world-gen-level";
import { endFeatureStep, startFeatureStep } from "../../profiling/feature-profiling";
import { isBlock } from "./block-names";

const SAND = "minecraft:sand";
const SANDSTONE = "minecraft:sandstone";
const SANDSTONE_SLAB = "minecraft:sandstone_slab";
const WATER = "minecraft:water";
const SUSPICIOUS_SAND = "minecraft:suspicious_sand";

function hasSolidFooting(level: WorldGenLevel, x: number, y: number, z: number): boolean {
  for (let offsetX = -2; offsetX <= 2; offsetX++) {
    for (let offsetZ = -2; offsetZ <= 2; offsetZ++) {
      if (level.isEmptyBlock(x + offsetX, y - 1, z + offsetZ) && level.isEmptyBlock(x + offsetX, y - 2, z + offsetZ)) return false;
    }
  }
  return true;
}

export const desertWellFeature = defineFeatureType<undefined>({
  id: "minecraft:desert_well",
  parseConfig: () => undefined,
  place({ level, random, origin }) {
    const x = origin.x;
    const z = origin.z;
    let y = origin.y + 1;
    const groundCheckMark = startFeatureStep("feature.desert_well.ground_check", level);
    while (level.isEmptyBlock(x, y, z) && y > level.minY + 2) y--;
    const canBuild = isBlock(level.getBlockState(x, y, z), SAND) && hasSolidFooting(level, x, y, z);
    endFeatureStep("feature.desert_well.ground_check", level, groundCheckMark);
    if (!canBuild) return false;
    const buildMark = startFeatureStep("feature.desert_well.build", level);
    for (let offsetY = -2; offsetY <= 0; offsetY++) {
      for (let offsetX = -2; offsetX <= 2; offsetX++) {
        for (let offsetZ = -2; offsetZ <= 2; offsetZ++) level.setBlock(x + offsetX, y + offsetY, z + offsetZ, SANDSTONE, 2);
      }
    }
    level.setBlock(x, y, z, WATER, 2);
    for (const direction of Direction.HORIZONTAL) level.setBlock(x + direction.stepX, y, z + direction.stepZ, WATER, 2);
    level.setBlock(x, y - 1, z, SAND, 2);
    for (const direction of Direction.HORIZONTAL) level.setBlock(x + direction.stepX, y - 1, z + direction.stepZ, SAND, 2);
    for (let offsetX = -2; offsetX <= 2; offsetX++) {
      for (let offsetZ = -2; offsetZ <= 2; offsetZ++) {
        if (offsetX !== -2 && offsetX !== 2 && offsetZ !== -2 && offsetZ !== 2) continue;
        level.setBlock(x + offsetX, y + 1, z + offsetZ, SANDSTONE, 2);
      }
    }
    level.setBlock(x + 2, y + 1, z, SANDSTONE_SLAB, 2);
    level.setBlock(x - 2, y + 1, z, SANDSTONE_SLAB, 2);
    level.setBlock(x, y + 1, z + 2, SANDSTONE_SLAB, 2);
    level.setBlock(x, y + 1, z - 2, SANDSTONE_SLAB, 2);
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
        level.setBlock(x + offsetX, y + 4, z + offsetZ, offsetX === 0 && offsetZ === 0 ? SANDSTONE : SANDSTONE_SLAB, 2);
      }
    }
    for (let offsetY = 1; offsetY <= 3; offsetY++) {
      level.setBlock(x - 1, y + offsetY, z - 1, SANDSTONE, 2);
      level.setBlock(x - 1, y + offsetY, z + 1, SANDSTONE, 2);
      level.setBlock(x + 1, y + offsetY, z - 1, SANDSTONE, 2);
      level.setBlock(x + 1, y + offsetY, z + 1, SANDSTONE, 2);
    }
    // List.of(center, east, south, west, north), then Util.getRandom picks one per suspicious sand block.
    const waterColumns: ReadonlyArray<readonly [number, number]> = [
      [x, z],
      [x + 1, z],
      [x, z + 1],
      [x - 1, z],
      [x, z - 1],
    ];
    const firstColumn = waterColumns[random.nextIntBounded(waterColumns.length)]!;
    level.setBlock(firstColumn[0], y - 1, firstColumn[1], SUSPICIOUS_SAND, 3);
    const secondColumn = waterColumns[random.nextIntBounded(waterColumns.length)]!;
    level.setBlock(secondColumn[0], y - 2, secondColumn[1], SUSPICIOUS_SAND, 3);
    endFeatureStep("feature.desert_well.build", level, buildMark);
    return true;
  },
});
