// Integer chunk keys: (chunkX, chunkY, chunkZ) packed into one safe-integer number, no string allocation.
//
// Layout (most significant first): x 21 bits | z 21 bits | y 10 bits, each stored with a bias so that it is
// unsigned. Total 52 bits, below 2^53, so every key is an exact double and works as a Map key.
//
//   key = ((x + X_BIAS) * Z_SPAN + (z + Z_BIAS)) * Y_SPAN + (y + Y_BIAS)
//
// Because y is the lowest field, the column key (x, z) is simply floor(key / Y_SPAN), and a neighbor key is the
// key plus a constant delta (see offsetChunkKey). Bit operators are avoided on purpose: they truncate to 32 bits.

const Y_BITS = 10;
const Z_BITS = 21;
const X_BITS = 21;

const Y_SPAN = 2 ** Y_BITS;
const Z_SPAN = 2 ** Z_BITS;
const X_SPAN = 2 ** X_BITS;

const Y_BIAS = Y_SPAN / 2;
const Z_BIAS = Z_SPAN / 2;
const X_BIAS = X_SPAN / 2;

/** Key delta for +1 chunk along each axis. */
export const KEY_STRIDE_Y = 1;
export const KEY_STRIDE_Z = Y_SPAN;
export const KEY_STRIDE_X = Z_SPAN * Y_SPAN;

/** Column key delta for +1 chunk along each axis. */
export const COLUMN_KEY_STRIDE_Z = 1;
export const COLUMN_KEY_STRIDE_X = Z_SPAN;

/**
 * Inclusive coordinate ranges that pack without aliasing. Neighbor math (offsetChunkKey) additionally needs
 * the neighbor itself to be in range, so keep coordinates at least |delta| away from these limits.
 */
export const MIN_CHUNK_X = -X_BIAS;
export const MAX_CHUNK_X = X_BIAS - 1;
export const MIN_CHUNK_Y = -Y_BIAS;
export const MAX_CHUNK_Y = Y_BIAS - 1;
export const MIN_CHUNK_Z = -Z_BIAS;
export const MAX_CHUNK_Z = Z_BIAS - 1;

export interface ChunkCoordinates {
  chunkX: number;
  chunkY: number;
  chunkZ: number;
}

export interface ColumnCoordinates {
  chunkX: number;
  chunkZ: number;
}

export function createChunkCoordinates(): ChunkCoordinates {
  return { chunkX: 0, chunkY: 0, chunkZ: 0 };
}

export function createColumnCoordinates(): ColumnCoordinates {
  return { chunkX: 0, chunkZ: 0 };
}

export function isChunkCoordinateInRange(chunkX: number, chunkY: number, chunkZ: number): boolean {
  return (
    Number.isInteger(chunkX) &&
    Number.isInteger(chunkY) &&
    Number.isInteger(chunkZ) &&
    chunkX >= MIN_CHUNK_X &&
    chunkX <= MAX_CHUNK_X &&
    chunkY >= MIN_CHUNK_Y &&
    chunkY <= MAX_CHUNK_Y &&
    chunkZ >= MIN_CHUNK_Z &&
    chunkZ <= MAX_CHUNK_Z
  );
}

export function packChunkKey(chunkX: number, chunkY: number, chunkZ: number): number {
  return ((chunkX + X_BIAS) * Z_SPAN + (chunkZ + Z_BIAS)) * Y_SPAN + (chunkY + Y_BIAS);
}

export function chunkKeyY(chunkKey: number): number {
  return (chunkKey % Y_SPAN) - Y_BIAS;
}

export function chunkKeyZ(chunkKey: number): number {
  return (Math.floor(chunkKey / Y_SPAN) % Z_SPAN) - Z_BIAS;
}

export function chunkKeyX(chunkKey: number): number {
  return Math.floor(chunkKey / (Y_SPAN * Z_SPAN)) - X_BIAS;
}

export function unpackChunkKey(chunkKey: number, out: ChunkCoordinates): ChunkCoordinates {
  const columnKey = Math.floor(chunkKey / Y_SPAN);
  out.chunkY = chunkKey - columnKey * Y_SPAN - Y_BIAS;
  const zBiased = columnKey % Z_SPAN;
  out.chunkZ = zBiased - Z_BIAS;
  out.chunkX = (columnKey - zBiased) / Z_SPAN - X_BIAS;
  return out;
}

/**
 * Key of the chunk at (+deltaX, +deltaY, +deltaZ) without unpacking. Exact as long as the resulting
 * coordinates stay inside the MIN/MAX ranges; outside them the fields carry into each other.
 */
export function offsetChunkKey(chunkKey: number, deltaX: number, deltaY: number, deltaZ: number): number {
  return chunkKey + deltaX * KEY_STRIDE_X + deltaY * KEY_STRIDE_Y + deltaZ * KEY_STRIDE_Z;
}

/** Face neighbor deltas as key offsets, in the order +x, -x, +y, -y, +z, -z. */
export const FACE_NEIGHBOR_KEY_DELTAS: readonly number[] = [
  KEY_STRIDE_X,
  -KEY_STRIDE_X,
  KEY_STRIDE_Y,
  -KEY_STRIDE_Y,
  KEY_STRIDE_Z,
  -KEY_STRIDE_Z,
];

/** Face neighbor deltas as [dx, dy, dz], same order as FACE_NEIGHBOR_KEY_DELTAS. */
export const FACE_NEIGHBOR_OFFSETS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export function packColumnKey(chunkX: number, chunkZ: number): number {
  return (chunkX + X_BIAS) * Z_SPAN + (chunkZ + Z_BIAS);
}

export function columnKeyOfChunkKey(chunkKey: number): number {
  return Math.floor(chunkKey / Y_SPAN);
}

/** Chunk key of the chunk at height chunkY inside a column. */
export function chunkKeyInColumn(columnKey: number, chunkY: number): number {
  return columnKey * Y_SPAN + (chunkY + Y_BIAS);
}

export function unpackColumnKey(columnKey: number, out: ColumnCoordinates): ColumnCoordinates {
  const zBiased = columnKey % Z_SPAN;
  out.chunkZ = zBiased - Z_BIAS;
  out.chunkX = (columnKey - zBiased) / Z_SPAN - X_BIAS;
  return out;
}

export function offsetColumnKey(columnKey: number, deltaX: number, deltaZ: number): number {
  return columnKey + deltaX * COLUMN_KEY_STRIDE_X + deltaZ * COLUMN_KEY_STRIDE_Z;
}
