import { TRANSPARENT_BLOCKS, getBlockLightLevel } from "./blocks";
import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "./config";

/**
 * Incremental light updates for a single block edit.
 *
 * Light is stored per block as (sky << 4) | block. Both channels are the closure
 * of a flood fill: light loses one level per step through transparent blocks,
 * except full sky light (15) which falls straight down without losing any. An
 * edit only disturbs the cells whose light flowed through (or came from) the
 * edited block, so it removes exactly those, then refills from whatever light is
 * left around the hole. That is a few thousand cells at most, instead of
 * recomputing every chunk within reach.
 */

const CHUNK_SHIFT = 5;
const CHUNK_MASK = (1 << CHUNK_SHIFT) - 1;
if (
  CHUNK_WIDTH !== 1 << CHUNK_SHIFT ||
  CHUNK_HEIGHT !== 1 << CHUNK_SHIFT ||
  CHUNK_LENGTH !== 1 << CHUNK_SHIFT
) {
  throw new Error("light-engine assumes 32 x 32 x 32 chunks");
}

const SKY_CHANNEL = 0;
const BLOCK_CHANNEL = 1;
const MAX_LIGHT = 15;

const NEIGHBOR_DX = [1, -1, 0, 0, 0, 0];
const NEIGHBOR_DY = [0, 0, 1, -1, 0, 0];
const NEIGHBOR_DZ = [0, 0, 0, 0, 1, -1];
const DOWN_DIRECTION = 3;

const IS_TRANSPARENT = new Uint8Array(256);
const EMISSION = new Uint8Array(256);
for (let block = 0; block < 256; block++) {
  IS_TRANSPARENT[block] = TRANSPARENT_BLOCKS.includes(block) ? 1 : 0;
  EMISSION[block] = getBlockLightLevel(block);
}

export interface LightChunkSource {
  getBlocks(
    chunkX: number,
    chunkY: number,
    chunkZ: number,
  ): Uint8Array | undefined;
  getLight(
    chunkX: number,
    chunkY: number,
    chunkZ: number,
  ): Uint8Array | undefined;
}

export interface ChunkCoordinate {
  x: number;
  y: number;
  z: number;
}

export interface RelightStats {
  cellsRemoved: number;
  cellsLit: number;
  cellsVisited: number;
}

export interface RelightResult {
  /**
   * Chunks whose mesh has to be rebuilt: the chunk holding the edit and every
   * chunk that has a changed light value in it or in the layer next to it.
   */
  chunksToRemesh: ChunkCoordinate[];
  stats: RelightStats;
}

interface LoadedChunk {
  chunkX: number;
  chunkY: number;
  chunkZ: number;
  blocks: Uint8Array;
  light: Uint8Array;
}

function chunkKey(chunkX: number, chunkY: number, chunkZ: number): number {
  return ((chunkX + 4096) * 8192 + (chunkY + 4096)) * 8192 + (chunkZ + 4096);
}

function cellIndex(localX: number, localY: number, localZ: number): number {
  return (localX << (CHUNK_SHIFT * 2)) | (localY << CHUNK_SHIFT) | localZ;
}

/** Growable queue of cells, three integers each. */
class CellQueue {
  private cells = new Int32Array(3 * 1024);
  private length = 0;
  head = 0;

  get isEmpty(): boolean {
    return this.head >= this.length;
  }

  push(x: number, y: number, z: number) {
    if (this.length + 3 > this.cells.length) {
      const grown = new Int32Array(this.cells.length * 2);
      grown.set(this.cells);
      this.cells = grown;
    }
    this.cells[this.length++] = x;
    this.cells[this.length++] = y;
    this.cells[this.length++] = z;
  }

  /** Reads the next cell into out[0..2]. */
  shift(out: Int32Array) {
    out[0] = this.cells[this.head++];
    out[1] = this.cells[this.head++];
    out[2] = this.cells[this.head++];
  }

  clear() {
    this.head = 0;
    this.length = 0;
  }
}

class RelightRun {
  private readonly loadedChunks = new Map<number, LoadedChunk | null>();
  private readonly changedChunks = new Map<number, ChunkCoordinate>();
  readonly stats: RelightStats = {
    cellsRemoved: 0,
    cellsLit: 0,
    cellsVisited: 0,
  };
  private readonly cell = new Int32Array(3);

  constructor(private readonly source: LightChunkSource) {}

  private chunkAt(x: number, y: number, z: number): LoadedChunk | null {
    const chunkX = x >> CHUNK_SHIFT;
    const chunkY = y >> CHUNK_SHIFT;
    const chunkZ = z >> CHUNK_SHIFT;
    const key = chunkKey(chunkX, chunkY, chunkZ);
    let chunk = this.loadedChunks.get(key);
    if (chunk === undefined) {
      const blocks = this.source.getBlocks(chunkX, chunkY, chunkZ);
      const light = this.source.getLight(chunkX, chunkY, chunkZ);
      chunk =
        blocks && light ? { chunkX, chunkY, chunkZ, blocks, light } : null;
      this.loadedChunks.set(key, chunk);
    }
    return chunk;
  }

  private markChanged(
    chunk: LoadedChunk,
    localX: number,
    localY: number,
    localZ: number,
  ) {
    this.markChunk(chunk.chunkX, chunk.chunkY, chunk.chunkZ);
    // The neighbor's mesh reads this layer as its border light.
    if (localX === 0)
      this.markChunk(chunk.chunkX - 1, chunk.chunkY, chunk.chunkZ);
    if (localX === CHUNK_MASK)
      this.markChunk(chunk.chunkX + 1, chunk.chunkY, chunk.chunkZ);
    if (localY === 0)
      this.markChunk(chunk.chunkX, chunk.chunkY - 1, chunk.chunkZ);
    if (localY === CHUNK_MASK)
      this.markChunk(chunk.chunkX, chunk.chunkY + 1, chunk.chunkZ);
    if (localZ === 0)
      this.markChunk(chunk.chunkX, chunk.chunkY, chunk.chunkZ - 1);
    if (localZ === CHUNK_MASK)
      this.markChunk(chunk.chunkX, chunk.chunkY, chunk.chunkZ + 1);
  }

  markChunk(chunkX: number, chunkY: number, chunkZ: number) {
    const key = chunkKey(chunkX, chunkY, chunkZ);
    if (!this.changedChunks.has(key)) {
      this.changedChunks.set(key, { x: chunkX, y: chunkY, z: chunkZ });
    }
  }

  collectChangedChunks(): ChunkCoordinate[] {
    return Array.from(this.changedChunks.values());
  }

  blockAt(x: number, y: number, z: number): number {
    const chunk = this.chunkAt(x, y, z);
    if (!chunk) return -1;
    return chunk.blocks[
      cellIndex(x & CHUNK_MASK, y & CHUNK_MASK, z & CHUNK_MASK)
    ];
  }

  channelValue(x: number, y: number, z: number, channel: number): number {
    const chunk = this.chunkAt(x, y, z);
    if (!chunk) return -1;
    const packed =
      chunk.light[cellIndex(x & CHUNK_MASK, y & CHUNK_MASK, z & CHUNK_MASK)];
    return channel === SKY_CHANNEL ? packed >> 4 : packed & 0xf;
  }

  /** Writes one channel of a loaded cell and records the change. Returns false when the cell is not loaded. */
  setChannel(
    x: number,
    y: number,
    z: number,
    channel: number,
    value: number,
  ): boolean {
    const chunk = this.chunkAt(x, y, z);
    if (!chunk) return false;
    const localX = x & CHUNK_MASK;
    const localY = y & CHUNK_MASK;
    const localZ = z & CHUNK_MASK;
    const index = cellIndex(localX, localY, localZ);
    const packed = chunk.light[index];
    const updated =
      channel === SKY_CHANNEL
        ? (packed & 0x0f) | (value << 4)
        : (packed & 0xf0) | value;
    if (updated !== packed) {
      chunk.light[index] = updated;
      this.markChanged(chunk, localX, localY, localZ);
    }
    return true;
  }

  /**
   * Zeroes every cell whose light depended on the light that used to be at the
   * start cells, and queues the independent light found at the edge of the hole.
   */
  removeLight(
    removal: CellQueue,
    removedValues: number[],
    channel: number,
    refill: CellQueue,
  ) {
    const cell = this.cell;
    let valueIndex = 0;
    while (!removal.isEmpty) {
      removal.shift(cell);
      const removedValue = removedValues[valueIndex++];
      const x = cell[0];
      const y = cell[1];
      const z = cell[2];
      this.stats.cellsVisited++;

      for (let direction = 0; direction < 6; direction++) {
        const neighborX = x + NEIGHBOR_DX[direction];
        const neighborY = y + NEIGHBOR_DY[direction];
        const neighborZ = z + NEIGHBOR_DZ[direction];
        const neighborValue = this.channelValue(
          neighborX,
          neighborY,
          neighborZ,
          channel,
        );
        if (neighborValue <= 0) continue;

        const fedByRemovedCell =
          neighborValue < removedValue ||
          (channel === SKY_CHANNEL &&
            direction === DOWN_DIRECTION &&
            removedValue === MAX_LIGHT &&
            neighborValue === MAX_LIGHT);
        if (fedByRemovedCell) {
          this.setChannel(neighborX, neighborY, neighborZ, channel, 0);
          this.stats.cellsRemoved++;
          removal.push(neighborX, neighborY, neighborZ);
          removedValues.push(neighborValue);
        } else {
          refill.push(neighborX, neighborY, neighborZ);
        }
      }
    }
    removal.clear();
    removedValues.length = 0;
  }

  /** Floods light outward from the queued cells, which already hold their light. */
  spreadLight(queue: CellQueue, channel: number) {
    const cell = this.cell;
    while (!queue.isEmpty) {
      queue.shift(cell);
      const x = cell[0];
      const y = cell[1];
      const z = cell[2];
      const value = this.channelValue(x, y, z, channel);
      this.stats.cellsVisited++;
      if (value <= 0) continue;

      for (let direction = 0; direction < 6; direction++) {
        const neighborX = x + NEIGHBOR_DX[direction];
        const neighborY = y + NEIGHBOR_DY[direction];
        const neighborZ = z + NEIGHBOR_DZ[direction];
        const neighborBlock = this.blockAt(neighborX, neighborY, neighborZ);
        if (neighborBlock < 0 || !IS_TRANSPARENT[neighborBlock]) continue;

        const reachedValue =
          channel === SKY_CHANNEL &&
          direction === DOWN_DIRECTION &&
          value === MAX_LIGHT
            ? MAX_LIGHT
            : value - 1;
        if (
          reachedValue <=
          this.channelValue(neighborX, neighborY, neighborZ, channel)
        )
          continue;

        this.setChannel(neighborX, neighborY, neighborZ, channel, reachedValue);
        this.stats.cellsLit++;
        queue.push(neighborX, neighborY, neighborZ);
      }
    }
  }
}

const removalQueue = new CellQueue();
const refillQueue = new CellQueue();
const removedValues: number[] = [];

/**
 * Brings the light around (x, y, z) back in line after the block there changed
 * from oldBlock to whatever the chunk holds now. The chunk data must already
 * contain the new block. Chunks that are not loaded are left alone.
 */
export function relightAfterBlockChange(
  source: LightChunkSource,
  x: number,
  y: number,
  z: number,
  oldBlock: number,
): RelightResult {
  const run = new RelightRun(source);
  run.markChunk(x >> CHUNK_SHIFT, y >> CHUNK_SHIFT, z >> CHUNK_SHIFT);

  const newBlock = run.blockAt(x, y, z);
  if (newBlock < 0)
    return { chunksToRemesh: run.collectChangedChunks(), stats: run.stats };

  const changesLight =
    IS_TRANSPARENT[oldBlock] !== IS_TRANSPARENT[newBlock] ||
    EMISSION[oldBlock] !== EMISSION[newBlock];
  if (!changesLight)
    return { chunksToRemesh: run.collectChangedChunks(), stats: run.stats };

  for (const channel of [SKY_CHANNEL, BLOCK_CHANNEL]) {
    removalQueue.clear();
    refillQueue.clear();

    const previousValue = run.channelValue(x, y, z, channel);
    if (previousValue > 0) {
      run.setChannel(x, y, z, channel, 0);
      run.stats.cellsRemoved++;
      removalQueue.push(x, y, z);
      removedValues.push(previousValue);
      run.removeLight(removalQueue, removedValues, channel, refillQueue);
    }

    if (channel === BLOCK_CHANNEL && EMISSION[newBlock] > 0) {
      run.setChannel(x, y, z, channel, EMISSION[newBlock]);
      run.stats.cellsLit++;
      refillQueue.push(x, y, z);
    }
    if (IS_TRANSPARENT[newBlock]) {
      // Light next to the new gap flows in through it.
      for (let direction = 0; direction < 6; direction++) {
        refillQueue.push(
          x + NEIGHBOR_DX[direction],
          y + NEIGHBOR_DY[direction],
          z + NEIGHBOR_DZ[direction],
        );
      }
    }
    run.spreadLight(refillQueue, channel);
  }

  return { chunksToRemesh: run.collectChangedChunks(), stats: run.stats };
}
