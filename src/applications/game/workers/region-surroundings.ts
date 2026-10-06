// Lit chunks around a lighting region, sent to the worker as only the layers the region's flood can read.
//
// lightChunkRegion reads a surrounding chunk in two ways: the layer touching the region (seeding, and the light
// of the chunk above a column), and every cell the flood brightens inside it plus their neighbors. Light crossing
// into a chunk beside or above the region holds at most 14 and drops one level per step, and a cell is queued
// only while it holds 2 or more, so nothing deeper than 14 layers from the touching face is read or written.
// Full sky light (15) is the one value that keeps its level, and only going down, so a chunk below the region
// can be lit all the way through and is sent whole. Cells outside a slab are rebuilt as stone with no light,
// which the flood would never enter anyway.

import { BlockType } from "../blocks";
import {
  CELLS_PER_CHUNK,
  CHUNK_MASK,
  NEGATIVE_X,
  NEGATIVE_Y,
  NEGATIVE_Z,
  POSITIVE_X,
  POSITIVE_Z,
  X_STRIDE,
  Y_STRIDE,
} from "../edits/chunk-cluster";
import {
  addWorkerCounter,
  endWorkerSection,
  startWorkerSampledSection,
  startWorkerSection,
} from "../profiler/worker-recorder";
import { uniformByteValue } from "../world/uniform-bytes";
import {
  createSurroundingsSource,
  lightChunkRegion,
  type LitSurroundingChunk,
  type RegionChunk,
  type RegionLightResult,
} from "./region-lighting";

const CHUNK_SIZE = CHUNK_MASK + 1;

/** Deepest layer count, from the touching face, that a region's flood can read in a chunk beside or above it. */
export const SURROUNDING_SLAB_DEPTH = 14;

export const SLAB_AXIS_X = 0;
export const SLAB_AXIS_Y = 1;
export const SLAB_AXIS_Z = 2;

export interface SlabExtent {
  axis: number;
  firstLayer: number;
  layerCount: number;
}

/** A surrounding chunk's readable layers. A uniform part is sent as its value with no array. */
export interface SurroundingSlab extends SlabExtent {
  chunkX: number;
  chunkY: number;
  chunkZ: number;
  blocks: Uint8Array | null;
  uniformBlock: number;
  light: Uint8Array | null;
  uniformLight: number;
}

const WHOLE_CHUNK: SlabExtent = { axis: SLAB_AXIS_X, firstLayer: 0, layerCount: CHUNK_SIZE };
const DEEPEST_FIRST_LAYER = CHUNK_SIZE - SURROUNDING_SLAB_DEPTH;
const SLAB_REBUILD_SAMPLE_INTERVAL = 8;

/**
 * The layers of a surrounding chunk to send, given a bit per direction (chunk-cluster order, seen from the
 * surrounding chunk) in which a region chunk touches it.
 */
export function slabExtentForTouchingDirections(touchingDirections: number): SlabExtent {
  switch (touchingDirections) {
    case 1 << POSITIVE_X:
      return { axis: SLAB_AXIS_X, firstLayer: DEEPEST_FIRST_LAYER, layerCount: SURROUNDING_SLAB_DEPTH };
    case 1 << NEGATIVE_X:
      return { axis: SLAB_AXIS_X, firstLayer: 0, layerCount: SURROUNDING_SLAB_DEPTH };
    case 1 << NEGATIVE_Y:
      return { axis: SLAB_AXIS_Y, firstLayer: 0, layerCount: SURROUNDING_SLAB_DEPTH };
    case 1 << POSITIVE_Z:
      return { axis: SLAB_AXIS_Z, firstLayer: DEEPEST_FIRST_LAYER, layerCount: SURROUNDING_SLAB_DEPTH };
    case 1 << NEGATIVE_Z:
      return { axis: SLAB_AXIS_Z, firstLayer: 0, layerCount: SURROUNDING_SLAB_DEPTH };
    default:
      return WHOLE_CHUNK;
  }
}

export function slabCellCount(extent: SlabExtent): number {
  return extent.layerCount * CHUNK_SIZE * CHUNK_SIZE;
}

/**
 * Visits the slab as contiguous runs of chunk indices, in chunk index order, so packing and unpacking agree.
 * Arguments: offset of the run in the chunk, its length.
 */
function forEachSlabRun(extent: SlabExtent, visitRun: (chunkOffset: number, runLength: number) => void): void {
  const { axis, firstLayer, layerCount } = extent;
  if (axis === SLAB_AXIS_X) {
    visitRun(firstLayer * X_STRIDE, layerCount * X_STRIDE);
    return;
  }
  if (axis === SLAB_AXIS_Y) {
    for (let x = 0; x < CHUNK_SIZE; x++) visitRun(x * X_STRIDE + firstLayer * Y_STRIDE, layerCount * Y_STRIDE);
    return;
  }
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let y = 0; y < CHUNK_SIZE; y++) visitRun(x * X_STRIDE + y * Y_STRIDE + firstLayer, layerCount);
  }
}

function packSlab(chunk: Uint8Array, extent: SlabExtent): Uint8Array {
  if (extent.layerCount === CHUNK_SIZE) return chunk.slice();
  const packed = new Uint8Array(slabCellCount(extent));
  let packedOffset = 0;
  forEachSlabRun(extent, (chunkOffset, runLength) => {
    for (let position = 0; position < runLength; position++) {
      packed[packedOffset + position] = chunk[chunkOffset + position]!;
    }
    packedOffset += runLength;
  });
  return packed;
}

function unpackSlab(packed: Uint8Array | null, uniformValue: number, extent: SlabExtent, into: Uint8Array): void {
  let packedOffset = 0;
  forEachSlabRun(extent, (chunkOffset, runLength) => {
    if (packed) into.set(packed.subarray(packedOffset, packedOffset + runLength), chunkOffset);
    else into.fill(uniformValue, chunkOffset, chunkOffset + runLength);
    packedOffset += runLength;
  });
}

/**
 * Copies the readable layers of a lit chunk. knownUniformBlock (or -1) skips the block copy when the caller
 * already knows every block is the same.
 */
export function extractSurroundingSlab(
  chunkX: number,
  chunkY: number,
  chunkZ: number,
  blocks: Uint8Array,
  light: Uint8Array,
  knownUniformBlock: number,
  extent: SlabExtent,
): SurroundingSlab {
  let packedBlocks: Uint8Array | null = null;
  let uniformBlock = knownUniformBlock;
  if (uniformBlock < 0) {
    packedBlocks = packSlab(blocks, extent);
    uniformBlock = uniformByteValue(packedBlocks);
    if (uniformBlock >= 0) packedBlocks = null;
  }
  let packedLight: Uint8Array | null = packSlab(light, extent);
  const uniformLight = uniformByteValue(packedLight);
  if (uniformLight >= 0) packedLight = null;
  return {
    chunkX,
    chunkY,
    chunkZ,
    axis: extent.axis,
    firstLayer: extent.firstLayer,
    layerCount: extent.layerCount,
    blocks: packedBlocks,
    uniformBlock,
    light: packedLight,
    uniformLight,
  };
}

/** A full-size chunk from a slab: the slab's cells, stone with no light everywhere else. */
export function rebuildSurroundingChunk(slab: SurroundingSlab): LitSurroundingChunk {
  const isWholeChunk = slab.layerCount === CHUNK_SIZE;
  startWorkerSampledSection("allocateSlabChunk", SLAB_REBUILD_SAMPLE_INTERVAL);
  const blocks = new Uint8Array(CELLS_PER_CHUNK);
  const light = new Uint8Array(CELLS_PER_CHUNK);
  if (!isWholeChunk) blocks.fill(BlockType.STONE);
  endWorkerSection();
  startWorkerSampledSection("unpackSlabBlocks", SLAB_REBUILD_SAMPLE_INTERVAL);
  unpackSlab(slab.blocks, slab.uniformBlock, slab, blocks);
  endWorkerSection();
  startWorkerSampledSection("unpackSlabLight", SLAB_REBUILD_SAMPLE_INTERVAL);
  unpackSlab(slab.light, slab.uniformLight, slab, light);
  endWorkerSection();
  return { chunkX: slab.chunkX, chunkY: slab.chunkY, chunkZ: slab.chunkZ, blocks, light };
}

/** Arrays of a slab list for a postMessage transfer list. */
export function listSlabTransferables(slabs: ArrayLike<SurroundingSlab>): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = [];
  for (let position = 0; position < slabs.length; position++) {
    const slab = slabs[position]!;
    if (slab.blocks) buffers.push(slab.blocks.buffer as ArrayBuffer);
    if (slab.light) buffers.push(slab.light.buffer as ArrayBuffer);
  }
  return buffers;
}

export interface LitChunkView {
  blocks: Uint8Array;
  light: Uint8Array;
  /** The block every cell holds, or -1 for a mixed or unknown chunk. */
  uniformBlock: number;
}

export interface ChunkPosition {
  chunkX: number;
  chunkY: number;
  chunkZ: number;
}

const DIRECTION_STEPS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const OPPOSITE_DIRECTION = [1, 0, 3, 2, 5, 4];

/**
 * The slabs of every lit chunk touching the region (and not part of it), each cut to the layers the region's
 * flood can read. getLitChunk returns undefined for chunks that are absent or not lit yet.
 */
export function collectSurroundingSlabs(
  region: ArrayLike<ChunkPosition>,
  getLitChunk: (chunkX: number, chunkY: number, chunkZ: number) => LitChunkView | undefined,
): SurroundingSlab[] {
  const regionNames = new Set<string>();
  for (let position = 0; position < region.length; position++) {
    const { chunkX, chunkY, chunkZ } = region[position]!;
    regionNames.add(`${chunkX},${chunkY},${chunkZ}`);
  }
  const touchesByName = new Map<string, ChunkPosition & { touchingDirections: number }>();
  for (let position = 0; position < region.length; position++) {
    const { chunkX, chunkY, chunkZ } = region[position]!;
    for (let direction = 0; direction < DIRECTION_STEPS.length; direction++) {
      const [stepX, stepY, stepZ] = DIRECTION_STEPS[direction]!;
      const neighborX = chunkX + stepX;
      const neighborY = chunkY + stepY;
      const neighborZ = chunkZ + stepZ;
      const neighborName = `${neighborX},${neighborY},${neighborZ}`;
      if (regionNames.has(neighborName)) continue;
      const directionTowardRegion = 1 << OPPOSITE_DIRECTION[direction]!;
      const existing = touchesByName.get(neighborName);
      if (existing) existing.touchingDirections |= directionTowardRegion;
      else
        touchesByName.set(neighborName, {
          chunkX: neighborX,
          chunkY: neighborY,
          chunkZ: neighborZ,
          touchingDirections: directionTowardRegion,
        });
    }
  }
  const slabs: SurroundingSlab[] = [];
  for (const { chunkX, chunkY, chunkZ, touchingDirections } of touchesByName.values()) {
    const litChunk = getLitChunk(chunkX, chunkY, chunkZ);
    if (!litChunk) continue;
    slabs.push(
      extractSurroundingSlab(
        chunkX,
        chunkY,
        chunkZ,
        litChunk.blocks,
        litChunk.light,
        litChunk.uniformBlock,
        slabExtentForTouchingDirections(touchingDirections),
      ),
    );
  }
  return slabs;
}

/** A chunk of the region itself; a uniform chunk is sent as its block with no array. */
export interface RegionChunkInput {
  chunkX: number;
  chunkY: number;
  chunkZ: number;
  blocks: Uint8Array | null;
  uniformBlock: number;
}

/** Worker side of a region light request: rebuilds the inputs and lights the region. */
export function lightRegionFromSlabs(
  regionChunks: ArrayLike<RegionChunkInput>,
  slabs: ArrayLike<SurroundingSlab>,
): RegionLightResult {
  const chunks: RegionChunk[] = [];
  let uniformRegionChunks = 0;
  startWorkerSection("rebuildRegionChunks");
  for (let position = 0; position < regionChunks.length; position++) {
    const { chunkX, chunkY, chunkZ, blocks, uniformBlock } = regionChunks[position]!;
    if (!blocks) uniformRegionChunks++;
    chunks.push({ chunkX, chunkY, chunkZ, blocks: blocks ?? new Uint8Array(CELLS_PER_CHUNK).fill(uniformBlock) });
  }
  endWorkerSection();
  const surroundingChunks: LitSurroundingChunk[] = [];
  startWorkerSection("rebuildSurroundings");
  for (let position = 0; position < slabs.length; position++) {
    surroundingChunks.push(rebuildSurroundingChunk(slabs[position]!));
  }
  endWorkerSection();
  recordSlabInputCounters(regionChunks.length, uniformRegionChunks, slabs);
  return lightChunkRegion(
    chunks,
    surroundingChunks.length > 0 ? createSurroundingsSource(surroundingChunks) : undefined,
  );
}

function recordSlabInputCounters(
  regionChunkCount: number,
  uniformRegionChunkCount: number,
  slabs: ArrayLike<SurroundingSlab>,
) {
  let wholeChunkSlabs = 0;
  let uniformBlockSlabs = 0;
  let uniformLightSlabs = 0;
  let blockBytesReceived = 0;
  let lightBytesReceived = 0;
  let cellsUnpacked = 0;
  for (let position = 0; position < slabs.length; position++) {
    const slab = slabs[position]!;
    if (slab.layerCount === CHUNK_SIZE) wholeChunkSlabs++;
    if (!slab.blocks) uniformBlockSlabs++;
    if (!slab.light) uniformLightSlabs++;
    blockBytesReceived += slab.blocks?.byteLength ?? 0;
    lightBytesReceived += slab.light?.byteLength ?? 0;
    cellsUnpacked += slabCellCount(slab);
  }
  addWorkerCounter("regionInputChunks", regionChunkCount);
  addWorkerCounter("regionInputUniformChunks", uniformRegionChunkCount);
  addWorkerCounter("regionInputFilledBytes", uniformRegionChunkCount * CELLS_PER_CHUNK);
  addWorkerCounter("slabsReceived", slabs.length);
  addWorkerCounter("slabsWholeChunk", wholeChunkSlabs);
  addWorkerCounter("slabsPartial", slabs.length - wholeChunkSlabs);
  addWorkerCounter("slabsUniformBlocks", uniformBlockSlabs);
  addWorkerCounter("slabsUniformLight", uniformLightSlabs);
  addWorkerCounter("slabBlockBytesReceived", blockBytesReceived);
  addWorkerCounter("slabLightBytesReceived", lightBytesReceived);
  addWorkerCounter("slabCellsUnpacked", cellsUnpacked);
  addWorkerCounter("slabRebuiltChunkBytes", slabs.length * CELLS_PER_CHUNK * 2);
}
