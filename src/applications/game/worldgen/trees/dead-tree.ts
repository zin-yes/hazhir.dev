/**
 * Dead tree: a bare LOG_DEAD trunk with a broken top, sometimes leaning, and two to four stub
 * branches angled out and upward. Places no leaves.
 */
import { BlockType } from "@/applications/game/blocks";
import {
  COMPASS_STEP_X,
  COMPASS_STEP_Z,
  placeGroundPatch,
  placeLogLine,
  randomIntegerInclusive,
  rollScaledHeight,
} from "./tree-geometry";
import type { TreeBlockWriter, TreeBuildOptions, TreeSpecies } from "./tree-types";

function buildDeadTree(writer: TreeBlockWriter, options: TreeBuildOptions): void {
  const { random } = options;
  const trunkHeight = rollScaledHeight(options, 4, 9, 3);
  const topY = trunkHeight - 1;
  const leansTrunk = random() < 0.35;
  const leanDirection = randomIntegerInclusive(random, 0, 7);
  const leanStartY = randomIntegerInclusive(random, 1, Math.max(1, topY - 1));

  let trunkX = 0;
  let trunkZ = 0;
  for (let dy = 0; dy <= topY; dy++) {
    if (leansTrunk && dy >= leanStartY && (dy - leanStartY) % 3 === 0 && dy > leanStartY) {
      trunkX += COMPASS_STEP_X[leanDirection];
      trunkZ += COMPASS_STEP_Z[leanDirection];
    }
    writer.placeLog(trunkX, dy, trunkZ, BlockType.LOG_DEAD);
  }
  const brokenOffset = randomIntegerInclusive(random, 0, 1);
  if (brokenOffset === 1 && topY >= 3) {
    writer.placeLog(trunkX + COMPASS_STEP_X[randomIntegerInclusive(random, 0, 7)], topY, trunkZ + COMPASS_STEP_Z[randomIntegerInclusive(random, 0, 7)], BlockType.LOG_DEAD);
  }

  const stubCount = Math.min(randomIntegerInclusive(random, 2, 4), Math.max(1, topY - 1));
  const startAngle = random() * Math.PI * 2;
  for (let stubIndex = 0; stubIndex < stubCount; stubIndex++) {
    const angle = startAngle + (stubIndex * Math.PI * 2) / stubCount + (random() - 0.5) * 0.9;
    const startY = Math.max(1, Math.round(topY * (0.35 + 0.6 * random())));
    const length = randomIntegerInclusive(random, 2, 3);
    const stubEndX = trunkX + Math.round(Math.cos(angle) * length);
    const stubEndZ = trunkZ + Math.round(Math.sin(angle) * length);
    const stubEndY = startY + (random() < 0.6 ? 1 : 2);
    placeLogLine(writer, BlockType.LOG_DEAD, trunkX, startY, trunkZ, stubEndX, stubEndY, stubEndZ);
  }

  if (random() < 0.4) placeGroundPatch(writer, BlockType.COARSE_DIRT, 0, 0, 1.6, random);
}

export const DEAD_TREE_SPECIES: TreeSpecies = { name: "dead", footprintRadius: 7, maxHeight: 14, build: buildDeadTree };
