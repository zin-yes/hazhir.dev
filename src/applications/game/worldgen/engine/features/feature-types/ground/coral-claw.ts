// Mirrors CoralClawFeature (minecraft:coral_claw): a coral block with two or three arms (forward, left, right) that
// curl upwards.

import { Direction } from "../../core/direction";
import { defineCoralFeatureType, placeCoralBlock } from "./coral-feature";
import { clockWise, counterClockWise } from "./support/directions";
import { randomElementOf, shuffledCopy } from "./support/random-shuffle";

const fround = Math.fround;
const ARM_RISE_CHANCE = fround(0.25);

export const coralClawFeature = defineCoralFeatureType("minecraft:coral_claw", (level, random, originX, originY, originZ, coralBlockState) => {
  if (!placeCoralBlock(level, random, originX, originY, originZ, coralBlockState)) return false;
  const forward = randomElementOf(Direction.HORIZONTAL, random);
  const armCount = random.nextIntBounded(2) + 2;
  const arms = shuffledCopy([forward, clockWise(forward), counterClockWise(forward)], random).slice(0, armCount);
  for (const arm of arms) {
    let x = originX;
    let y = originY;
    let z = originZ;
    const baseLength = random.nextIntBounded(2) + 1;
    x += arm.stepX;
    z += arm.stepZ;
    let curlDirection: Direction;
    let tipLength: number;
    if (arm === forward) {
      curlDirection = forward;
      tipLength = random.nextIntBounded(3) + 2;
    } else {
      y++;
      curlDirection = randomElementOf([arm, Direction.UP], random);
      tipLength = random.nextIntBounded(3) + 3;
    }
    for (let step = 0; step < baseLength && placeCoralBlock(level, random, x, y, z, coralBlockState); step++) {
      x += curlDirection.stepX;
      y += curlDirection.stepY;
      z += curlDirection.stepZ;
    }
    x += curlDirection.opposite.stepX;
    y += curlDirection.opposite.stepY;
    z += curlDirection.opposite.stepZ;
    y++;
    for (let step = 0; step < tipLength; step++) {
      x += forward.stepX;
      z += forward.stepZ;
      if (!placeCoralBlock(level, random, x, y, z, coralBlockState)) break;
      if (random.nextFloat() < ARM_RISE_CHANCE) y++;
    }
  }
  return true;
});
