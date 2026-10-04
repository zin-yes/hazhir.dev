// Port of the shared half of WorldCarver (Minecraft 1.20.6): carveEllipsoid, carveBlock, getCarveState, canReach.
// Positions are chunk-local for blocks and world coordinates for carver centres, as in Java.

import { BLOCK_AIR, BLOCK_LAVA } from "../terrain/terrain-blocks";
import type { CarverBaseConfig } from "./carver-config";
import type { CarvingContext } from "./carving-context";

const fround = Math.fround;

/** WorldCarver.CarveSkipChecker: true to leave the block alone (relative offsets are in ellipsoid radii). */
export type CarveSkipChecker = (relativeX: number, relativeY: number, relativeZ: number, blockY: number) => boolean;

/** WorldCarver.getRange(): carvers reach 4 chunks, so the source neighbourhood is 17 x 17. */
export const CARVER_RANGE_IN_CHUNKS = 4;

/** WorldCarver.canReach: can a tunnel at (x, z) still get close enough to the chunk. */
export function canReach(chunkMinBlockX: number, chunkMinBlockZ: number, x: number, z: number, step: number, maxSteps: number, thickness: number): boolean {
  const middleX = chunkMinBlockX + 8;
  const middleZ = chunkMinBlockZ + 8;
  const deltaX = x - middleX;
  const deltaZ = z - middleZ;
  const stepsLeft = maxSteps - step;
  const reach = fround(fround(thickness + 2) + 16);
  return deltaX * deltaX + deltaZ * deltaZ - stepsLeft * stepsLeft <= reach * reach;
}

/** WorldCarver.carveEllipsoid. Returns whether any block was carved. */
export function carveEllipsoid(
  context: CarvingContext,
  config: CarverBaseConfig,
  x: number,
  y: number,
  z: number,
  horizontalRadius: number,
  verticalRadius: number,
  shouldSkip: CarveSkipChecker,
): boolean {
  const chunkMinBlockX = context.chunkMinBlockX;
  const chunkMinBlockZ = context.chunkMinBlockZ;
  const maxDistance = 16 + horizontalRadius * 2;
  if (Math.abs(x - (chunkMinBlockX + 8)) > maxDistance || Math.abs(z - (chunkMinBlockZ + 8)) > maxDistance) return false;
  const minLocalX = Math.max(Math.floor(x - horizontalRadius) - chunkMinBlockX - 1, 0);
  const maxLocalX = Math.min(Math.floor(x + horizontalRadius) - chunkMinBlockX, 15);
  const minBlockY = Math.max(Math.floor(y - verticalRadius) - 1, context.minGenY + 1);
  const topProtectedLayers = 7;
  const maxBlockY = Math.min(Math.floor(y + verticalRadius) + 1, context.minGenY + context.genDepth - 1 - topProtectedLayers);
  const minLocalZ = Math.max(Math.floor(z - horizontalRadius) - chunkMinBlockZ - 1, 0);
  const maxLocalZ = Math.min(Math.floor(z + horizontalRadius) - chunkMinBlockZ, 15);
  const lavaLevel = config.lavaLevel(context);
  context.ellipsoidsCarved++;
  let carvedAny = false;
  for (let localX = minLocalX; localX <= maxLocalX; localX++) {
    const relativeX = (chunkMinBlockX + localX + 0.5 - x) / horizontalRadius;
    for (let localZ = minLocalZ; localZ <= maxLocalZ; localZ++) {
      const relativeZ = (chunkMinBlockZ + localZ + 0.5 - z) / horizontalRadius;
      if (relativeX * relativeX + relativeZ * relativeZ >= 1) continue;
      context.reachedSurface = false;
      if (maxBlockY > minBlockY) context.blocksTested += maxBlockY - minBlockY;
      for (let blockY = maxBlockY; blockY > minBlockY; blockY--) {
        const relativeY = (blockY - 0.5 - y) / verticalRadius;
        if (shouldSkip(relativeX, relativeY, relativeZ, blockY)) continue;
        const maskIndex = (blockY - context.minGenY) * 256 + localZ * 16 + localX;
        if (context.mask[maskIndex] !== 0) continue;
        context.mask[maskIndex] = 1;
        if (carveBlock(context, config, lavaLevel, localX, blockY, localZ)) {
          carvedAny = true;
          context.blocksRemoved++;
        }
      }
    }
  }
  return carvedAny;
}

/** WorldCarver.carveBlock (+ getCarveState): replaces one replaceable block with air, fluid or lava. */
function carveBlock(context: CarvingContext, config: CarverBaseConfig, lavaLevel: number, localX: number, blockY: number, localZ: number): boolean {
  const blocks = context.chunk.blocks;
  const index = (blockY - context.minGenY) * 256 + localZ * 16 + localX;
  const currentId = blocks[index]!;
  if (context.isGrassOrMycelium(currentId)) context.reachedSurface = true;
  if (!context.isReplaceable(config, currentId)) return false;

  const blockX = context.chunkMinBlockX + localX;
  const blockZ = context.chunkMinBlockZ + localZ;
  let carveSymbol: number;
  if (blockY <= lavaLevel) {
    carveSymbol = BLOCK_LAVA;
  } else {
    const point = context.point;
    point.blockX = blockX;
    point.blockY = blockY;
    point.blockZ = blockZ;
    carveSymbol = context.aquifer.computeSubstance(point, 0);
    if (carveSymbol < 0) return false;
  }
  blocks[index] = context.paletteIdOfSymbol(carveSymbol);

  if (context.reachedSurface && context.topMaterial !== undefined) {
    const belowIndex = index - 256;
    if (context.isDirt(blocks[belowIndex]!)) {
      const hasFluid = carveSymbol !== BLOCK_AIR;
      const material = context.topMaterial.topMaterial(blockX, blockY - 1, blockZ, hasFluid);
      if (material !== undefined) blocks[belowIndex] = context.chunk.palette.idOf(material);
    }
  }
  return true;
}
