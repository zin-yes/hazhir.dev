// Mirrors BlockBlobFeature (minecraft:forest_rock): three overlapping blobs of the configured block, sunk onto
// the first dirt or stone block found below the origin.

import { defineFeatureType } from "../../feature/feature-type";
import { asObject } from "../../providers/json-fields";
import { isDirt, isStone } from "./block-names";
import { roundFloat } from "./java-float-math";

export interface ForestRockConfig {
  readonly state: string;
}

const BLOB_RADIUS_STEP = roundFloat(0.333);
const BLOB_RADIUS_BASE = roundFloat(0.5);
const BOTTOM_CLEARANCE = 3;

export const forestRockFeature = defineFeatureType<ForestRockConfig>({
  id: "minecraft:forest_rock",
  parseConfig(json, parser) {
    const config = asObject(json, "forest_rock config");
    return { state: parser.blockState(config.state, "forest_rock.state") };
  },
  place({ level, random, origin, config }) {
    const { x: originX, z: originZ } = origin;
    let centerX = originX;
    let centerY = origin.y;
    let centerZ = originZ;
    while (centerY > level.minY + BOTTOM_CLEARANCE) {
      const belowIsEmpty = level.isEmptyBlock(centerX, centerY - 1, centerZ);
      if (!belowIsEmpty) {
        const below = level.getBlockState(centerX, centerY - 1, centerZ);
        if (isDirt(level, below) || isStone(level, below)) break;
      }
      centerY--;
    }
    if (centerY <= level.minY + BOTTOM_CLEARANCE) return false;
    for (let blob = 0; blob < 3; blob++) {
      const radiusX = random.nextIntBounded(2);
      const radiusY = random.nextIntBounded(2);
      const radiusZ = random.nextIntBounded(2);
      const blobRadius = roundFloat(roundFloat(roundFloat(radiusX + radiusY + radiusZ) * BLOB_RADIUS_STEP) + BLOB_RADIUS_BASE);
      const maximumSquaredDistance = roundFloat(blobRadius * blobRadius);
      for (let positionZ = centerZ - radiusZ; positionZ <= centerZ + radiusZ; positionZ++) {
        for (let positionY = centerY - radiusY; positionY <= centerY + radiusY; positionY++) {
          for (let positionX = centerX - radiusX; positionX <= centerX + radiusX; positionX++) {
            const deltaX = positionX - centerX;
            const deltaY = positionY - centerY;
            const deltaZ = positionZ - centerZ;
            if (deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ <= maximumSquaredDistance) level.setBlock(positionX, positionY, positionZ, config.state, 3);
          }
        }
      }
      centerX += -1 + random.nextIntBounded(2);
      centerY -= random.nextIntBounded(2);
      centerZ += -1 + random.nextIntBounded(2);
    }
    return true;
  },
});
