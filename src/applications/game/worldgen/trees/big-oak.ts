/**
 * Old growth oak: 2x2 trunk, root flare of logs at the base, wide irregular canopy of overlapping
 * clumps carried on thick branches, hanging leaf strands and a podzol floor patch.
 */
import { BlockType } from "@/applications/game/blocks";
import {
  canopyScaleFor,
  createLeafPaint,
  fillLeafEllipsoid,
  placeGroundPatch,
  placeLeafStrand,
  placeLogLine,
  placeLogRectangle,
  randomBetween,
  randomIntegerInclusive,
  rollScaledHeight,
} from "./tree-geometry";
import type { LeafPaint } from "./tree-geometry";
import type { TreeBlockWriter, TreeBuildOptions, TreeSpecies } from "./tree-types";

function buildRootFlare(writer: TreeBlockWriter, random: () => number): void {
  for (let dx = -1; dx <= 2; dx++) {
    for (let dz = -1; dz <= 2; dz++) {
      const insideTrunk = dx >= 0 && dx <= 1 && dz >= 0 && dz <= 1;
      if (insideTrunk || random() < 0.4) continue;
      writer.placeLog(dx, 0, dz, BlockType.LOG);
      const touchesTrunkEdge = (dx >= 0 && dx <= 1) || (dz >= 0 && dz <= 1);
      if (!touchesTrunkEdge) continue;
      if (random() < 0.45) writer.placeLog(dx, 1, dz, BlockType.LOG);
      if (random() < 0.5) {
        const outwardX = dx < 0 ? -1 : dx > 1 ? 1 : 0;
        const outwardZ = dz < 0 ? -1 : dz > 1 ? 1 : 0;
        writer.placeLog(dx + outwardX, 0, dz + outwardZ, BlockType.LOG);
      }
    }
  }
}

function placeCanopyClump(
  writer: TreeBlockWriter,
  paint: LeafPaint,
  random: () => number,
  centerX: number,
  centerY: number,
  centerZ: number,
  canopyScale: number,
): number {
  const radiusY = randomBetween(random, 2.2, 2.8) * canopyScale;
  fillLeafEllipsoid(
    writer,
    paint,
    centerX,
    centerY,
    centerZ,
    randomBetween(random, 2.8, 3.4) * canopyScale,
    radiusY,
    randomBetween(random, 2.8, 3.4) * canopyScale,
    random,
    0.26,
  );
  return radiusY;
}

function buildBigOak(writer: TreeBlockWriter, options: TreeBuildOptions): void {
  const { random } = options;
  const paint = createLeafPaint(BlockType.LEAVES, options);
  const canopyScale = canopyScaleFor(options.heightScale);
  const trunkHeight = rollScaledHeight(options, 12, 17, 6);
  const topY = trunkHeight - 1;

  placeLogRectangle(writer, BlockType.LOG, 0, 0, 2, 2, 0, topY - 3);
  placeLogRectangle(writer, BlockType.LOG, 0, 0, 1, 1, topY - 2, topY);
  writer.placeLog(1, topY - 2, 1, BlockType.LOG);
  buildRootFlare(writer, random);

  placeGroundPatch(writer, random() < 0.7 ? BlockType.PODZOL : BlockType.COARSE_DIRT, 0, 0, 3.4, random);

  fillLeafEllipsoid(writer, paint, 0, topY - 1, 0, 5.2 * canopyScale, 3.4 * canopyScale, 5.2 * canopyScale, random, 0.24);

  const clumpCount = randomIntegerInclusive(random, 5, 7);
  const startAngle = random() * Math.PI * 2;
  for (let clumpIndex = 0; clumpIndex < clumpCount; clumpIndex++) {
    const angle = startAngle + (clumpIndex * Math.PI * 2) / clumpCount + (random() - 0.5) * 0.6;
    const distance = randomBetween(random, 2.6, 4.2) * canopyScale;
    const centerX = Math.round(Math.cos(angle) * distance);
    const centerZ = Math.round(Math.sin(angle) * distance);
    const centerY = topY - randomIntegerInclusive(random, 1, 5);
    const branchStartY = Math.max(3, centerY - randomIntegerInclusive(random, 2, 3));
    placeLogLine(writer, BlockType.LOG, 0, branchStartY, 0, centerX, centerY - 1, centerZ, 2);
    const radiusY = placeCanopyClump(writer, paint, random, centerX, centerY, centerZ, canopyScale);
    if (random() < 0.5) {
      const strandLength = randomIntegerInclusive(random, 1, 3);
      const strandStartY = Math.ceil(centerY - radiusY) - 1;
      placeLeafStrand(writer, paint, centerX + randomIntegerInclusive(random, -1, 1), strandStartY, centerZ + randomIntegerInclusive(random, -1, 1), strandLength);
    }
  }
}

export const BIG_OAK_SPECIES: TreeSpecies = { name: "big_oak", footprintRadius: 9, maxHeight: 25, build: buildBigOak };
