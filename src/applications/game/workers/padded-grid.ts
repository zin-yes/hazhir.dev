import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "../config";
import type { ChunkFaceBuffers } from "./mesh-types";
import { PADDED_VOLUME, paddedIndex } from "./padded-layout";

const WORDS_PER_ROW = CHUNK_LENGTH / 4;

export interface PaddedGrid {
  cells: Uint8Array;
  words: Uint32Array;
}

function createPaddedGrid(): PaddedGrid {
  const cells = new Uint8Array(PADDED_VOLUME);
  return { cells, words: new Uint32Array(cells.buffer) };
}

/** Scratch grids reused by every mesh task, since a worker meshes one chunk at a time. */
export const paddedBlockGrid = createPaddedGrid();
export const paddedLightGrid = createPaddedGrid();

function copyRowWords(
  target: Uint32Array,
  targetCell: number,
  source: Uint32Array,
  sourceWord: number
) {
  const targetWord = targetCell >> 2;
  for (let word = 0; word < WORDS_PER_ROW; word++) {
    target[targetWord + word] = source[sourceWord + word];
  }
}

// Border layouts: top and bottom are [x * length + z], left and right are
// [y * length + z], back and front are [x * height + y].
function copyBorderSlabs(grid: PaddedGrid, borders: ChunkFaceBuffers) {
  const { cells, words } = grid;
  if (borders.left || borders.right) {
    const left = borders.left && new Uint32Array(borders.left);
    const right = borders.right && new Uint32Array(borders.right);
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      const sourceWord = y * WORDS_PER_ROW;
      if (left) copyRowWords(words, paddedIndex(-1, y, 0), left, sourceWord);
      if (right) copyRowWords(words, paddedIndex(CHUNK_WIDTH, y, 0), right, sourceWord);
    }
  }
  if (borders.bottom || borders.top) {
    const bottom = borders.bottom && new Uint32Array(borders.bottom);
    const top = borders.top && new Uint32Array(borders.top);
    for (let x = 0; x < CHUNK_WIDTH; x++) {
      const sourceWord = x * WORDS_PER_ROW;
      if (bottom) copyRowWords(words, paddedIndex(x, -1, 0), bottom, sourceWord);
      if (top) copyRowWords(words, paddedIndex(x, CHUNK_HEIGHT, 0), top, sourceWord);
    }
  }
  if (borders.back || borders.front) {
    const back = borders.back && new Uint8Array(borders.back);
    const front = borders.front && new Uint8Array(borders.front);
    for (let x = 0; x < CHUNK_WIDTH; x++) {
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        if (back) cells[paddedIndex(x, y, -1)] = back[x * CHUNK_HEIGHT + y];
        if (front) cells[paddedIndex(x, y, CHUNK_LENGTH)] = front[x * CHUNK_HEIGHT + y];
      }
    }
  }
}

/**
 * Copies the chunk and the slabs of its loaded neighbors into the padded grid.
 * With clearFirst, cells of missing slabs read as 0 (air for blocks).
 */
export function fillPaddedGrid(
  grid: PaddedGrid,
  chunkBuffer: ArrayBuffer,
  borders: ChunkFaceBuffers,
  clearFirst: boolean
) {
  if (clearFirst) grid.cells.fill(0);
  const chunkWords = new Uint32Array(chunkBuffer);
  for (let x = 0; x < CHUNK_WIDTH; x++) {
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      copyRowWords(
        grid.words,
        paddedIndex(x, y, 0),
        chunkWords,
        (x * CHUNK_HEIGHT + y) * WORDS_PER_ROW
      );
    }
  }
  copyBorderSlabs(grid, borders);
}
