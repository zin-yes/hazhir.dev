import { generateChunkBlocks } from "../worldgen/chunk-generator";

export { createSurfaceHeightSampler } from "../worldgen/surface-height";

export function generateChunk(
  seed: number,
  chunkX: number,
  chunkY: number,
  chunkZ: number
): ArrayBuffer {
  return generateChunkBlocks(seed, chunkX, chunkY, chunkZ).buffer as ArrayBuffer;
}
