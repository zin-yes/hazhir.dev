// Mirrors NoiseBasedChunkGenerator.doFill for one chunk with Aquifer.createDisabled(fluidPicker): a block is the
// default block where the final density is positive, otherwise the fluid picker's fluid at that y, else air.
// Ore veins (the second material rule) are a later stage.

import type { NoiseRouter } from "../density/router-wiring";
import { NoiseChunk } from "./noise-chunk";

export const BLOCK_AIR = 0;
export const BLOCK_DEFAULT_BLOCK = 1;
export const BLOCK_DEFAULT_FLUID = 2;
/** NoiseBasedChunkGenerator.createFluidPicker: lava fills open space below y = min(-54, seaLevel). */
export const BLOCK_LAVA = 3;

const LAVA_LEVEL = -54;

export interface FillChunkColumnParams {
  router: NoiseRouter;
  chunkX: number;
  chunkZ: number;
  minY: number;
  height: number;
  seaLevel: number;
}

/** Aquifer.FluidStatus.at(y) for the global fluid picker: `y < level ? fluid : air`. */
function fluidAt(blockY: number, seaLevel: number): number {
  if (blockY < Math.min(LAVA_LEVEL, seaLevel)) return BLOCK_LAVA;
  return blockY < seaLevel ? BLOCK_DEFAULT_FLUID : BLOCK_AIR;
}

/** Returns block ids indexed (y - minY) * 256 + localZ * 16 + localX. */
export function fillChunkColumn(params: FillChunkColumnParams): Uint8Array {
  const { router, chunkX, chunkZ, minY, height, seaLevel } = params;
  const chunkMinBlockX = chunkX * 16;
  const chunkMinBlockZ = chunkZ * 16;
  const noiseChunk = new NoiseChunk(router, {
    cellCountXZ: 4,
    firstBlockX: chunkMinBlockX,
    firstBlockZ: chunkMinBlockZ,
    minY,
    height,
    wiredRouterFields: ["finalDensity"],
  });
  const density = noiseChunk.finalDensityForFill;
  const cellWidth = noiseChunk.cellWidth;
  const cellHeight = noiseChunk.cellHeight;
  const cellsPerChunkSide = 16 / cellWidth;
  const minCellY = Math.floor(minY / cellHeight);
  const cellCountY = Math.floor(height / cellHeight);
  const blocks = new Uint8Array(height * 256);

  noiseChunk.initializeForFirstCellX();
  for (let cellX = 0; cellX < cellsPerChunkSide; cellX++) {
    noiseChunk.advanceCellX(cellX);
    for (let cellZ = 0; cellZ < cellsPerChunkSide; cellZ++) {
      for (let cellY = cellCountY - 1; cellY >= 0; cellY--) {
        noiseChunk.selectCellYZ(cellY, cellZ);
        for (let yInCell = cellHeight - 1; yInCell >= 0; yInCell--) {
          const blockY = (minCellY + cellY) * cellHeight + yInCell;
          noiseChunk.updateForY(blockY, yInCell / cellHeight);
          const rowOffset = (blockY - minY) * 256;
          for (let xInCell = 0; xInCell < cellWidth; xInCell++) {
            const localX = cellX * cellWidth + xInCell;
            noiseChunk.updateForX(chunkMinBlockX + localX, xInCell / cellWidth);
            for (let zInCell = 0; zInCell < cellWidth; zInCell++) {
              const localZ = cellZ * cellWidth + zInCell;
              noiseChunk.updateForZ(chunkMinBlockZ + localZ, zInCell / cellWidth);
              const densityValue = density.compute(noiseChunk);
              blocks[rowOffset + localZ * 16 + localX] = densityValue > 0 ? BLOCK_DEFAULT_BLOCK : fluidAt(blockY, seaLevel);
            }
          }
        }
      }
    }
    noiseChunk.swapSlices();
  }
  noiseChunk.stopInterpolation();
  return blocks;
}
