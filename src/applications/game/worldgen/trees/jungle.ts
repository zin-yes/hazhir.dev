/**
 * Jungle trees: a small layered-canopy jungle tree with a hanging strand, and the emergent giant
 * with a 2x2 trunk, buttress roots, a huge multi-layer crown and big side branches ending in leaf clusters.
 */
import { BlockType } from "@/applications/game/blocks";
import {
  COMPASS_STEP_X,
  COMPASS_STEP_Z,
  canopyScaleFor,
  createSolidLeafPaint,
  fillLeafEllipsoid,
  placeGroundPatch,
  placeLeafDisc,
  placeLeafRimDroop,
  placeLeafStrand,
  placeLogColumn,
  placeLogLine,
  placeLogRectangle,
  randomBetween,
  randomIntegerInclusive,
  rollScaledHeight,
} from "./tree-geometry";
import type { TreeBlockWriter, TreeBuildOptions, TreeSpecies } from "./tree-types";

const JUNGLE_LEAF_PAINT = createSolidLeafPaint(BlockType.LEAVES_JUNGLE);

function buildJungle(writer: TreeBlockWriter, options: TreeBuildOptions): void {
  const { random } = options;
  const canopyScale = canopyScaleFor(options.heightScale);
  const trunkHeight = rollScaledHeight(options, 8, 12, 5);
  const topY = trunkHeight - 1;
  placeLogColumn(writer, BlockType.LOG_JUNGLE, 0, 0, 0, topY);

  const layerShiftX = randomIntegerInclusive(random, -1, 1);
  const layerShiftZ = randomIntegerInclusive(random, -1, 1);
  const lowerRadius = randomBetween(random, 2.8, 3.6) * canopyScale;
  const middleRadius = randomBetween(random, 3.6, 4.4) * canopyScale;
  placeLeafDisc(writer, JUNGLE_LEAF_PAINT, 0, topY - 2, 0, lowerRadius, lowerRadius, random, 0.3);
  placeLeafRimDroop(writer, JUNGLE_LEAF_PAINT, 0, topY - 2, 0, lowerRadius, lowerRadius, random, 0.25);
  placeLeafDisc(writer, JUNGLE_LEAF_PAINT, layerShiftX, topY - 1, layerShiftZ, middleRadius, middleRadius, random, 0.3);
  placeLeafDisc(writer, JUNGLE_LEAF_PAINT, 0, topY, 0, middleRadius * 0.8, middleRadius * 0.8, random, 0.25);
  placeLeafDisc(writer, JUNGLE_LEAF_PAINT, -layerShiftX, topY + 1, -layerShiftZ, 2.2 * canopyScale, 2.2 * canopyScale, random, 0.15);

  const strandAngle = random() * Math.PI * 2;
  const strandDistance = Math.floor(lowerRadius * 0.8);
  placeLeafStrand(
    writer,
    JUNGLE_LEAF_PAINT,
    Math.round(Math.cos(strandAngle) * strandDistance),
    topY - 3,
    Math.round(Math.sin(strandAngle) * strandDistance),
    randomIntegerInclusive(random, 2, 4),
  );

  if (random() < 0.4) placeGroundPatch(writer, BlockType.PODZOL, 0, 0, 1.8, random);
}

function placeButtressRoots(writer: TreeBlockWriter, random: () => number): void {
  const rootCount = randomIntegerInclusive(random, 4, 6);
  const firstDirection = randomIntegerInclusive(random, 0, 7);
  for (let rootIndex = 0; rootIndex < rootCount; rootIndex++) {
    const direction = (firstDirection + Math.round((rootIndex * 8) / rootCount) + randomIntegerInclusive(random, 0, 1)) % 8;
    const stepX = COMPASS_STEP_X[direction];
    const stepZ = COMPASS_STEP_Z[direction];
    const startX = stepX > 0 ? 1 : stepX < 0 ? 0 : randomIntegerInclusive(random, 0, 1);
    const startZ = stepZ > 0 ? 1 : stepZ < 0 ? 0 : randomIntegerInclusive(random, 0, 1);
    const rootLength = randomIntegerInclusive(random, 3, 4);
    for (let distance = 1; distance <= rootLength; distance++) {
      const rootHeight = Math.max(1, 4 - distance);
      placeLogColumn(writer, BlockType.LOG_JUNGLE, startX + stepX * distance, startZ + stepZ * distance, 0, rootHeight - 1);
    }
  }
}

function buildJungleGiant(writer: TreeBlockWriter, options: TreeBuildOptions): void {
  const { random } = options;
  const canopyScale = canopyScaleFor(options.heightScale);
  const trunkHeight = rollScaledHeight(options, 20, 28, 10);
  const topY = trunkHeight - 1;
  placeLogRectangle(writer, BlockType.LOG_JUNGLE, 0, 0, 2, 2, 0, topY);
  placeButtressRoots(writer, random);
  placeGroundPatch(writer, BlockType.MOSS, 0, 0, 4, random);

  const crownRadius = randomBetween(random, 6.2, 7.2) * canopyScale;
  fillLeafEllipsoid(writer, JUNGLE_LEAF_PAINT, 0, topY - 1, 0, crownRadius, 2.8 * canopyScale, crownRadius, random, 0.28);
  placeLeafDisc(writer, JUNGLE_LEAF_PAINT, randomIntegerInclusive(random, -1, 1), topY - 4, randomIntegerInclusive(random, -1, 1), crownRadius * 0.8, crownRadius * 0.8, random, 0.35);
  placeLeafRimDroop(writer, JUNGLE_LEAF_PAINT, 0, topY - 4, 0, crownRadius * 0.8, crownRadius * 0.8, random, 0.2);
  placeLeafDisc(writer, JUNGLE_LEAF_PAINT, 0, topY + 2, 0, crownRadius * 0.55, crownRadius * 0.55, random, 0.25);
  placeLeafDisc(writer, JUNGLE_LEAF_PAINT, 0, topY + 3, 0, crownRadius * 0.3, crownRadius * 0.3, random, 0.1);

  const branchCount = randomIntegerInclusive(random, 2, 3);
  const startAngle = random() * Math.PI * 2;
  for (let branchIndex = 0; branchIndex < branchCount; branchIndex++) {
    const angle = startAngle + (branchIndex * Math.PI * 2) / branchCount + (random() - 0.5) * 0.9;
    const reach = randomBetween(random, 4.5, 6) * canopyScale;
    const startY = Math.max(6, Math.round(topY * randomBetween(random, 0.5, 0.75)));
    const endX = Math.round(Math.cos(angle) * reach);
    const endZ = Math.round(Math.sin(angle) * reach);
    const endY = startY + randomIntegerInclusive(random, 2, 4);
    placeLogLine(writer, BlockType.LOG_JUNGLE, 0, startY, 0, endX, endY, endZ, 2);
    fillLeafEllipsoid(writer, JUNGLE_LEAF_PAINT, endX, endY + 1, endZ, randomBetween(random, 3.0, 3.6) * canopyScale, randomBetween(random, 2.0, 2.5) * canopyScale, randomBetween(random, 3.0, 3.6) * canopyScale, random, 0.28);
  }
}

export const JUNGLE_SPECIES: TreeSpecies = { name: "jungle", footprintRadius: 6, maxHeight: 18, build: buildJungle };
export const JUNGLE_GIANT_SPECIES: TreeSpecies = { name: "jungle_giant", footprintRadius: 12, maxHeight: 40, build: buildJungleGiant };
