/**
 * Oak shapes: the common small round-crowned oak and the taller broad layered oak.
 * Both honour options.leafVariant (autumn colouring) through a coherent leaf paint.
 */
import { BlockType } from "@/applications/game/blocks";
import {
  canopyScaleFor,
  createLeafPaint,
  fillLeafEllipsoid,
  placeLogColumn,
  placeLogLine,
  randomBetween,
  randomIntegerInclusive,
  rollScaledHeight,
} from "./tree-geometry";
import type { TreeBlockWriter, TreeBuildOptions, TreeSpecies } from "./tree-types";

function buildSmallOak(writer: TreeBlockWriter, options: TreeBuildOptions): void {
  const { random } = options;
  const paint = createLeafPaint(BlockType.LEAVES, options);
  const canopyScale = canopyScaleFor(options.heightScale);
  const trunkHeight = rollScaledHeight(options, 5, 8, 3);
  const topY = trunkHeight - 1;
  placeLogColumn(writer, BlockType.LOG, 0, 0, 0, topY);

  const crownShiftX = randomIntegerInclusive(random, -1, 1);
  const crownShiftZ = randomIntegerInclusive(random, -1, 1);
  fillLeafEllipsoid(
    writer,
    paint,
    crownShiftX,
    topY,
    crownShiftZ,
    randomBetween(random, 2.4, 3.1) * canopyScale,
    randomBetween(random, 2.0, 2.6) * canopyScale,
    randomBetween(random, 2.4, 3.1) * canopyScale,
    random,
    0.22,
  );

  const sideClumpCount = randomIntegerInclusive(random, 2, 3);
  const startAngle = random() * Math.PI * 2;
  for (let clumpIndex = 0; clumpIndex < sideClumpCount; clumpIndex++) {
    const angle = startAngle + (clumpIndex * Math.PI * 2) / sideClumpCount + (random() - 0.5) * 0.8;
    const branchStartY = Math.max(1, topY - randomIntegerInclusive(random, 1, 3));
    const endX = Math.round(Math.cos(angle) * 2);
    const endZ = Math.round(Math.sin(angle) * 2);
    placeLogLine(writer, BlockType.LOG, 0, branchStartY, 0, endX, branchStartY + 1, endZ);
    fillLeafEllipsoid(
      writer,
      paint,
      endX,
      branchStartY + 1,
      endZ,
      randomBetween(random, 1.5, 1.9) * canopyScale,
      randomBetween(random, 1.2, 1.5) * canopyScale,
      randomBetween(random, 1.5, 1.9) * canopyScale,
      random,
      0.25,
    );
  }

  if (random() < 0.35) {
    const forkEndX = randomIntegerInclusive(random, 1, 2) * (random() < 0.5 ? -1 : 1);
    const forkEndZ = randomIntegerInclusive(random, 1, 2) * (random() < 0.5 ? -1 : 1);
    placeLogLine(writer, BlockType.LOG, 0, topY - 1, 0, forkEndX, topY + 1, forkEndZ);
    fillLeafEllipsoid(
      writer,
      paint,
      forkEndX,
      topY + 1,
      forkEndZ,
      2.1 * canopyScale,
      1.7 * canopyScale,
      2.1 * canopyScale,
      random,
      0.22,
    );
  }
}

function buildTallOak(writer: TreeBlockWriter, options: TreeBuildOptions): void {
  const { random } = options;
  const paint = createLeafPaint(BlockType.LEAVES, options);
  const canopyScale = canopyScaleFor(options.heightScale);
  const trunkHeight = rollScaledHeight(options, 9, 13, 5);
  const topY = trunkHeight - 1;

  const kinkHeight = random() < 0.4 ? randomIntegerInclusive(random, 3, Math.max(3, topY - 3)) : -1;
  const kinkStepX = randomIntegerInclusive(random, -1, 1);
  const kinkStepZ = randomIntegerInclusive(random, -1, 1);
  let trunkX = 0;
  let trunkZ = 0;
  for (let dy = 0; dy <= topY; dy++) {
    if (dy === kinkHeight) {
      trunkX += kinkStepX;
      trunkZ += kinkStepZ;
    }
    writer.placeLog(trunkX, dy, trunkZ, BlockType.LOG);
  }

  fillLeafEllipsoid(writer, paint, trunkX, topY - 4, trunkZ, randomBetween(random, 4.2, 5.0) * canopyScale, 1.5 * canopyScale, randomBetween(random, 4.2, 5.0) * canopyScale, random, 0.28);
  fillLeafEllipsoid(writer, paint, trunkX, topY - 2, trunkZ, randomBetween(random, 3.6, 4.4) * canopyScale, 2.0 * canopyScale, randomBetween(random, 3.6, 4.4) * canopyScale, random, 0.22);
  fillLeafEllipsoid(writer, paint, trunkX, topY, trunkZ, randomBetween(random, 2.4, 3.2) * canopyScale, 1.9 * canopyScale, randomBetween(random, 2.4, 3.2) * canopyScale, random, 0.2);

  const branchCount = randomIntegerInclusive(random, 3, 4);
  const startAngle = random() * Math.PI * 2;
  for (let branchIndex = 0; branchIndex < branchCount; branchIndex++) {
    const angle = startAngle + (branchIndex * Math.PI * 2) / branchCount + (random() - 0.5) * 0.7;
    const reach = randomBetween(random, 3, 4) * canopyScale;
    const branchStartY = Math.max(2, topY - randomIntegerInclusive(random, 3, 6));
    const endX = trunkX + Math.round(Math.cos(angle) * reach);
    const endZ = trunkZ + Math.round(Math.sin(angle) * reach);
    const endY = branchStartY + randomIntegerInclusive(random, 1, 2);
    placeLogLine(writer, BlockType.LOG, trunkX, branchStartY, trunkZ, endX, endY, endZ);
    fillLeafEllipsoid(writer, paint, endX, endY + 1, endZ, randomBetween(random, 2.0, 2.6) * canopyScale, randomBetween(random, 1.6, 2.1) * canopyScale, randomBetween(random, 2.0, 2.6) * canopyScale, random, 0.25);
  }
}

export const OAK_SPECIES: TreeSpecies = { name: "oak", footprintRadius: 5, maxHeight: 13, build: buildSmallOak };
export const TALL_OAK_SPECIES: TreeSpecies = { name: "tall_oak", footprintRadius: 9, maxHeight: 20, build: buildTallOak };
