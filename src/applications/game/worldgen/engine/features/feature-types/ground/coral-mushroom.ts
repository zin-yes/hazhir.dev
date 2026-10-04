// Mirrors CoralMushroomFeature (minecraft:coral_mushroom): the edges and faces of a random box of coral blocks,
// shifted down by up to three blocks.

import { defineCoralFeatureType, placeCoralBlock } from "./coral-feature";

const fround = Math.fround;
const SKIP_CHANCE = fround(0.1);

export const coralMushroomFeature = defineCoralFeatureType("minecraft:coral_mushroom", (level, random, originX, originY, originZ, coralBlockState) => {
  const sizeY = random.nextIntBounded(3) + 3;
  const sizeX = random.nextIntBounded(3) + 3;
  const sizeZ = random.nextIntBounded(3) + 3;
  const depth = random.nextIntBounded(3) + 1;
  for (let offsetX = 0; offsetX <= sizeX; offsetX++) {
    for (let offsetY = 0; offsetY <= sizeY; offsetY++) {
      for (let offsetZ = 0; offsetZ <= sizeZ; offsetZ++) {
        const x = offsetX + originX;
        const y = offsetY + originY - depth;
        const z = offsetZ + originZ;
        const xIsInner = offsetX !== 0 && offsetX !== sizeX;
        const yIsInner = offsetY !== 0 && offsetY !== sizeY;
        const zIsInner = offsetZ !== 0 && offsetZ !== sizeZ;
        // Exactly one coordinate on the box boundary: the box faces without their edges.
        if ((xIsInner || yIsInner) && (zIsInner || yIsInner) && (xIsInner || zIsInner) && (!xIsInner || !yIsInner || !zIsInner) && !(random.nextFloat() < SKIP_CHANCE)) {
          placeCoralBlock(level, random, x, y, z, coralBlockState);
        }
      }
    }
  }
  return true;
});
