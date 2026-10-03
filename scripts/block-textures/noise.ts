// Tileable value noise, percentile ranking and wrapped Worley cell fields (all wrap at TEXTURE_SIZE).

import type { Random } from "./random";

export const TEXTURE_SIZE = 16;

export type Field = (x: number, y: number) => number;

function smoothStep(amount: number): number {
  return amount * amount * (3 - 2 * amount);
}

function wrapIndex(index: number, length: number): number {
  return ((index % length) + length) % length;
}

export function createValueNoise(random: Random, cellWidth: number, cellHeight: number = cellWidth): Field {
  const latticeColumns = Math.max(1, Math.round(TEXTURE_SIZE / cellWidth));
  const latticeRows = Math.max(1, Math.round(TEXTURE_SIZE / cellHeight));
  const lattice = Array.from({ length: latticeColumns * latticeRows }, () => random.next());
  return (x, y) => {
    const scaledX = x / cellWidth;
    const scaledY = y / cellHeight;
    const columnStart = Math.floor(scaledX);
    const rowStart = Math.floor(scaledY);
    const blendX = smoothStep(scaledX - columnStart);
    const blendY = smoothStep(scaledY - rowStart);
    const at = (column: number, row: number) =>
      lattice[wrapIndex(row, latticeRows) * latticeColumns + wrapIndex(column, latticeColumns)];
    const top = at(columnStart, rowStart) * (1 - blendX) + at(columnStart + 1, rowStart) * blendX;
    const bottom = at(columnStart, rowStart + 1) * (1 - blendX) + at(columnStart + 1, rowStart + 1) * blendX;
    return top * (1 - blendY) + bottom * blendY;
  };
}

export function createFractalNoise(
  random: Random,
  octaves: readonly { cellWidth: number; cellHeight?: number; weight: number }[]
): Field {
  const layers = octaves.map((octave) => ({
    field: createValueNoise(random, octave.cellWidth, octave.cellHeight ?? octave.cellWidth),
    weight: octave.weight,
  }));
  const totalWeight = layers.reduce((sum, layer) => sum + layer.weight, 0);
  return (x, y) => layers.reduce((sum, layer) => sum + layer.field(x, y) * layer.weight, 0) / totalWeight;
}

/** Replaces raw field values by their rank across the tile, so ramp coverage is exactly controllable. */
export function createPercentileField(field: Field): Field {
  const entries: { index: number; value: number }[] = [];
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      entries.push({ index: y * TEXTURE_SIZE + x, value: field(x, y) });
    }
  }
  entries.sort((first, second) => first.value - second.value || first.index - second.index);
  const percentiles = new Array<number>(entries.length);
  entries.forEach((entry, rank) => {
    percentiles[entry.index] = (rank + 0.5) / entries.length;
  });
  return (x, y) => percentiles[wrapIndex(y, TEXTURE_SIZE) * TEXTURE_SIZE + wrapIndex(x, TEXTURE_SIZE)];
}

export function createPercentileNoise(
  random: Random,
  octaves: readonly { cellWidth: number; cellHeight?: number; weight: number }[]
): Field {
  return createPercentileField(createFractalNoise(random, octaves));
}

/** One-dimensional wrapped noise, handy for wavy bands and ragged edges. */
export function createLineNoise(random: Random, cellLength: number): (position: number) => number {
  const field = createValueNoise(random, cellLength, TEXTURE_SIZE);
  return (position) => field(wrapIndex(position, TEXTURE_SIZE), 0);
}

export interface CellSample {
  cellIndex: number;
  nearestDistance: number;
  secondNearestDistance: number;
  offsetX: number;
  offsetY: number;
}

export interface CellFieldOptions {
  jitter?: number;
  staggerRows?: boolean;
}

/** Wrapped Worley field with `cellsPerSide` feature points per axis. */
export function createCellField(random: Random, cellsPerSide: number, options: CellFieldOptions = {}) {
  const jitter = options.jitter ?? 0.8;
  const cellPixels = TEXTURE_SIZE / cellsPerSide;
  const points: { x: number; y: number; index: number }[] = [];
  for (let row = 0; row < cellsPerSide; row++) {
    for (let column = 0; column < cellsPerSide; column++) {
      const stagger = options.staggerRows && row % 2 === 1 ? 0.5 : 0;
      points.push({
        x: (column + 0.5 + stagger + (random.next() - 0.5) * jitter) * cellPixels,
        y: (row + 0.5 + (random.next() - 0.5) * jitter) * cellPixels,
        index: row * cellsPerSide + column,
      });
    }
  }
  return (x: number, y: number): CellSample => {
    let nearest = { distance: Infinity, index: 0, offsetX: 0, offsetY: 0 };
    let secondDistance = Infinity;
    const pixelX = wrapIndex(x, TEXTURE_SIZE) + 0.5;
    const pixelY = wrapIndex(y, TEXTURE_SIZE) + 0.5;
    for (const point of points) {
      for (const shiftY of [-TEXTURE_SIZE, 0, TEXTURE_SIZE]) {
        for (const shiftX of [-TEXTURE_SIZE, 0, TEXTURE_SIZE]) {
          const offsetX = pixelX - (point.x + shiftX);
          const offsetY = pixelY - (point.y + shiftY);
          const distance = Math.hypot(offsetX, offsetY);
          if (distance < nearest.distance) {
            secondDistance = nearest.distance;
            nearest = { distance, index: point.index, offsetX, offsetY };
          } else if (distance < secondDistance) {
            secondDistance = distance;
          }
        }
      }
    }
    return {
      cellIndex: nearest.index,
      nearestDistance: nearest.distance,
      secondNearestDistance: secondDistance,
      offsetX: nearest.offsetX,
      offsetY: nearest.offsetY,
    };
  };
}
