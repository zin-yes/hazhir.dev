// Mirrors BlueIceFeature (minecraft:blue_ice): a blue ice seed next to packed ice under the surface of an ocean,
// grown by up to 200 random neighbor-attached placements.

import { Direction } from "../../core/direction";
import { defineFeatureType } from "../../feature/feature-type";
import { endFeatureStep, startFeatureStep } from "../../profiling/feature-profiling";
import { divideInt } from "./java-float-math";
import { BLUE_ICE_BLOCK, ICE_BLOCK, isBlock, PACKED_ICE_BLOCK, WATER_BLOCK } from "./block-names";

export const blueIceFeature = defineFeatureType<undefined>({
  id: "minecraft:blue_ice",
  parseConfig: () => undefined,
  place({ level, random, origin }) {
    const { x, y, z } = origin;
    if (y > level.seaLevel - 1) return false;
    if (!isBlock(level.getBlockState(x, y, z), WATER_BLOCK) && !isBlock(level.getBlockState(x, y - 1, z), WATER_BLOCK)) return false;
    let touchesPackedIce = false;
    for (const direction of Direction.VALUES) {
      if (direction === Direction.DOWN) continue;
      if (isBlock(level.getBlockState(x + direction.stepX, y + direction.stepY, z + direction.stepZ), PACKED_ICE_BLOCK)) {
        touchesPackedIce = true;
        break;
      }
    }
    if (!touchesPackedIce) return false;
    level.setBlock(x, y, z, BLUE_ICE_BLOCK, 2);
    const spreadMark = startFeatureStep("feature.blue_ice.spread", level);
    for (let attempt = 0; attempt < 200; attempt++) {
      const offsetY = random.nextIntBounded(5) - random.nextIntBounded(6);
      let spread = 3;
      if (offsetY < 2) spread += divideInt(offsetY, 2);
      if (spread < 1) continue;
      const offsetX = random.nextIntBounded(spread) - random.nextIntBounded(spread);
      const offsetZ = random.nextIntBounded(spread) - random.nextIntBounded(spread);
      const candidateX = x + offsetX;
      const candidateY = y + offsetY;
      const candidateZ = z + offsetZ;
      const candidate = level.getBlockState(candidateX, candidateY, candidateZ);
      const replaceable = level.blockStates.info(candidate).isAir || isBlock(candidate, WATER_BLOCK) || isBlock(candidate, PACKED_ICE_BLOCK) || isBlock(candidate, ICE_BLOCK);
      if (!replaceable) continue;
      for (const direction of Direction.VALUES) {
        const neighbor = level.getBlockState(candidateX + direction.stepX, candidateY + direction.stepY, candidateZ + direction.stepZ);
        if (isBlock(neighbor, BLUE_ICE_BLOCK)) {
          level.setBlock(candidateX, candidateY, candidateZ, BLUE_ICE_BLOCK, 2);
          break;
        }
      }
    }
    endFeatureStep("feature.blue_ice.spread", level, spreadMark);
    return true;
  },
});
