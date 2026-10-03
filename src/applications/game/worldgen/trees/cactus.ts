/**
 * Cacti: the saguaro (trunk of 2 to 6 with up to two L-shaped arms) and the short barrel cactus.
 * Cactus blocks are written through placeLog so they replace air but never solid terrain.
 */
import { BlockType } from "@/applications/game/blocks";
import { placeLogColumn, randomIntegerInclusive, rollScaledHeight } from "./tree-geometry";
import type { TreeBlockWriter, TreeBuildOptions, TreeSpecies } from "./tree-types";

const ARM_DIRECTION_X = [1, -1, 0, 0];
const ARM_DIRECTION_Z = [0, 0, 1, -1];

function rollArmCount(random: () => number, trunkHeight: number): number {
  if (trunkHeight < 3) return 0;
  const roll = random();
  if (trunkHeight === 3) return roll < 0.5 ? 0 : 1;
  return roll < 0.25 ? 0 : roll < 0.65 ? 1 : 2;
}

function placeArm(
  writer: TreeBlockWriter,
  random: () => number,
  attachY: number,
  trunkTopY: number,
  direction: number,
): void {
  const stepX = ARM_DIRECTION_X[direction];
  const stepZ = ARM_DIRECTION_Z[direction];
  const horizontalLength = randomIntegerInclusive(random, 1, 2);
  for (let distance = 1; distance <= horizontalLength; distance++) {
    writer.placeLog(stepX * distance, attachY, stepZ * distance, BlockType.CACTUS);
  }
  const climb = Math.min(randomIntegerInclusive(random, 1, 3), Math.max(1, trunkTopY - attachY));
  placeLogColumn(writer, BlockType.CACTUS, stepX * horizontalLength, stepZ * horizontalLength, attachY + 1, attachY + climb);
}

function buildSaguaro(writer: TreeBlockWriter, options: TreeBuildOptions): void {
  const { random } = options;
  const trunkHeight = rollScaledHeight(options, 2, 6, 2);
  const trunkTopY = trunkHeight - 1;
  placeLogColumn(writer, BlockType.CACTUS, 0, 0, 0, trunkTopY);

  const armCount = rollArmCount(random, trunkHeight);
  const firstDirection = randomIntegerInclusive(random, 0, 3);
  for (let armIndex = 0; armIndex < armCount; armIndex++) {
    const direction = armIndex === 0 ? firstDirection : firstDirection ^ 1;
    const attachY = randomIntegerInclusive(random, 1, Math.max(1, trunkTopY - 1));
    placeArm(writer, random, attachY, trunkTopY, direction);
  }
}

function buildBarrelCactus(writer: TreeBlockWriter, options: TreeBuildOptions): void {
  const { random } = options;
  const barrelHeight = options.heightScale >= 0.7 && random() < 0.5 ? 2 : 1;
  placeLogColumn(writer, BlockType.CACTUS, 0, 0, 0, barrelHeight - 1);
  if (random() < 0.4) {
    const direction = randomIntegerInclusive(random, 0, 3);
    writer.placeLog(ARM_DIRECTION_X[direction], 0, ARM_DIRECTION_Z[direction], BlockType.CACTUS);
  }
}

export const SAGUARO_SPECIES: TreeSpecies = { name: "saguaro", footprintRadius: 3, maxHeight: 9, build: buildSaguaro };
export const BARREL_CACTUS_SPECIES: TreeSpecies = { name: "barrel_cactus", footprintRadius: 2, maxHeight: 3, build: buildBarrelCactus };
