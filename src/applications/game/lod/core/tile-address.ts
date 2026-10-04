// Quadtree addressing: (level, tileX, tileZ) <-> a numeric key, bounds in blocks, parent and children.

import { tileSizeOfLevel } from "./lod-constants";

export interface TileAddress {
  readonly level: number;
  readonly tileX: number;
  readonly tileZ: number;
}

const COORDINATE_RANGE = 2 ** 22;
const COORDINATE_OFFSET = 2 ** 21;

/** Unique numeric key (safe integer) for tile coordinates within +-2^21 tiles at every level. */
export function tileKeyOf(level: number, tileX: number, tileZ: number): number {
  return (level * COORDINATE_RANGE + (tileX + COORDINATE_OFFSET)) * COORDINATE_RANGE + (tileZ + COORDINATE_OFFSET);
}

export function tileAddressOfKey(key: number): TileAddress {
  const tileZ = (key % COORDINATE_RANGE) - COORDINATE_OFFSET;
  const rest = Math.floor(key / COORDINATE_RANGE);
  const tileX = (rest % COORDINATE_RANGE) - COORDINATE_OFFSET;
  const level = Math.floor(rest / COORDINATE_RANGE);
  return { level, tileX, tileZ };
}

export function tileKeyOfAddress(address: TileAddress): number {
  return tileKeyOf(address.level, address.tileX, address.tileZ);
}

export function parentAddressOf(address: TileAddress): TileAddress {
  return { level: address.level + 1, tileX: Math.floor(address.tileX / 2), tileZ: Math.floor(address.tileZ / 2) };
}

export function childAddressesOf(address: TileAddress): TileAddress[] {
  const level = address.level - 1;
  const firstX = address.tileX * 2;
  const firstZ = address.tileZ * 2;
  return [
    { level, tileX: firstX, tileZ: firstZ },
    { level, tileX: firstX + 1, tileZ: firstZ },
    { level, tileX: firstX, tileZ: firstZ + 1 },
    { level, tileX: firstX + 1, tileZ: firstZ + 1 },
  ];
}

/** The ancestor of `address` at `level` (level >= address.level). */
export function ancestorAddressAt(address: TileAddress, level: number): TileAddress {
  const shift = level - address.level;
  const divisor = 2 ** shift;
  return { level, tileX: Math.floor(address.tileX / divisor), tileZ: Math.floor(address.tileZ / divisor) };
}

export interface TileBounds {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

export function tileBoundsOf(address: TileAddress): TileBounds {
  const size = tileSizeOfLevel(address.level);
  const minX = address.tileX * size;
  const minZ = address.tileZ * size;
  return { minX, minZ, maxX: minX + size, maxZ: minZ + size };
}

export function isSameTile(first: TileAddress, second: TileAddress): boolean {
  return first.level === second.level && first.tileX === second.tileX && first.tileZ === second.tileZ;
}
