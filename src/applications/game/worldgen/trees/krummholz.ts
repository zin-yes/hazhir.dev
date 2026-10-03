/**
 * Krummholz: a wind-stunted treeline tree. A short crooked trunk bends downwind and carries a wide,
 * flat, one-sided crown.
 */
import { BlockType } from "@/applications/game/blocks";
import {
  COMPASS_STEP_X,
  COMPASS_STEP_Z,
  canopyScaleFor,
  createSolidLeafPaint,
  placeLeafAt,
  placeGroundPatch,
  placeLeafDisc,
  randomBetween,
  randomIntegerInclusive,
  rollScaledHeight,
} from "./tree-geometry";
import type { TreeBlockWriter, TreeBuildOptions, TreeSpecies } from "./tree-types";

const KRUMMHOLZ_LEAF_PAINT = createSolidLeafPaint(BlockType.LEAVES_SPRUCE);

function buildKrummholz(writer: TreeBlockWriter, options: TreeBuildOptions): void {
  const { random } = options;
  const canopyScale = canopyScaleFor(options.heightScale);
  const trunkHeight = rollScaledHeight(options, 2, 4, 2);
  const windDirection = randomIntegerInclusive(random, 0, 7);
  const windX = COMPASS_STEP_X[windDirection];
  const windZ = COMPASS_STEP_Z[windDirection];

  let trunkX = 0;
  let trunkZ = 0;
  for (let dy = 0; dy < trunkHeight; dy++) {
    if (dy > 0 && random() < 0.5) {
      trunkX += windX;
      trunkZ += windZ;
    }
    writer.placeLog(trunkX, dy, trunkZ, BlockType.LOG_SPRUCE);
  }
  const topY = trunkHeight - 1;

  const crownCenterX = trunkX + windX;
  const crownCenterZ = trunkZ + windZ;
  const radiusAlongWind = randomBetween(random, 2.6, 3.6) * canopyScale;
  const radiusAcrossWind = randomBetween(random, 1.8, 2.6) * canopyScale;
  const stretchesAlongX = windX !== 0;
  const radiusX = stretchesAlongX ? radiusAlongWind : radiusAcrossWind;
  const radiusZ = stretchesAlongX ? radiusAcrossWind : radiusAlongWind;
  placeLeafDisc(writer, KRUMMHOLZ_LEAF_PAINT, crownCenterX, topY, crownCenterZ, radiusX, radiusZ, random, 0.3);
  placeLeafAt(writer, KRUMMHOLZ_LEAF_PAINT, trunkX, topY + 1, trunkZ);
  placeLeafDisc(writer, KRUMMHOLZ_LEAF_PAINT, crownCenterX, topY + 1, crownCenterZ, radiusX * 0.6, radiusZ * 0.6, random, 0.3);
  if (topY >= 1 && random() < 0.7) {
    placeLeafDisc(writer, KRUMMHOLZ_LEAF_PAINT, crownCenterX + windX, topY - 1, crownCenterZ + windZ, radiusX * 0.55, radiusZ * 0.55, random, 0.3);
  }

  if (random() < 0.5) placeGroundPatch(writer, BlockType.COARSE_DIRT, 0, 0, 1.6, random);
}

export const KRUMMHOLZ_SPECIES: TreeSpecies = { name: "krummholz", footprintRadius: 10, maxHeight: 7, build: buildKrummholz };
