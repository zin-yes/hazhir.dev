/**
 * Cherry: a short trunk that forks into two or three outward-leaning branches, each carrying a wide
 * flat blossom canopy with drooping edges.
 */
import { BlockType } from "@/applications/game/blocks";
import {
  canopyScaleFor,
  createSolidLeafPaint,
  fillLeafEllipsoid,
  placeLeafRimDroop,
  placeLogColumn,
  placeLogLine,
  randomBetween,
  randomIntegerInclusive,
  rollScaledHeight,
} from "./tree-geometry";
import type { TreeBlockWriter, TreeBuildOptions, TreeSpecies } from "./tree-types";

const BLOSSOM_LEAF_PAINT = createSolidLeafPaint(BlockType.LEAVES_BLOSSOM);

function buildCherry(writer: TreeBlockWriter, options: TreeBuildOptions): void {
  const { random } = options;
  const canopyScale = canopyScaleFor(options.heightScale);
  const trunkHeight = rollScaledHeight(options, 5, 7, 3);
  const forkY = Math.max(1, Math.round(trunkHeight * randomBetween(random, 0.4, 0.55)));
  placeLogColumn(writer, BlockType.LOG_CHERRY, 0, 0, 0, forkY);

  const branchCount = randomIntegerInclusive(random, 2, 3);
  const startAngle = random() * Math.PI * 2;
  for (let branchIndex = 0; branchIndex < branchCount; branchIndex++) {
    const angle = startAngle + (branchIndex * Math.PI * 2) / branchCount + (random() - 0.5) * 0.6;
    const rise = Math.max(2, trunkHeight - 1 - forkY + randomIntegerInclusive(random, 0, 1));
    const reach = Math.min(rise, randomIntegerInclusive(random, 2, 3));
    const endX = Math.round(Math.cos(angle) * reach);
    const endZ = Math.round(Math.sin(angle) * reach);
    const endY = forkY + rise;
    placeLogLine(writer, BlockType.LOG_CHERRY, 0, forkY, 0, endX, endY, endZ);

    const radiusX = randomBetween(random, 2.6, 3.3) * canopyScale;
    const radiusZ = randomBetween(random, 2.6, 3.3) * canopyScale;
    fillLeafEllipsoid(writer, BLOSSOM_LEAF_PAINT, endX, endY, endZ, radiusX, 1.6 * canopyScale, radiusZ, random, 0.2);
    placeLeafRimDroop(writer, BLOSSOM_LEAF_PAINT, endX, endY - 1, endZ, radiusX * 0.95, radiusZ * 0.95, random, 0.4);
  }
}

export const CHERRY_SPECIES: TreeSpecies = { name: "cherry", footprintRadius: 7, maxHeight: 12, build: buildCherry };
