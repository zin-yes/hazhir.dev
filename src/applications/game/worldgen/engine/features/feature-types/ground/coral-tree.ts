// Mirrors CoralTreeFeature (minecraft:coral_tree): a short trunk with 2..4 horizontal branches that climb.

import { Direction } from "../../core/direction";
import { defineCoralFeatureType, placeCoralBlock } from "./coral-feature";
import { shuffledCopy } from "./support/random-shuffle";

const fround = Math.fround;
const BRANCH_TURN_CHANCE = fround(0.25);

export const coralTreeFeature = defineCoralFeatureType("minecraft:coral_tree", (level, random, originX, originY, originZ, coralBlockState) => {
  let y = originY;
  const trunkHeight = random.nextIntBounded(3) + 1;
  for (let step = 0; step < trunkHeight; step++) {
    if (!placeCoralBlock(level, random, originX, y, originZ, coralBlockState)) return true;
    y++;
  }
  const branchBaseY = y;
  const branchCount = random.nextIntBounded(3) + 2;
  const branchDirections = shuffledCopy(Direction.HORIZONTAL, random).slice(0, branchCount);
  for (const direction of branchDirections) {
    let branchX = originX + direction.stepX;
    let branchY = branchBaseY;
    let branchZ = originZ + direction.stepZ;
    const branchLength = random.nextIntBounded(5) + 2;
    let sinceTurn = 0;
    for (let step = 0; step < branchLength && placeCoralBlock(level, random, branchX, branchY, branchZ, coralBlockState); step++) {
      branchY++;
      if (step !== 0 && (++sinceTurn < 2 || !(random.nextFloat() < BRANCH_TURN_CHANCE))) continue;
      branchX += direction.stepX;
      branchZ += direction.stepZ;
      sinceTurn = 0;
    }
  }
  return true;
});
