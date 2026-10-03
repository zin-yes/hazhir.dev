/**
 * Conifers: the tiered conical spruce and the pine, a very tall bare trunk with a small irregular tuft crown.
 * Both use spruce blocks. Snow cover is the caller's job.
 */
import { BlockType } from "@/applications/game/blocks";
import {
  canopyScaleFor,
  createSolidLeafPaint,
  fillLeafEllipsoid,
  placeGroundPatch,
  placeLeafAt,
  placeLeafCone,
  placeLogColumn,
  placeLogLine,
  randomBetween,
  randomIntegerInclusive,
  rollScaledHeight,
} from "./tree-geometry";
import type { TreeBlockWriter, TreeBuildOptions, TreeSpecies } from "./tree-types";

const SPRUCE_LEAF_PAINT = createSolidLeafPaint(BlockType.LEAVES_SPRUCE);

function buildSpruce(writer: TreeBlockWriter, options: TreeBuildOptions): void {
  const { random, heightScale } = options;
  const trunkHeight = rollScaledHeight(options, 10, 18, 5);
  const topY = trunkHeight - 1;
  placeLogColumn(writer, BlockType.LOG_SPRUCE, 0, 0, 0, topY);

  if (random() < 0.6) placeGroundPatch(writer, BlockType.PODZOL, 0, 0, 2.2, random);

  const bareTrunkHeight = Math.min(topY - 3, randomIntegerInclusive(random, 1, 2) + Math.floor(trunkHeight / 8));
  const maxRadius = (2.2 + trunkHeight * 0.2) * (0.9 + 0.1 * canopyScaleFor(heightScale)) * randomBetween(random, 0.9, 1.1);
  placeLeafCone(
    writer,
    SPRUCE_LEAF_PAINT,
    0,
    0,
    topY + 2,
    bareTrunkHeight,
    maxRadius,
    randomBetween(random, 0.9, 1.1),
    random,
    0.3,
  );
}

function buildPine(writer: TreeBlockWriter, options: TreeBuildOptions): void {
  const { random } = options;
  const canopyScale = canopyScaleFor(options.heightScale);
  const trunkHeight = rollScaledHeight(options, 14, 22, 7);
  const topY = trunkHeight - 1;

  const leanHeight = random() < 0.5 ? randomIntegerInclusive(random, Math.floor(trunkHeight / 2), topY - 2) : -1;
  const leanX = randomIntegerInclusive(random, -1, 1);
  const leanZ = randomIntegerInclusive(random, -1, 1);
  let trunkX = 0;
  let trunkZ = 0;
  for (let dy = 0; dy <= topY; dy++) {
    if (dy === leanHeight) {
      trunkX += leanX;
      trunkZ += leanZ;
    }
    writer.placeLog(trunkX, dy, trunkZ, BlockType.LOG_SPRUCE);
  }

  if (random() < 0.5) placeGroundPatch(writer, BlockType.PODZOL, 0, 0, 1.8, random);

  fillLeafEllipsoid(writer, SPRUCE_LEAF_PAINT, trunkX, topY - 1, trunkZ, randomBetween(random, 2.2, 2.9) * canopyScale, randomBetween(random, 2.4, 3.0) * canopyScale, randomBetween(random, 2.2, 2.9) * canopyScale, random, 0.32);
  placeLeafAt(writer, SPRUCE_LEAF_PAINT, trunkX, topY + 2, trunkZ);

  const tuftCount = randomIntegerInclusive(random, 2, 3);
  const startAngle = random() * Math.PI * 2;
  for (let tuftIndex = 0; tuftIndex < tuftCount; tuftIndex++) {
    const angle = startAngle + (tuftIndex * Math.PI * 2) / tuftCount + (random() - 0.5) * 0.8;
    const branchY = topY - randomIntegerInclusive(random, 5, 8);
    if (branchY < 4) continue;
    const endX = trunkX + Math.round(Math.cos(angle) * 2);
    const endZ = trunkZ + Math.round(Math.sin(angle) * 2);
    placeLogLine(writer, BlockType.LOG_SPRUCE, trunkX, branchY, trunkZ, endX, branchY + 1, endZ);
    fillLeafEllipsoid(writer, SPRUCE_LEAF_PAINT, endX, branchY + 1, endZ, 1.7 * canopyScale, 0.9 * canopyScale, 1.7 * canopyScale, random, 0.3);
  }
}

export const SPRUCE_SPECIES: TreeSpecies = { name: "spruce", footprintRadius: 9, maxHeight: 26, build: buildSpruce };
export const PINE_SPECIES: TreeSpecies = { name: "pine", footprintRadius: 5, maxHeight: 32, build: buildPine };
