import type { GrainPalette } from "./grain-palette";

const EMPTY_CELL = 0;
const STRATUM_WIDTH_CELLS = 18;
const STRATUM_CHANGE_FRAMES = 140;

/** Falling-sand cellular automaton whose grains are texture pixels. */
export class SandGrid {
  readonly cells: Uint32Array;
  grainCount = 0;
  private frame = 0;

  constructor(
    readonly columns: number,
    readonly rows: number,
    private readonly palette: GrainPalette,
  ) {
    this.cells = new Uint32Array(columns * rows);
  }

  get capacity() {
    return this.columns * this.rows;
  }

  private pickGrainColor(column: number): number {
    const stratum =
      Math.floor(column / STRATUM_WIDTH_CELLS) +
      Math.floor(this.frame / STRATUM_CHANGE_FRAMES) * 5;
    const textureIndex =
      Math.abs(Math.imul(stratum, 2654435761)) %
      this.palette.texturePixels.length;
    const pixels = this.palette.texturePixels[textureIndex];
    return pixels[Math.floor(Math.random() * pixels.length)];
  }

  spawnGrains(grainCount: number) {
    for (let spawned = 0; spawned < grainCount; spawned++) {
      const column = Math.floor(Math.random() * this.columns);
      if (this.cells[column] !== EMPTY_CELL) continue;
      this.cells[column] = this.pickGrainColor(column);
      this.grainCount++;
    }
  }

  drainBottomGrain() {
    const column = Math.floor(Math.random() * this.columns);
    const bottomIndex = (this.rows - 1) * this.columns + column;
    if (this.cells[bottomIndex] === EMPTY_CELL) return;
    this.cells[bottomIndex] = EMPTY_CELL;
    this.grainCount--;
  }

  step() {
    this.frame++;
    const { columns, rows, cells } = this;
    const sweepLeftToRight = this.frame % 2 === 0;
    for (let row = rows - 2; row >= 0; row--) {
      for (let offset = 0; offset < columns; offset++) {
        const column = sweepLeftToRight ? offset : columns - 1 - offset;
        const index = row * columns + column;
        const color = cells[index];
        if (color === EMPTY_CELL) continue;

        const below = index + columns;
        if (cells[below] === EMPTY_CELL) {
          cells[below] = color;
          cells[index] = EMPTY_CELL;
          continue;
        }

        const preferLeft = Math.random() < 0.5;
        const firstColumn = column + (preferLeft ? -1 : 1);
        const secondColumn = column + (preferLeft ? 1 : -1);
        for (const slideColumn of [firstColumn, secondColumn]) {
          if (slideColumn < 0 || slideColumn >= columns) continue;
          const slideIndex = below - column + slideColumn;
          if (cells[slideIndex] === EMPTY_CELL) {
            cells[slideIndex] = color;
            cells[index] = EMPTY_CELL;
            break;
          }
        }
      }
    }
  }
}
