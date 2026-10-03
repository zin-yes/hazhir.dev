/**
 * Mangrove: four to six aerial prop roots fan diagonally from the lower trunk down into the water or
 * mud (to dy -2), a short trunk and a round dense canopy with a heavier skirt below it.
 */
import { BlockType } from "@/applications/game/blocks";
import {
  canopyScaleFor,
  createSolidLeafPaint,
  fillLeafEllipsoid,
  placeLogLine,
  randomBetween,
  randomIntegerInclusive,
  rollScaledHeight,
} from "./tree-geometry";
import type { TreeBlockWriter, TreeBuildOptions, TreeSpecies } from "./tree-types";

const MANGROVE_LEAF_PAINT = createSolidLeafPaint(BlockType.LEAVES_MANGROVE);
const ROOT_TIP_DY = -2;

function buildMangrove(writer: TreeBlockWriter, options: TreeBuildOptions): void {
  const { random } = options;
  const canopyScale = canopyScaleFor(options.heightScale);
  const trunkHeight = rollScaledHeight(options, 4, 7, 3);
  const topY = trunkHeight - 1;

  const crookHeight = random() < 0.4 ? randomIntegerInclusive(random, 2, Math.max(2, topY - 1)) : -1;
  const crookStepX = randomIntegerInclusive(random, -1, 1);
  const crookStepZ = randomIntegerInclusive(random, -1, 1);
  let trunkX = 0;
  let trunkZ = 0;
  for (let dy = 0; dy <= topY; dy++) {
    if (dy === crookHeight) {
      trunkX += crookStepX;
      trunkZ += crookStepZ;
    }
    writer.placeLog(trunkX, dy, trunkZ, BlockType.LOG_MANGROVE);
  }

  const rootCount = randomIntegerInclusive(random, 4, 6);
  const startAngle = random() * Math.PI * 2;
  for (let rootIndex = 0; rootIndex < rootCount; rootIndex++) {
    const angle = startAngle + (rootIndex * Math.PI * 2) / rootCount + (random() - 0.5) * 0.5;
    const rootStartDy = randomIntegerInclusive(random, 1, Math.min(3, topY));
    const reach = Math.min(4, rootStartDy + randomIntegerInclusive(random, 1, 2));
    const tipX = Math.round(Math.cos(angle) * reach);
    const tipZ = Math.round(Math.sin(angle) * reach);
    placeLogLine(writer, BlockType.LOG_MANGROVE, 0, rootStartDy, 0, tipX, ROOT_TIP_DY, tipZ);
  }

  const crownRadius = randomBetween(random, 3.0, 3.5) * canopyScale;
  fillLeafEllipsoid(writer, MANGROVE_LEAF_PAINT, trunkX, topY, trunkZ, crownRadius, randomBetween(random, 2.3, 2.8) * canopyScale, crownRadius, random, 0.15);
  fillLeafEllipsoid(writer, MANGROVE_LEAF_PAINT, trunkX + randomIntegerInclusive(random, -1, 1), topY - 1, trunkZ + randomIntegerInclusive(random, -1, 1), crownRadius + 0.7 * canopyScale, 1.3 * canopyScale, crownRadius + 0.7 * canopyScale, random, 0.25);
}

export const MANGROVE_SPECIES: TreeSpecies = { name: "mangrove", footprintRadius: 7, maxHeight: 13, build: buildMangrove };
