import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "../config";

export const CHUNK_SHIFT = 5;
export const CHUNK_MASK = (1 << CHUNK_SHIFT) - 1;
if (
  CHUNK_WIDTH !== 1 << CHUNK_SHIFT ||
  CHUNK_HEIGHT !== 1 << CHUNK_SHIFT ||
  CHUNK_LENGTH !== 1 << CHUNK_SHIFT
) {
  throw new Error("the edit and light engines assume 32 x 32 x 32 chunks");
}

export const CELLS_PER_CHUNK = CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH;
export const CELL_INDEX_BITS = CHUNK_SHIFT * 3;
export const CELL_INDEX_MASK = CELLS_PER_CHUNK - 1;
export const MAX_CLUSTER_SLOTS = 1 << (32 - CELL_INDEX_BITS);

export const X_STRIDE = 1 << (CHUNK_SHIFT * 2);
export const Y_STRIDE = 1 << CHUNK_SHIFT;

export const DIRECTION_COUNT = 6;
export const POSITIVE_X = 0;
export const NEGATIVE_X = 1;
export const POSITIVE_Y = 2;
export const NEGATIVE_Y = 3;
export const POSITIVE_Z = 4;
export const NEGATIVE_Z = 5;

export const DIRECTION_OFFSET_X = [1, -1, 0, 0, 0, 0];
export const DIRECTION_OFFSET_Y = [0, 0, 1, -1, 0, 0];
export const DIRECTION_OFFSET_Z = [0, 0, 0, 0, 1, -1];
/** Index distance of one step inside a chunk, per direction. */
export const DIRECTION_INDEX_STEP = [X_STRIDE, -X_STRIDE, Y_STRIDE, -Y_STRIDE, 1, -1];

export const NO_CHUNK = -1;
export const UNRESOLVED_NEIGHBOR = -2;

/** For each cell index, one bit per direction whose chunk face the cell sits on. */
export const BOUNDARY_FACES = new Uint8Array(CELLS_PER_CHUNK);
for (let index = 0; index < CELLS_PER_CHUNK; index++) {
  const x = index >> (CHUNK_SHIFT * 2);
  const y = (index >> CHUNK_SHIFT) & CHUNK_MASK;
  const z = index & CHUNK_MASK;
  let faces = 0;
  if (x === CHUNK_MASK) faces |= 1 << POSITIVE_X;
  if (x === 0) faces |= 1 << NEGATIVE_X;
  if (y === CHUNK_MASK) faces |= 1 << POSITIVE_Y;
  if (y === 0) faces |= 1 << NEGATIVE_Y;
  if (z === CHUNK_MASK) faces |= 1 << POSITIVE_Z;
  if (z === 0) faces |= 1 << NEGATIVE_Z;
  BOUNDARY_FACES[index] = faces;
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

export const NO_CHUNKS_SOURCE: LightChunkSource = {
  getBlocks: () => undefined,
  getLight: () => undefined,
};

const NO_DATA = new Uint8Array(0);
const INITIAL_SLOT_CAPACITY = 64;
const EMPTY_HASH_ENTRY = -1;

function hashChunk(chunkX: number, chunkY: number, chunkZ: number): number {
  let hash =
    Math.imul(chunkX, 0x9e3779b1) ^
    Math.imul(chunkY, 0x85ebca6b) ^
    Math.imul(chunkZ, 0xc2b2ae35);
  hash ^= hash >>> 15;
  return hash;
}

/**
 * The chunks one flood fill reads and writes, held in flat slot tables. A cell
 * is addressed by a single integer, (slot << 15) | indexInChunk, so the flood
 * loops never build keys or touch maps; crossing a chunk face reads one entry
 * of a neighbor table that is filled in the first time it is needed.
 *
 * A slot exists for every chunk the flood asked about. It is "lit" when both
 * its blocks and its light are available: only lit slots take part in light.
 */
/** Lookup traffic of one cluster, as plain integers the caller reads after a flood and reports. */
export class ClusterStats {
  slotLookups = 0;
  slotLookupsFound = 0;
  hashProbeSteps = 0;
  slotsCreated = 0;
  slotsWithoutBlocks = 0;
  slotsLoadedFromSource = 0;
  chunksRegisteredByCaller = 0;
  neighborResolutions = 0;
  neighborResolutionsNotLit = 0;
  tableGrowths = 0;
  lightArraysDetached = 0;

  clear() {
    this.slotLookups = 0;
    this.slotLookupsFound = 0;
    this.hashProbeSteps = 0;
    this.slotsCreated = 0;
    this.slotsWithoutBlocks = 0;
    this.slotsLoadedFromSource = 0;
    this.chunksRegisteredByCaller = 0;
    this.neighborResolutions = 0;
    this.neighborResolutionsNotLit = 0;
    this.tableGrowths = 0;
    this.lightArraysDetached = 0;
  }
}

export class ChunkCluster {
  readonly stats = new ClusterStats();
  blocksBySlot: Uint8Array[] = [];
  lightBySlot: Uint8Array[] = [];
  isLitBySlot = new Uint8Array(INITIAL_SLOT_CAPACITY);
  hasBlocksBySlot = new Uint8Array(INITIAL_SLOT_CAPACITY);
  chunkXBySlot = new Int32Array(INITIAL_SLOT_CAPACITY);
  chunkYBySlot = new Int32Array(INITIAL_SLOT_CAPACITY);
  chunkZBySlot = new Int32Array(INITIAL_SLOT_CAPACITY);
  neighborSlots = new Int32Array(INITIAL_SLOT_CAPACITY * DIRECTION_COUNT);
  /** 1 once any block or light value of the slot has been written. */
  contentChanged = new Uint8Array(INITIAL_SLOT_CAPACITY);
  /** Bit per direction: a cell on that face of the slot has changed. */
  faceChanged = new Uint8Array(INITIAL_SLOT_CAPACITY);
  /** 1 while the slot's light is shared with the caller and must be copied before the first write. */
  copyLightOnWrite = new Uint8Array(INITIAL_SLOT_CAPACITY);
  slotCount = 0;

  private hashTable = new Int32Array(INITIAL_SLOT_CAPACITY * 4);
  private source: LightChunkSource = NO_CHUNKS_SOURCE;

  reset(source: LightChunkSource) {
    this.stats.clear();
    this.source = source;
    this.slotCount = 0;
    this.blocksBySlot.length = 0;
    this.lightBySlot.length = 0;
    this.hashTable.fill(EMPTY_HASH_ENTRY);
  }

  /** The slot of a chunk, created (and loaded from the source) the first time it is asked for. */
  slotForChunk(chunkX: number, chunkY: number, chunkZ: number): number {
    const stats = this.stats;
    stats.slotLookups++;
    const mask = this.hashTable.length - 1;
    let position = hashChunk(chunkX, chunkY, chunkZ) & mask;
    for (;;) {
      const slot = this.hashTable[position];
      if (slot === EMPTY_HASH_ENTRY) break;
      if (
        this.chunkXBySlot[slot] === chunkX &&
        this.chunkYBySlot[slot] === chunkY &&
        this.chunkZBySlot[slot] === chunkZ
      ) {
        stats.slotLookupsFound++;
        return slot;
      }
      position = (position + 1) & mask;
      stats.hashProbeSteps++;
    }
    const blocks = this.source.getBlocks(chunkX, chunkY, chunkZ);
    const light = blocks
      ? this.source.getLight(chunkX, chunkY, chunkZ)
      : undefined;
    stats.slotsLoadedFromSource++;
    if (!blocks) stats.slotsWithoutBlocks++;
    return this.addSlot(chunkX, chunkY, chunkZ, blocks, light, false);
  }

  /** Adds a chunk the caller already holds, so no source lookup is needed. */
  registerChunk(
    chunkX: number,
    chunkY: number,
    chunkZ: number,
    blocks: Uint8Array,
    light: Uint8Array,
    copyLightBeforeWriting: boolean,
  ): number {
    this.stats.chunksRegisteredByCaller++;
    return this.addSlot(
      chunkX,
      chunkY,
      chunkZ,
      blocks,
      light,
      copyLightBeforeWriting,
    );
  }

  /** The lit slot next to a slot, or NO_CHUNK when that chunk is not loaded and lit. */
  neighborSlot(slot: number, direction: number): number {
    const cached = this.neighborSlots[slot * DIRECTION_COUNT + direction];
    return cached === UNRESOLVED_NEIGHBOR
      ? this.resolveNeighbor(slot, direction)
      : cached;
  }

  resolveNeighbor(slot: number, direction: number): number {
    this.stats.neighborResolutions++;
    const neighbor = this.slotForChunk(
      this.chunkXBySlot[slot] + DIRECTION_OFFSET_X[direction],
      this.chunkYBySlot[slot] + DIRECTION_OFFSET_Y[direction],
      this.chunkZBySlot[slot] + DIRECTION_OFFSET_Z[direction],
    );
    const resolved = this.isLitBySlot[neighbor] === 1 ? neighbor : NO_CHUNK;
    if (resolved === NO_CHUNK) this.stats.neighborResolutionsNotLit++;
    this.neighborSlots[slot * DIRECTION_COUNT + direction] = resolved;
    return resolved;
  }

  /** Gives the slot a private copy of its light before the first write into it. */
  detachLight(slot: number) {
    this.stats.lightArraysDetached++;
    this.lightBySlot[slot] = this.lightBySlot[slot].slice();
    this.copyLightOnWrite[slot] = 0;
  }

  private addSlot(
    chunkX: number,
    chunkY: number,
    chunkZ: number,
    blocks: Uint8Array | undefined,
    light: Uint8Array | undefined,
    copyLightBeforeWriting: boolean,
  ): number {
    if (this.slotCount === this.chunkXBySlot.length) {
      this.grow();
      this.stats.tableGrowths++;
    }
    if (this.slotCount >= MAX_CLUSTER_SLOTS) {
      throw new Error("too many chunks in one light update");
    }
    this.stats.slotsCreated++;
    const slot = this.slotCount++;
    this.chunkXBySlot[slot] = chunkX;
    this.chunkYBySlot[slot] = chunkY;
    this.chunkZBySlot[slot] = chunkZ;
    this.blocksBySlot[slot] = blocks ?? NO_DATA;
    this.lightBySlot[slot] = light ?? NO_DATA;
    this.hasBlocksBySlot[slot] = blocks ? 1 : 0;
    this.isLitBySlot[slot] = blocks && light ? 1 : 0;
    this.contentChanged[slot] = 0;
    this.faceChanged[slot] = 0;
    this.copyLightOnWrite[slot] = copyLightBeforeWriting ? 1 : 0;
    this.neighborSlots.fill(
      UNRESOLVED_NEIGHBOR,
      slot * DIRECTION_COUNT,
      (slot + 1) * DIRECTION_COUNT,
    );
    this.insertIntoHash(slot);
    return slot;
  }

  private insertIntoHash(slot: number) {
    const mask = this.hashTable.length - 1;
    let position =
      hashChunk(
        this.chunkXBySlot[slot],
        this.chunkYBySlot[slot],
        this.chunkZBySlot[slot],
      ) & mask;
    while (this.hashTable[position] !== EMPTY_HASH_ENTRY) {
      position = (position + 1) & mask;
    }
    this.hashTable[position] = slot;
  }

  private grow() {
    const capacity = this.chunkXBySlot.length * 2;
    const grownBytes = (existing: Uint8Array) => {
      const grown = new Uint8Array(capacity);
      grown.set(existing);
      return grown;
    };
    const grownInts = (existing: Int32Array, perSlot = 1) => {
      const grown = new Int32Array(capacity * perSlot);
      grown.set(existing);
      return grown;
    };
    this.isLitBySlot = grownBytes(this.isLitBySlot);
    this.hasBlocksBySlot = grownBytes(this.hasBlocksBySlot);
    this.contentChanged = grownBytes(this.contentChanged);
    this.faceChanged = grownBytes(this.faceChanged);
    this.copyLightOnWrite = grownBytes(this.copyLightOnWrite);
    this.chunkXBySlot = grownInts(this.chunkXBySlot);
    this.chunkYBySlot = grownInts(this.chunkYBySlot);
    this.chunkZBySlot = grownInts(this.chunkZBySlot);
    this.neighborSlots = grownInts(this.neighborSlots, DIRECTION_COUNT);
    this.hashTable = new Int32Array(capacity * 4).fill(EMPTY_HASH_ENTRY);
    for (let slot = 0; slot < this.slotCount; slot++) this.insertIntoHash(slot);
  }
}
