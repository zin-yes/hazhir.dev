// Mirrors IceSpikeFeature (minecraft:ice_spike): a packed ice spike (with a mirrored root below) on snow blocks.

import { defineFeatureType } from "../../feature/feature-type";
import type { WorldGenLevel } from "../../level/world-gen-level";
import { ICE_BLOCK, isBlock, isDirt, PACKED_ICE_BLOCK, SNOW_BLOCK } from "./block-names";
import { ceilFloat, divideInt, roundFloat } from "./java-float-math";

const EDGE_SKIP_THRESHOLD = roundFloat(0.75);
const RADIUS_BIAS = roundFloat(0.25);
const ROOT_MINIMUM_Y = 50;

/** air, dirt tag, snow block or ice: what the spike body may replace. */
function isSpikeReplaceable(level: WorldGenLevel, state: string): boolean {
  return level.blockStates.info(state).isAir || isDirt(level, state) || isBlock(state, SNOW_BLOCK) || isBlock(state, ICE_BLOCK);
}

export const iceSpikeFeature = defineFeatureType<undefined>({
  id: "minecraft:ice_spike",
  parseConfig: () => undefined,
  place({ level, random, origin }) {
    const x = origin.x;
    const z = origin.z;
    let y = origin.y;
    while (level.isEmptyBlock(x, y, z) && y > level.minY + 2) y--;
    if (!isBlock(level.getBlockState(x, y, z), SNOW_BLOCK)) return false;
    y += random.nextIntBounded(4);
    const height = random.nextIntBounded(4) + 7;
    const width = divideInt(height, 4) + random.nextIntBounded(2);
    if (width > 1 && random.nextIntBounded(60) === 0) y += 10 + random.nextIntBounded(30);

    for (let layer = 0; layer < height; layer++) {
      const layerRadius = roundFloat(roundFloat(1 - roundFloat(layer / height)) * width);
      const reach = ceilFloat(layerRadius);
      for (let offsetX = -reach; offsetX <= reach; offsetX++) {
        const distanceX = roundFloat(Math.abs(offsetX) - RADIUS_BIAS);
        for (let offsetZ = -reach; offsetZ <= reach; offsetZ++) {
          const distanceZ = roundFloat(Math.abs(offsetZ) - RADIUS_BIAS);
          const outsideCircle = (offsetX !== 0 || offsetZ !== 0) && roundFloat(roundFloat(distanceX * distanceX) + roundFloat(distanceZ * distanceZ)) > roundFloat(layerRadius * layerRadius);
          if (outsideCircle) continue;
          const onSquareEdge = offsetX === -reach || offsetX === reach || offsetZ === -reach || offsetZ === reach;
          if (onSquareEdge && random.nextFloat() > EDGE_SKIP_THRESHOLD) continue;
          if (isSpikeReplaceable(level, level.getBlockState(x + offsetX, y + layer, z + offsetZ))) {
            level.setBlock(x + offsetX, y + layer, z + offsetZ, PACKED_ICE_BLOCK, 3);
          }
          if (layer === 0 || reach <= 1) continue;
          if (isSpikeReplaceable(level, level.getBlockState(x + offsetX, y - layer, z + offsetZ))) {
            level.setBlock(x + offsetX, y - layer, z + offsetZ, PACKED_ICE_BLOCK, 3);
          }
        }
      }
    }

    const rootRadius = Math.min(Math.max(width - 1, 0), 1);
    for (let offsetX = -rootRadius; offsetX <= rootRadius; offsetX++) {
      for (let offsetZ = -rootRadius; offsetZ <= rootRadius; offsetZ++) {
        let rootY = y - 1;
        let stepsUntilGap = 50;
        if (Math.abs(offsetX) === 1 && Math.abs(offsetZ) === 1) stepsUntilGap = random.nextIntBounded(5);
        while (rootY > ROOT_MINIMUM_Y) {
          const state = level.getBlockState(x + offsetX, rootY, z + offsetZ);
          if (!(isSpikeReplaceable(level, state) || isBlock(state, PACKED_ICE_BLOCK))) break;
          level.setBlock(x + offsetX, rootY, z + offsetZ, PACKED_ICE_BLOCK, 3);
          rootY--;
          stepsUntilGap--;
          if (stepsUntilGap > 0) continue;
          rootY -= random.nextIntBounded(5) + 1;
          stepsUntilGap = random.nextIntBounded(5);
        }
      }
    }
    return true;
  },
});
