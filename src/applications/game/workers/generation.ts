import { generateChunkBlocks } from "../worldgen/chunk-generator";
import { getTerrainModel } from "../worldgen/column-grid";

export function generateChunk(
  seed: number,
  chunkX: number,
  chunkY: number,
  chunkZ: number
): ArrayBuffer {
  return generateChunkBlocks(seed, chunkX, chunkY, chunkZ).buffer as ArrayBuffer;
}

/** Height of the highest solid ground, ignoring trees and water. */
export function createSurfaceHeightSampler(seed: number): (x: number, z: number) => number {
  const terrain = getTerrainModel(seed);
  return (x, z) => terrain.sample(x, z).height;
}
