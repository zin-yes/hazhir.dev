// Reusable pixel-art painting primitives shared by every material family.

import { rampByDistribution, type Ramp, type Rgb } from "./color";
import type { Field } from "./noise";
import { TEXTURE_SIZE } from "./noise";
import type { Random } from "./random";
import { Texture } from "./texture";

export function paintPercentileRamp(
  texture: Texture,
  ramp: Ramp,
  percentileField: Field,
  weights?: readonly number[]
): Texture {
  return texture.paint((x, y) => rampByDistribution(ramp, percentileField(x, y), weights));
}

export function scatterPixels(
  texture: Texture,
  random: Random,
  count: number,
  colorChooser: () => Rgb,
  allowed?: (x: number, y: number) => boolean
): void {
  for (let placed = 0; placed < count; ) {
    const x = random.integer(0, TEXTURE_SIZE - 1);
    const y = random.integer(0, TEXTURE_SIZE - 1);
    if (allowed && !allowed(x, y)) {
      placed += 0.1;
      continue;
    }
    texture.set(x, y, colorChooser());
    placed++;
  }
}

export function scatterShapes(
  texture: Texture,
  random: Random,
  count: number,
  shapes: readonly (readonly [number, number][])[],
  colorChooser: () => Rgb
): void {
  for (let placed = 0; placed < count; placed++) {
    const shape = random.pick(shapes);
    const anchorX = random.integer(0, TEXTURE_SIZE - 1);
    const anchorY = random.integer(0, TEXTURE_SIZE - 1);
    const color = colorChooser();
    for (const [offsetX, offsetY] of shape) texture.set(anchorX + offsetX, anchorY + offsetY, color);
  }
}

export function drawLine(
  texture: Texture,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  colorAt: (stepIndex: number, stepCount: number) => Rgb | null
): void {
  const stepCount = Math.max(Math.abs(endX - startX), Math.abs(endY - startY));
  for (let step = 0; step <= stepCount; step++) {
    const progress = stepCount === 0 ? 0 : step / stepCount;
    const color = colorAt(step, stepCount);
    if (color) texture.set(startX + (endX - startX) * progress, startY + (endY - startY) * progress, color);
  }
}

export function drawFlatLine(
  texture: Texture,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  color: Rgb
): void {
  drawLine(texture, startX, startY, endX, endY, () => color);
}

/** Random-walk crack that keeps heading roughly in one direction and wraps around the tile. */
export function drawCrack(
  texture: Texture,
  random: Random,
  startX: number,
  startY: number,
  length: number,
  headingX: number,
  headingY: number,
  color: Rgb,
  wanderChance = 0.35
): void {
  let cursorX = startX;
  let cursorY = startY;
  for (let step = 0; step < length; step++) {
    texture.set(cursorX, cursorY, color);
    if (random.chance(wanderChance)) {
      if (headingX === 0) cursorX += random.chance(0.5) ? -1 : 1;
      else cursorY += random.chance(0.5) ? -1 : 1;
    }
    cursorX += headingX;
    cursorY += headingY;
  }
}

export function pixelNeighbors(texture: Texture, x: number, y: number) {
  return {
    above: texture.get(x, y - 1),
    below: texture.get(x, y + 1),
    left: texture.get(x - 1, y),
    right: texture.get(x + 1, y),
  };
}

/** Local grid of pixel columns for 1D-stripe helpers. */
export function columnSeries(length: number, valueAt: (column: number) => number): number[] {
  return Array.from({ length }, (_, column) => valueAt(column));
}

export const SMALL_BLOB_SHAPES: readonly (readonly [number, number][])[] = [
  [[0, 0], [1, 0]],
  [[0, 0], [0, 1]],
  [[0, 0], [1, 0], [0, 1]],
  [[0, 0], [1, 0], [1, 1]],
  [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [2, 0]],
];
