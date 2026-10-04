import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "../config";
import {
  BLOCK_ROW_FLAGS,
  ROW_FLAG_CUBE_OCCLUDER,
  ROW_FLAG_OCCLUDER,
  ROW_FLAG_SOLID,
} from "./mesh-tables";
import { paddedBlockGrid } from "./padded-grid";
import { PADDED_ROWS, paddedIndex } from "./padded-layout";

/**
 * One bitmask per row of cells along z (bit z is set when the block at that z is
 * of the kind). Rows include the one row of neighbor blocks around the chunk on
 * x and y so that a row can look at the rows beside it.
 */
export const solidRows = new Int32Array(34 * PADDED_ROWS);
export const occluderRows = new Int32Array(34 * PADDED_ROWS);
export const cubeOccluderRows = new Int32Array(34 * PADDED_ROWS);

const ALL_CELLS = -1;
const WORDS_PER_ROW = CHUNK_LENGTH / 4;

export function rowIndexOf(x: number, y: number): number {
  return (x + 1) * PADDED_ROWS + (y + 1);
}

function classifyRow(x: number, y: number) {
  const { cells, words } = paddedBlockGrid;
  const rowIndex = rowIndexOf(x, y);
  const firstCell = paddedIndex(x, y, 0);
  const firstWord = firstCell >> 2;

  const firstWordValue = words[firstWord];
  let isUniform = true;
  for (let word = 1; word < WORDS_PER_ROW; word++) {
    if (words[firstWord + word] !== firstWordValue) {
      isUniform = false;
      break;
    }
  }
  const uniformBlock = firstWordValue & 0xff;
  if (isUniform && firstWordValue === uniformBlock * 0x01010101) {
    const flags = BLOCK_ROW_FLAGS[uniformBlock];
    solidRows[rowIndex] = flags & ROW_FLAG_SOLID ? ALL_CELLS : 0;
    occluderRows[rowIndex] = flags & ROW_FLAG_OCCLUDER ? ALL_CELLS : 0;
    cubeOccluderRows[rowIndex] = flags & ROW_FLAG_CUBE_OCCLUDER ? ALL_CELLS : 0;
    return;
  }

  let solid = 0;
  let occluder = 0;
  let cubeOccluder = 0;
  for (let z = 0; z < CHUNK_LENGTH; z++) {
    const flags = BLOCK_ROW_FLAGS[cells[firstCell + z]];
    solid |= (flags & ROW_FLAG_SOLID) << z;
    occluder |= ((flags >> 1) & 1) << z;
    cubeOccluder |= ((flags >> 2) & 1) << z;
  }
  solidRows[rowIndex] = solid;
  occluderRows[rowIndex] = occluder;
  cubeOccluderRows[rowIndex] = cubeOccluder;
}

/** Classifies every row of the chunk and the neighbor rows its edge rows read. */
export function buildRowOccupancy() {
  for (let x = 0; x < CHUNK_WIDTH; x++) {
    for (let y = 0; y < CHUNK_HEIGHT; y++) classifyRow(x, y);
  }
  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    classifyRow(-1, y);
    classifyRow(CHUNK_WIDTH, y);
  }
  for (let x = 0; x < CHUNK_WIDTH; x++) {
    classifyRow(x, -1);
    classifyRow(x, CHUNK_HEIGHT);
  }
}

/**
 * The cells of a row that can emit a face: solid cells, except cube blocks
 * buried among occluders on all six sides. Neighbors along z are the row
 * shifted by one, with the neighbor chunk's cell entering at the ends.
 */
export function visibleCellsOfRow(x: number, y: number): number {
  const rowIndex = rowIndexOf(x, y);
  const solid = solidRows[rowIndex];
  if (solid === 0) return 0;
  const occluder = occluderRows[rowIndex];
  const firstCell = paddedIndex(x, y, 0);
  const blocks = paddedBlockGrid.cells;
  const occluderBeforeEnd = BLOCK_ROW_FLAGS[blocks[firstCell - 1]] & ROW_FLAG_OCCLUDER ? 1 : 0;
  const occluderAfterEnd = BLOCK_ROW_FLAGS[blocks[firstCell + CHUNK_LENGTH]] & ROW_FLAG_OCCLUDER ? 1 : 0;
  const buried =
    cubeOccluderRows[rowIndex] &
    occluderRows[rowIndex - PADDED_ROWS] &
    occluderRows[rowIndex + PADDED_ROWS] &
    occluderRows[rowIndex - 1] &
    occluderRows[rowIndex + 1] &
    ((occluder << 1) | occluderBeforeEnd) &
    ((occluder >>> 1) | (occluderAfterEnd << 31));
  return solid & ~buried;
}
