/**
 * Birch: slim pale trunk with a narrow oval canopy that starts about two thirds up the trunk.
 * Honours options.leafVariant for autumn colouring.
 */
import { BlockType } from "@/applications/game/blocks";
import {
  canopyScaleFor,
  createLeafPaint,
  fillLeafEllipsoid,
  placeLogLine,
  randomBetween,
  randomIntegerInclusive,
  rollScaledHeight,
} from "./tree-geometry";
import type { TreeBlockWriter, TreeBuildOptions, TreeSpecies } from "./tree-types";

function buildBirch(writer: TreeBlockWriter, options: TreeBuildOptions): void {
  const { random } = options;
  const paint = createLeafPaint(BlockType.LEAVES_BIRCH, options);
  const canopyScale = canopyScaleFor(options.heightScale);
  const trunkHeight = rollScaledHeight(options, 7, 11, 4);
  const topY = trunkHeight - 1;

  const shiftHeight = random() < 0.35 ? randomIntegerInclusive(random, 2, Math.max(2, topY - 2)) : -1;
  const shiftX = randomIntegerInclusive(random, -1, 1);
  const shiftZ = shiftX === 0 ? (random() < 0.5 ? -1 : 1) : 0;
  let trunkX = 0;
  let trunkZ = 0;
  for (let dy = 0; dy <= topY; dy++) {
    if (dy === shiftHeight) {
      trunkX += shiftX;
      trunkZ += shiftZ;
    }
    writer.placeLog(trunkX, dy, trunkZ, BlockType.LOG_BIRCH);
  }

  const radiusX = randomBetween(random, 1.9, 2.5) * canopyScale;
  const radiusZ = randomBetween(random, 1.9, 2.5) * canopyScale;
  const radiusY = randomBetween(random, 3.0, 3.6) * canopyScale;
  fillLeafEllipsoid(writer, paint, trunkX, topY - 2, trunkZ, radiusX, radiusY, radiusZ, random, 0.25);
  fillLeafEllipsoid(writer, paint, trunkX, topY + 1, trunkZ, 1.2 * canopyScale, 1.1 * canopyScale, 1.2 * canopyScale, random, 0.1);

  if (random() < 0.6 && topY >= 6) {
    const sideAngle = random() * Math.PI * 2;
    const endX = trunkX + Math.round(Math.cos(sideAngle) * 2);
    const endZ = trunkZ + Math.round(Math.sin(sideAngle) * 2);
    const branchY = topY - randomIntegerInclusive(random, 4, 5);
    placeLogLine(writer, BlockType.LOG_BIRCH, trunkX, branchY, trunkZ, endX, branchY + 1, endZ);
    fillLeafEllipsoid(writer, paint, endX, branchY + 1, endZ, 1.4 * canopyScale, 1.2 * canopyScale, 1.4 * canopyScale, random, 0.3);
  }
}

export const BIRCH_SPECIES: TreeSpecies = { name: "birch", footprintRadius: 5, maxHeight: 17, build: buildBirch };
