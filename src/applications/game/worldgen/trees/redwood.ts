/**
 * Redwood: a giant 3x3 trunk that thins to a plus shape and then a single column by about 60 percent
 * of its height, with a flared base, almost no branches and a small narrow conical crown at the top.
 */
import { BlockType } from "@/applications/game/blocks";
import {
  canopyScaleFor,
  createSolidLeafPaint,
  fillLeafEllipsoid,
  placeGroundPatch,
  placeLeafCone,
  placeLogColumn,
  placeLogLine,
  placeLogPlus,
  placeLogRectangle,
  randomBetween,
  randomIntegerInclusive,
  rollScaledHeight,
} from "./tree-geometry";
import type { TreeBlockWriter, TreeBuildOptions, TreeSpecies } from "./tree-types";

const REDWOOD_LEAF_PAINT = createSolidLeafPaint(BlockType.LEAVES_REDWOOD);

function placeBaseFlare(writer: TreeBlockWriter, random: () => number): void {
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) continue;
      const isCorner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
      if (isCorner || random() < 0.35) continue;
      writer.placeLog(dx, 0, dz, BlockType.LOG_REDWOOD);
      if (Math.abs(dx) + Math.abs(dz) === 2 && random() < 0.55) writer.placeLog(dx, 1, dz, BlockType.LOG_REDWOOD);
    }
  }
}

function buildRedwood(writer: TreeBlockWriter, options: TreeBuildOptions): void {
  const { random } = options;
  const canopyScale = canopyScaleFor(options.heightScale);
  const trunkHeight = rollScaledHeight(options, 28, 45, 14);
  const topY = trunkHeight - 1;
  const wideTrunkTopY = Math.floor(trunkHeight * 0.25);
  const plusTrunkTopY = Math.floor(trunkHeight * 0.58);

  placeLogRectangle(writer, BlockType.LOG_REDWOOD, -1, -1, 3, 3, 0, wideTrunkTopY);
  placeLogPlus(writer, BlockType.LOG_REDWOOD, 0, 0, wideTrunkTopY + 1, plusTrunkTopY);
  placeLogColumn(writer, BlockType.LOG_REDWOOD, 0, 0, plusTrunkTopY + 1, topY);
  placeBaseFlare(writer, random);
  placeGroundPatch(writer, BlockType.PODZOL, 0, 0, 4.4, random);

  const crownBottomY = Math.max(plusTrunkTopY + 2, Math.round(topY - trunkHeight * 0.26));
  const crownRadius = randomBetween(random, 2.8, 3.6) * canopyScale;
  placeLeafCone(writer, REDWOOD_LEAF_PAINT, 0, 0, topY + 2, crownBottomY, crownRadius, 1, random, 0.3);

  const stubCount = randomIntegerInclusive(random, 2, 4);
  for (let stubIndex = 0; stubIndex < stubCount; stubIndex++) {
    const angle = random() * Math.PI * 2;
    const stubY = randomIntegerInclusive(random, crownBottomY - 5, crownBottomY - 1);
    const endX = Math.round(Math.cos(angle) * 2);
    const endZ = Math.round(Math.sin(angle) * 2);
    placeLogLine(writer, BlockType.LOG_REDWOOD, 0, stubY, 0, endX, stubY, endZ);
    fillLeafEllipsoid(writer, REDWOOD_LEAF_PAINT, endX, stubY, endZ, 1.4, 1.0, 1.4, random, 0.3);
  }
}

export const REDWOOD_SPECIES: TreeSpecies = { name: "redwood", footprintRadius: 5, maxHeight: 62, build: buildRedwood };
