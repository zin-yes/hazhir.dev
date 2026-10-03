/**
 * Baobab: a very thick 3x3 bottle trunk that narrows to a plus shape and then a single column,
 * short thick branch stubs and a flat bunched crown of leaves high up.
 */
import { BlockType } from "@/applications/game/blocks";
import {
  canopyScaleFor,
  createSolidLeafPaint,
  fillLeafEllipsoid,
  placeGroundPatch,
  placeLogColumn,
  placeLogLine,
  placeLogPlus,
  placeLogRectangle,
  randomBetween,
  randomIntegerInclusive,
  rollScaledHeight,
} from "./tree-geometry";
import type { TreeBlockWriter, TreeBuildOptions, TreeSpecies } from "./tree-types";

const BAOBAB_LEAF_PAINT = createSolidLeafPaint(BlockType.LEAVES_ACACIA);

function buildBaobab(writer: TreeBlockWriter, options: TreeBuildOptions): void {
  const { random } = options;
  const canopyScale = canopyScaleFor(options.heightScale);
  const trunkHeight = rollScaledHeight(options, 8, 12, 6);
  const topY = trunkHeight - 1;
  const wideTrunkTopY = Math.floor(trunkHeight * 0.5);
  const plusTrunkTopY = Math.floor(trunkHeight * 0.8);

  placeLogRectangle(writer, BlockType.LOG_BAOBAB, -1, -1, 3, 3, 0, wideTrunkTopY);
  placeLogPlus(writer, BlockType.LOG_BAOBAB, 0, 0, wideTrunkTopY + 1, plusTrunkTopY);
  placeLogColumn(writer, BlockType.LOG_BAOBAB, 0, 0, plusTrunkTopY + 1, topY);
  placeGroundPatch(writer, BlockType.COARSE_DIRT, 0, 0, 3.6, random);

  const branchCount = randomIntegerInclusive(random, 4, 6);
  const startAngle = random() * Math.PI * 2;
  for (let branchIndex = 0; branchIndex < branchCount; branchIndex++) {
    const angle = startAngle + (branchIndex * Math.PI * 2) / branchCount + (random() - 0.5) * 0.7;
    const reach = randomBetween(random, 2.5, 4) * canopyScale;
    const startY = Math.max(plusTrunkTopY, topY - randomIntegerInclusive(random, 0, 2));
    const endX = Math.round(Math.cos(angle) * reach);
    const endZ = Math.round(Math.sin(angle) * reach);
    const endY = startY + randomIntegerInclusive(random, 1, 2);
    placeLogLine(writer, BlockType.LOG_BAOBAB, 0, startY, 0, endX, endY, endZ, 2);
    fillLeafEllipsoid(writer, BAOBAB_LEAF_PAINT, endX, endY + 1, endZ, randomBetween(random, 2.2, 2.9) * canopyScale, 1.3 * canopyScale, randomBetween(random, 2.2, 2.9) * canopyScale, random, 0.3);
  }
  fillLeafEllipsoid(writer, BAOBAB_LEAF_PAINT, 0, topY + 2, 0, randomBetween(random, 3.8, 4.8) * canopyScale, 1.7 * canopyScale, randomBetween(random, 3.8, 4.8) * canopyScale, random, 0.3);
}

export const BAOBAB_SPECIES: TreeSpecies = { name: "baobab", footprintRadius: 9, maxHeight: 21, build: buildBaobab };
