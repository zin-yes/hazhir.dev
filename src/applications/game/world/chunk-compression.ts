// Memory compression for per-chunk Uint8Array(32768) data (block ids or packed light bytes).
//
// Four representations, the smallest one wins:
//   uniform  every cell equal. Shared per-value singleton, so a uniform chunk costs no allocation at all.
//   palette  up to 16 distinct values, bit-packed indices (1, 2 or 4 bits per cell) plus the palette.
//   runs     run-length: start index (uint16) and value (uint8) per run; random access by binary search.
//   raw      verbatim copy, used when nothing above is smaller.
//
// A compressed chunk never aliases the source array or any array passed to decompressInto.

import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "@/applications/game/config";

export const CHUNK_CELL_COUNT = CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH;

/** Bookkeeping bytes counted on top of the payload of every non-uniform chunk. */
export const COMPRESSED_HEADER_BYTES = 4;

const BYTES_PER_RUN = 3;
const MAX_PALETTE_SIZE = 16;
const DISTINCT_VALUE_COUNT = 256;

export interface UniformChunk {
  readonly kind: "uniform";
  readonly value: number;
}

export interface PaletteChunk {
  readonly kind: "palette";
  readonly bitsPerCell: 1 | 2 | 4;
  readonly palette: Uint8Array;
  readonly packedIndices: Uint8Array;
}

export interface RunLengthChunk {
  readonly kind: "runs";
  /** Index of the first cell of each run, ascending. */
  readonly runStarts: Uint16Array;
  readonly runValues: Uint8Array;
}

export interface RawChunk {
  readonly kind: "raw";
  readonly cells: Uint8Array;
}

export type CompressedChunk = UniformChunk | PaletteChunk | RunLengthChunk | RawChunk;

const uniformChunkByValue: UniformChunk[] = Array.from({ length: DISTINCT_VALUE_COUNT }, (_, value) =>
  Object.freeze({ kind: "uniform" as const, value }),
);

const paletteIndexByValue = new Uint8Array(DISTINCT_VALUE_COUNT);
const valueIsInPalette = new Uint8Array(DISTINCT_VALUE_COUNT);

function assertChunkLength(cells: Uint8Array): void {
  if (cells.length !== CHUNK_CELL_COUNT) {
    throw new Error(`chunk must have ${CHUNK_CELL_COUNT} cells, received ${cells.length}`);
  }
}

function bitsPerCellForPaletteSize(paletteSize: number): 1 | 2 | 4 | undefined {
  if (paletteSize <= 2) return 1;
  if (paletteSize <= 4) return 2;
  if (paletteSize <= MAX_PALETTE_SIZE) return 4;
  return undefined;
}

export function compress(cells: Uint8Array): CompressedChunk {
  assertChunkLength(cells);
  const paletteValues: number[] = [];
  let runCount = 0;
  let previousValue = -1;
  for (let index = 0; index < CHUNK_CELL_COUNT; index++) {
    const value = cells[index]!;
    if (value !== previousValue) {
      runCount++;
      previousValue = value;
    }
    if (valueIsInPalette[value] === 0) {
      valueIsInPalette[value] = 1;
      paletteIndexByValue[value] = paletteValues.length;
      paletteValues.push(value);
    }
  }
  const paletteSize = paletteValues.length;

  try {
    if (paletteSize === 1) return uniformChunkByValue[paletteValues[0]!]!;

    const bitsPerCell = bitsPerCellForPaletteSize(paletteSize);
    const paletteBytes = bitsPerCell === undefined ? Infinity : (CHUNK_CELL_COUNT * bitsPerCell) / 8 + paletteSize;
    const runBytes = runCount * BYTES_PER_RUN;
    if (paletteBytes <= runBytes && paletteBytes < CHUNK_CELL_COUNT) {
      return buildPaletteChunk(cells, paletteValues, bitsPerCell!);
    }
    if (runBytes < CHUNK_CELL_COUNT) return buildRunLengthChunk(cells, runCount);
    return { kind: "raw", cells: cells.slice() };
  } finally {
    for (const value of paletteValues) valueIsInPalette[value] = 0;
  }
}

function buildPaletteChunk(cells: Uint8Array, paletteValues: number[], bitsPerCell: 1 | 2 | 4): PaletteChunk {
  const cellsPerByte = 8 / bitsPerCell;
  const packedIndices = new Uint8Array(CHUNK_CELL_COUNT / cellsPerByte);
  for (let byteIndex = 0; byteIndex < packedIndices.length; byteIndex++) {
    const firstCell = byteIndex * cellsPerByte;
    let packedByte = 0;
    for (let cellInByte = 0; cellInByte < cellsPerByte; cellInByte++) {
      packedByte |= paletteIndexByValue[cells[firstCell + cellInByte]!]! << (cellInByte * bitsPerCell);
    }
    packedIndices[byteIndex] = packedByte;
  }
  return { kind: "palette", bitsPerCell, palette: Uint8Array.from(paletteValues), packedIndices };
}

function buildRunLengthChunk(cells: Uint8Array, runCount: number): RunLengthChunk {
  const runStarts = new Uint16Array(runCount);
  const runValues = new Uint8Array(runCount);
  let runIndex = 0;
  let previousValue = -1;
  for (let index = 0; index < CHUNK_CELL_COUNT; index++) {
    const value = cells[index]!;
    if (value !== previousValue) {
      runStarts[runIndex] = index;
      runValues[runIndex] = value;
      runIndex++;
      previousValue = value;
    }
  }
  return { kind: "runs", runStarts, runValues };
}

export function decompressInto(compressed: CompressedChunk, target: Uint8Array): Uint8Array {
  assertChunkLength(target);
  switch (compressed.kind) {
    case "uniform":
      target.fill(compressed.value);
      break;
    case "raw":
      target.set(compressed.cells);
      break;
    case "runs": {
      const { runStarts, runValues } = compressed;
      for (let runIndex = 0; runIndex < runStarts.length; runIndex++) {
        const runEnd = runIndex + 1 < runStarts.length ? runStarts[runIndex + 1]! : CHUNK_CELL_COUNT;
        target.fill(runValues[runIndex]!, runStarts[runIndex]!, runEnd);
      }
      break;
    }
    case "palette":
      unpackPaletteInto(compressed, target);
      break;
  }
  return target;
}

function unpackPaletteInto(compressed: PaletteChunk, target: Uint8Array): void {
  const { bitsPerCell, palette, packedIndices } = compressed;
  const cellsPerByte = 8 / bitsPerCell;
  const indexMask = (1 << bitsPerCell) - 1;
  for (let byteIndex = 0; byteIndex < packedIndices.length; byteIndex++) {
    const packedByte = packedIndices[byteIndex]!;
    const firstCell = byteIndex * cellsPerByte;
    for (let cellInByte = 0; cellInByte < cellsPerByte; cellInByte++) {
      target[firstCell + cellInByte] = palette[(packedByte >> (cellInByte * bitsPerCell)) & indexMask]!;
    }
  }
}

/** Value of one cell without decompressing the chunk. */
export function readCell(compressed: CompressedChunk, index: number): number {
  switch (compressed.kind) {
    case "uniform":
      return compressed.value;
    case "raw":
      return compressed.cells[index]!;
    case "palette": {
      const { bitsPerCell, palette, packedIndices } = compressed;
      const bitOffset = index * bitsPerCell;
      return palette[(packedIndices[bitOffset >> 3]! >> (bitOffset & 7)) & ((1 << bitsPerCell) - 1)]!;
    }
    case "runs": {
      const { runStarts, runValues } = compressed;
      let low = 0;
      let high = runStarts.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (runStarts[middle]! <= index) low = middle;
        else high = middle - 1;
      }
      return runValues[low]!;
    }
  }
}

export function isUniform(compressed: CompressedChunk): compressed is UniformChunk {
  return compressed.kind === "uniform";
}

/** The single value of a uniform chunk, or undefined when the cells differ. */
export function uniformValue(compressed: CompressedChunk): number | undefined {
  return compressed.kind === "uniform" ? compressed.value : undefined;
}

/** Heap bytes this chunk holds. A uniform chunk is a shared singleton and costs nothing extra. */
export function byteSize(compressed: CompressedChunk): number {
  switch (compressed.kind) {
    case "uniform":
      return 0;
    case "raw":
      return COMPRESSED_HEADER_BYTES + compressed.cells.byteLength;
    case "palette":
      return COMPRESSED_HEADER_BYTES + compressed.palette.byteLength + compressed.packedIndices.byteLength;
    case "runs":
      return COMPRESSED_HEADER_BYTES + compressed.runStarts.byteLength + compressed.runValues.byteLength;
  }
}
