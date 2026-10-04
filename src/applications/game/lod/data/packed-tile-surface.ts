// Compact in-memory form of a TileSurface (typically 1.5-2.5 KB instead of 6 KB): heights as byte offsets from the
// tile minimum when the range allows, (top, side) block pairs through a palette with bit-packed indices, and water as
// a bit mask when the whole tile shares one water level. The header also carries the height range, which selection
// reads without unpacking.

import { NO_WATER, TILE_CELL_COUNT } from "../core/lod-constants";
import { createTileSurface, heightRangeOf, type HeightRange, type TileSurface } from "./tile-surface";

const FORMAT_VERSION = 1;
const HEADER_BYTES = 16;
const HEIGHTS_AS_BYTE_OFFSETS = 0;
const HEIGHTS_AS_INT16 = 1;
const WATER_NONE = 0;
const WATER_UNIFORM_MASK = 1;
const WATER_INT16 = 2;
const MAXIMUM_BYTE_OFFSET = 255;

export type PackedTileSurface = ArrayBuffer;

function bitsForPaletteSize(paletteSize: number): number {
  if (paletteSize <= 1) return 0;
  if (paletteSize <= 2) return 1;
  if (paletteSize <= 4) return 2;
  if (paletteSize <= 16) return 4;
  if (paletteSize <= 256) return 8;
  return 16;
}

function packedIndexBytes(bitsPerIndex: number): number {
  return Math.ceil((TILE_CELL_COUNT * bitsPerIndex) / 8);
}

function describeWater(surface: TileSurface): { encoding: number; uniformLevel: number } {
  let uniformLevel = NO_WATER;
  for (let index = 0; index < TILE_CELL_COUNT; index++) {
    const level = surface.waterLevels[index]!;
    if (level === NO_WATER) continue;
    if (uniformLevel === NO_WATER) uniformLevel = level;
    else if (level !== uniformLevel) return { encoding: WATER_INT16, uniformLevel: NO_WATER };
  }
  return uniformLevel === NO_WATER ? { encoding: WATER_NONE, uniformLevel } : { encoding: WATER_UNIFORM_MASK, uniformLevel };
}

export function packTileSurface(surface: TileSurface): PackedTileSurface {
  const { minHeight, maxHeight } = heightRangeOf(surface);
  let lowestHeight = Infinity;
  let highestHeight = -Infinity;
  for (let index = 0; index < TILE_CELL_COUNT; index++) {
    lowestHeight = Math.min(lowestHeight, surface.heights[index]!);
    highestHeight = Math.max(highestHeight, surface.heights[index]!);
  }
  const heightEncoding = highestHeight - lowestHeight <= MAXIMUM_BYTE_OFFSET ? HEIGHTS_AS_BYTE_OFFSETS : HEIGHTS_AS_INT16;

  const paletteIndexByPair = new Map<number, number>();
  const palettePairs: number[] = [];
  const cellPaletteIndices = new Uint16Array(TILE_CELL_COUNT);
  for (let index = 0; index < TILE_CELL_COUNT; index++) {
    const pair = (surface.topBlocks[index]! << 8) | surface.sideBlocks[index]!;
    let paletteIndex = paletteIndexByPair.get(pair);
    if (paletteIndex === undefined) {
      paletteIndex = palettePairs.length;
      palettePairs.push(pair);
      paletteIndexByPair.set(pair, paletteIndex);
    }
    cellPaletteIndices[index] = paletteIndex;
  }
  const bitsPerIndex = bitsForPaletteSize(palettePairs.length);
  const water = describeWater(surface);

  const paletteBytes = palettePairs.length * 2;
  const heightBytes = heightEncoding === HEIGHTS_AS_BYTE_OFFSETS ? TILE_CELL_COUNT : TILE_CELL_COUNT * 2;
  const indexBytes = packedIndexBytes(bitsPerIndex);
  const waterBytes = water.encoding === WATER_NONE ? 0 : water.encoding === WATER_UNIFORM_MASK ? TILE_CELL_COUNT / 8 : TILE_CELL_COUNT * 2;
  const buffer = new ArrayBuffer(HEADER_BYTES + paletteBytes + heightBytes + indexBytes + waterBytes);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setUint8(0, FORMAT_VERSION);
  view.setUint8(1, heightEncoding);
  view.setInt16(2, lowestHeight, true);
  view.setInt16(4, minHeight, true);
  view.setInt16(6, maxHeight, true);
  view.setUint16(8, palettePairs.length, true);
  view.setUint8(10, bitsPerIndex);
  view.setUint8(11, water.encoding);
  view.setInt16(12, water.uniformLevel, true);

  let offset = HEADER_BYTES;
  for (const pair of palettePairs) {
    view.setUint16(offset, pair, true);
    offset += 2;
  }
  for (let index = 0; index < TILE_CELL_COUNT; index++) {
    if (heightEncoding === HEIGHTS_AS_BYTE_OFFSETS) {
      bytes[offset + index] = surface.heights[index]! - lowestHeight;
    } else {
      view.setInt16(offset + index * 2, surface.heights[index]!, true);
    }
  }
  offset += heightBytes;
  if (bitsPerIndex > 0) {
    for (let index = 0; index < TILE_CELL_COUNT; index++) {
      const bitOffset = index * bitsPerIndex;
      if (bitsPerIndex === 16) {
        view.setUint16(offset + index * 2, cellPaletteIndices[index]!, true);
      } else {
        bytes[offset + (bitOffset >> 3)]! |= cellPaletteIndices[index]! << (bitOffset & 7);
      }
    }
  }
  offset += indexBytes;
  for (let index = 0; index < TILE_CELL_COUNT; index++) {
    const level = surface.waterLevels[index]!;
    if (water.encoding === WATER_UNIFORM_MASK) {
      if (level !== NO_WATER) bytes[offset + (index >> 3)]! |= 1 << (index & 7);
    } else if (water.encoding === WATER_INT16) {
      view.setInt16(offset + index * 2, level, true);
    }
  }
  return buffer;
}

export function unpackTileSurface(packed: PackedTileSurface): TileSurface {
  const view = new DataView(packed);
  const bytes = new Uint8Array(packed);
  if (view.getUint8(0) !== FORMAT_VERSION) throw new Error(`Unknown packed tile surface version ${view.getUint8(0)}`);
  const heightEncoding = view.getUint8(1);
  const lowestHeight = view.getInt16(2, true);
  const paletteSize = view.getUint16(8, true);
  const bitsPerIndex = view.getUint8(10);
  const waterEncoding = view.getUint8(11);
  const uniformWaterLevel = view.getInt16(12, true);
  const surface = createTileSurface();

  let offset = HEADER_BYTES;
  const palettePairs: number[] = [];
  for (let paletteIndex = 0; paletteIndex < paletteSize; paletteIndex++) {
    palettePairs.push(view.getUint16(offset, true));
    offset += 2;
  }
  for (let index = 0; index < TILE_CELL_COUNT; index++) {
    surface.heights[index] =
      heightEncoding === HEIGHTS_AS_BYTE_OFFSETS ? lowestHeight + bytes[offset + index]! : view.getInt16(offset + index * 2, true);
  }
  offset += heightEncoding === HEIGHTS_AS_BYTE_OFFSETS ? TILE_CELL_COUNT : TILE_CELL_COUNT * 2;
  const indexMask = (1 << bitsPerIndex) - 1;
  for (let index = 0; index < TILE_CELL_COUNT; index++) {
    let paletteIndex = 0;
    if (bitsPerIndex === 16) {
      paletteIndex = view.getUint16(offset + index * 2, true);
    } else if (bitsPerIndex > 0) {
      const bitOffset = index * bitsPerIndex;
      paletteIndex = (bytes[offset + (bitOffset >> 3)]! >> (bitOffset & 7)) & indexMask;
    }
    const pair = palettePairs[paletteIndex]!;
    surface.topBlocks[index] = pair >> 8;
    surface.sideBlocks[index] = pair & 0xff;
  }
  offset += packedIndexBytes(bitsPerIndex);
  for (let index = 0; index < TILE_CELL_COUNT; index++) {
    if (waterEncoding === WATER_UNIFORM_MASK) {
      surface.waterLevels[index] = (bytes[offset + (index >> 3)]! >> (index & 7)) & 1 ? uniformWaterLevel : NO_WATER;
    } else if (waterEncoding === WATER_INT16) {
      surface.waterLevels[index] = view.getInt16(offset + index * 2, true);
    }
  }
  return surface;
}

/** Height range stored in the header (surface minimum, maximum including water) without unpacking. */
export function packedHeightRange(packed: PackedTileSurface): HeightRange {
  const view = new DataView(packed);
  return { minHeight: view.getInt16(4, true), maxHeight: view.getInt16(6, true) };
}
