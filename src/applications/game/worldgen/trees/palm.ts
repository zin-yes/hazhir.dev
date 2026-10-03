/**
 * Palm: a curved leaning trunk crowned with six to eight drooping fronds that arc outward and down,
 * each with leaflets hanging one layer below the rib, plus a few crown knobs. No coconuts.
 */
import { BlockType } from "@/applications/game/blocks";
import {
  COMPASS_STEP_X,
  COMPASS_STEP_Z,
  canopyScaleFor,
  createSolidLeafPaint,
  placeLeafAt,
  randomIntegerInclusive,
  rollScaledHeight,
} from "./tree-geometry";
import type { TreeBlockWriter, TreeBuildOptions, TreeSpecies } from "./tree-types";

const PALM_LEAF_PAINT = createSolidLeafPaint(BlockType.LEAVES_PALM);

function clampStep(value: number, previous: number): number {
  return Math.max(previous - 1, Math.min(previous + 1, value));
}

function buildPalm(writer: TreeBlockWriter, options: TreeBuildOptions): void {
  const { random } = options;
  const canopyScale = canopyScaleFor(options.heightScale);
  const trunkHeight = rollScaledHeight(options, 6, 10, 4);
  const topY = trunkHeight - 1;
  const leanDirection = randomIntegerInclusive(random, 0, 7);
  const leanDistance = randomIntegerInclusive(random, 1, 2);
  const leanX = COMPASS_STEP_X[leanDirection] * leanDistance;
  const leanZ = COMPASS_STEP_Z[leanDirection] * leanDistance;

  let trunkX = 0;
  let trunkZ = 0;
  for (let dy = 0; dy <= topY; dy++) {
    const progress = topY === 0 ? 0 : dy / topY;
    const curve = progress * progress;
    trunkX = clampStep(Math.round(leanX * curve), trunkX);
    trunkZ = clampStep(Math.round(leanZ * curve), trunkZ);
    writer.placeLog(trunkX, dy, trunkZ, BlockType.LOG_PALM);
  }

  writer.placeLog(trunkX, topY + 1, trunkZ, BlockType.LOG_PALM);
  const knobCount = randomIntegerInclusive(random, 1, 2);
  const knobStart = randomIntegerInclusive(random, 0, 3);
  for (let knobIndex = 0; knobIndex < knobCount; knobIndex++) {
    const knobDirection = (knobStart + knobIndex * 2) * 2;
    writer.placeLog(trunkX + COMPASS_STEP_X[knobDirection % 8], topY, trunkZ + COMPASS_STEP_Z[knobDirection % 8], BlockType.LOG_PALM);
  }
  placeLeafAt(writer, PALM_LEAF_PAINT, trunkX, topY + 2, trunkZ);

  const frondCount = randomIntegerInclusive(random, 6, 8);
  const startAngle = random() * Math.PI * 2;
  for (let frondIndex = 0; frondIndex < frondCount; frondIndex++) {
    const angle = startAngle + (frondIndex * Math.PI * 2) / frondCount + (random() - 0.5) * 0.5;
    const directionX = Math.cos(angle);
    const directionZ = Math.sin(angle);
    const frondLength = Math.max(3, Math.round(randomIntegerInclusive(random, 4, 5) * canopyScale));
    let previousRibY = topY + 2;
    for (let distance = 1; distance <= frondLength; distance++) {
      const ribY = topY + 1 + Math.round(1.4 - 0.19 * distance * distance);
      const ribX = trunkX + Math.round(directionX * distance);
      const ribZ = trunkZ + Math.round(directionZ * distance);
      placeLeafAt(writer, PALM_LEAF_PAINT, ribX, ribY, ribZ);
      if (previousRibY - ribY > 1) placeLeafAt(writer, PALM_LEAF_PAINT, ribX, ribY + 1, ribZ);
      previousRibY = ribY;
      if (distance < 2 || distance >= frondLength) continue;
      for (let side = -1; side <= 1; side += 2) {
        if (random() < 0.15) continue;
        const leafletX = trunkX + Math.round(directionX * distance - directionZ * 0.9 * side);
        const leafletZ = trunkZ + Math.round(directionZ * distance + directionX * 0.9 * side);
        placeLeafAt(writer, PALM_LEAF_PAINT, leafletX, ribY - 1, leafletZ);
      }
    }
  }
}

export const PALM_SPECIES: TreeSpecies = { name: "palm", footprintRadius: 9, maxHeight: 16, build: buildPalm };
