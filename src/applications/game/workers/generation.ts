import { BlockType } from "../blocks";
import { generateChunkBlocks } from "../worldgen/chunk-generator";
import { uniformByteValue } from "../world/uniform-bytes";

export { createSurfaceHeightSampler } from "../worldgen/surface-height";

const MAX_SURFACE_PROBES = 16;

export function generateChunk(
  seed: number,
  chunkX: number,
  chunkY: number,
  chunkZ: number
): ArrayBuffer {
  return generateChunkBlocks(seed, chunkX, chunkY, chunkZ).buffer as ArrayBuffer;
}

export interface GeneratedColumnChunk {
  chunkY: number;
  /** The blocks, or null when every block is uniformBlock. */
  blocks: ArrayBuffer | null;
  /** The block every cell holds, or -1 for a mixed chunk. */
  uniformBlock: number;
}

export interface GeneratedColumn {
  chunks: GeneratedColumnChunk[];
  /** Chunk y of the highest chunk holding anything but air, or null when the column has none. */
  surfaceChunkY: number | null;
}

function isAirChunk(seed: number, chunkX: number, chunkY: number, chunkZ: number): boolean {
  return uniformByteValue(generateChunkBlocks(seed, chunkX, chunkY, chunkZ)) === BlockType.AIR;
}

/**
 * Several vertical chunks of one column in one call: the generator builds the whole column once and copies each
 * chunk out of its cache, so asking for the chunks together costs about as much as asking for one.
 */
export function generateChunkColumn(
  seed: number,
  chunkX: number,
  chunkZ: number,
  chunkYs: ArrayLike<number>,
): GeneratedColumn {
  const chunks: GeneratedColumnChunk[] = [];
  let highestRequestedY = Number.NEGATIVE_INFINITY;
  let lowestRequestedY = Number.POSITIVE_INFINITY;
  let highestSolidRequestedY: number | null = null;
  for (let position = 0; position < chunkYs.length; position++) {
    const chunkY = chunkYs[position]!;
    const blocks = generateChunkBlocks(seed, chunkX, chunkY, chunkZ);
    const uniformBlock = uniformByteValue(blocks);
    chunks.push({ chunkY, blocks: uniformBlock >= 0 ? null : (blocks.buffer as ArrayBuffer), uniformBlock });
    highestRequestedY = Math.max(highestRequestedY, chunkY);
    lowestRequestedY = Math.min(lowestRequestedY, chunkY);
    if (uniformBlock !== BlockType.AIR) {
      highestSolidRequestedY = Math.max(highestSolidRequestedY ?? chunkY, chunkY);
    }
  }
  return { chunks, surfaceChunkY: findSurfaceChunkY(seed, chunkX, chunkZ, highestRequestedY, lowestRequestedY, highestSolidRequestedY) };
}

function findSurfaceChunkY(
  seed: number,
  chunkX: number,
  chunkZ: number,
  highestRequestedY: number,
  lowestRequestedY: number,
  highestSolidRequestedY: number | null,
): number | null {
  if (chunkYsAreEmpty(highestRequestedY)) return null;
  if (highestSolidRequestedY === highestRequestedY) {
    let surfaceChunkY = highestRequestedY;
    for (let probe = 1; probe <= MAX_SURFACE_PROBES; probe++) {
      if (isAirChunk(seed, chunkX, highestRequestedY + probe, chunkZ)) break;
      surfaceChunkY = highestRequestedY + probe;
    }
    return surfaceChunkY;
  }
  if (highestSolidRequestedY !== null) return highestSolidRequestedY;
  for (let probe = 1; probe <= MAX_SURFACE_PROBES; probe++) {
    if (!isAirChunk(seed, chunkX, lowestRequestedY - probe, chunkZ)) return lowestRequestedY - probe;
  }
  return null;
}

function chunkYsAreEmpty(highestRequestedY: number): boolean {
  return highestRequestedY === Number.NEGATIVE_INFINITY;
}

export function listColumnTransferables(column: GeneratedColumn): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = [];
  for (const chunk of column.chunks) if (chunk.blocks) buffers.push(chunk.blocks);
  return buffers;
}
