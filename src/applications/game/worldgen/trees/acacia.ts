/**
 * Acacia: a trunk that rises, bends diagonally and splits into one or two forks, each topped by
 * a flat umbrella of leaves one to two layers thick.
 */
import { BlockType } from "@/applications/game/blocks";
import {
  COMPASS_STEP_X,
  COMPASS_STEP_Z,
  canopyScaleFor,
  createSolidLeafPaint,
  placeGroundPatch,
  placeLeafDisc,
  placeLeafRimDroop,
  placeLogColumn,
  placeLogLine,
  randomBetween,
  randomIntegerInclusive,
  rollScaledHeight,
} from "./tree-geometry";
import type { TreeBlockWriter, TreeBuildOptions, TreeSpecies } from "./tree-types";

const MAX_MAIN_FORK_OFFSET = 4;
const MAX_SECOND_FORK_OFFSET = 3;
const ACACIA_LEAF_PAINT = createSolidLeafPaint(BlockType.LEAVES_ACACIA);

function placeUmbrella(
  writer: TreeBlockWriter,
  random: () => number,
  centerX: number,
  topY: number,
  centerZ: number,
  radius: number,
): void {
  const radiusZ = radius * randomBetween(random, 0.75, 1);
  const stretchesAlongZ = random() < 0.5;
  const wideRadiusX = stretchesAlongZ ? radiusZ : radius;
  const wideRadiusZ = stretchesAlongZ ? radius : radiusZ;
  placeLeafDisc(writer, ACACIA_LEAF_PAINT, centerX, topY, centerZ, wideRadiusX, wideRadiusZ, random, 0.28);
  placeLeafDisc(writer, ACACIA_LEAF_PAINT, centerX, topY + 1, centerZ, wideRadiusX * 0.62, wideRadiusZ * 0.62, random, 0.25);
  placeLeafRimDroop(writer, ACACIA_LEAF_PAINT, centerX, topY, centerZ, wideRadiusX, wideRadiusZ, random, 0.12);
}

function buildAcacia(writer: TreeBlockWriter, options: TreeBuildOptions): void {
  const { random } = options;
  const canopyScale = canopyScaleFor(options.heightScale);
  const trunkHeight = rollScaledHeight(options, 5, 9, 4);
  const bendHeight = Math.max(1, Math.round(trunkHeight * randomBetween(random, 0.35, 0.5)));
  placeLogColumn(writer, BlockType.LOG_ACACIA, 0, 0, 0, bendHeight);

  const mainDirection = randomIntegerInclusive(random, 0, 7);
  const mainRise = trunkHeight - 1 - bendHeight;
  const mainOffset = Math.min(MAX_MAIN_FORK_OFFSET, Math.max(1, mainRise));
  const mainEndX = COMPASS_STEP_X[mainDirection] * mainOffset;
  const mainEndZ = COMPASS_STEP_Z[mainDirection] * mainOffset;
  const mainEndY = bendHeight + Math.max(1, mainRise);
  placeLogLine(writer, BlockType.LOG_ACACIA, 0, bendHeight, 0, mainEndX, mainEndY, mainEndZ);
  placeUmbrella(writer, random, mainEndX, mainEndY, mainEndZ, randomBetween(random, 3.8, 5.2) * canopyScale);

  if (random() < 0.7) {
    const forkDirection = (mainDirection + randomIntegerInclusive(random, 3, 5)) % 8;
    const forkRise = randomIntegerInclusive(random, 2, Math.max(2, Math.round(mainRise * 0.9)));
    const forkOffset = Math.min(MAX_SECOND_FORK_OFFSET, forkRise);
    const forkEndX = COMPASS_STEP_X[forkDirection] * forkOffset;
    const forkEndZ = COMPASS_STEP_Z[forkDirection] * forkOffset;
    const forkEndY = bendHeight + forkRise;
    placeLogLine(writer, BlockType.LOG_ACACIA, 0, bendHeight, 0, forkEndX, forkEndY, forkEndZ);
    placeUmbrella(writer, random, forkEndX, forkEndY, forkEndZ, randomBetween(random, 2.8, 4.0) * canopyScale);
  }

  if (random() < 0.5) placeGroundPatch(writer, BlockType.COARSE_DIRT, 0, 0, 1.8, random);
}

export const ACACIA_SPECIES: TreeSpecies = { name: "acacia", footprintRadius: 10, maxHeight: 14, build: buildAcacia };
