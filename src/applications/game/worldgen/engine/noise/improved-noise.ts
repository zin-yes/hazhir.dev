// Mirrors net.minecraft.world.level.levelgen.synth.ImprovedNoise: one octave of 3D Perlin noise.
// Operation order (smoothstep, lerp, gradient dot) is kept literal so results match Java to the last bit.

import type { RandomSource } from "../random/random-source";

// SimplexNoise.GRADIENT, split into components. ImprovedNoise indexes it with `hash & 0xF`.
export const GRADIENT_X = new Float64Array([1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0, 1, 0, -1, 0]);
export const GRADIENT_Y = new Float64Array([1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1]);
export const GRADIENT_Z = new Float64Array([0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1, 0, 1, 0, -1]);

const MEMO_X = 0;
const MEMO_Z = 1;
const MEMO_LOCAL_X = 2;
const MEMO_LOCAL_Z = 3;
const MEMO_SMOOTH_X = 4;
const MEMO_SMOOTH_Z = 5;
const MEMO_Y_OFFSET = 6;

/** Java `(double)1.0E-7f`. */
const SHIFT_UP_EPSILON = Math.fround(1.0e-7);

function smoothstep(value: number): number {
  return value * value * value * (value * (value * 6.0 - 15.0) + 10.0);
}

function lerp(delta: number, start: number, end: number): number {
  return start + delta * (end - start);
}

function gradientDot(hash: number, x: number, y: number, z: number): number {
  const index = hash & 15;
  return GRADIENT_X[index] * x + GRADIENT_Y[index] * y + GRADIENT_Z[index] * z;
}

export class ImprovedNoise {
  readonly xOffset: number;
  readonly yOffset: number;
  readonly zOffset: number;
  /** Permutation table `p` (Java byte[256], read back as `p[i & 0xFF] & 0xFF`). */
  readonly permutation: Uint8Array;

  constructor(random: RandomSource) {
    this.xOffset = random.nextDouble() * 256.0;
    this.yOffset = random.nextDouble() * 256.0;
    this.zOffset = random.nextDouble() * 256.0;
    const permutation = new Uint8Array(256);
    for (let index = 0; index < 256; index++) permutation[index] = index;
    for (let index = 0; index < 256; index++) {
      const swapOffset = random.nextIntBounded(256 - index);
      const swapped = permutation[index];
      permutation[index] = permutation[index + swapOffset];
      permutation[index + swapOffset] = swapped;
    }
    this.permutation = permutation;
    this.columnMemo[MEMO_Y_OFFSET] = this.yOffset;
  }

  // The x and z halves of the lattice lookup for the last (x, z) sampled. Density functions sample corner columns
  // (fixed x and z, many y), so most samples reuse them; the values are the ones sampleAndLerp would compute.
  // Doubles sit in a Float64Array: V8 boxes double-valued object fields, typed arrays hold them raw.
  private readonly columnMemo = new Float64Array([Number.NaN, Number.NaN, 0, 0, 0, 0, 0]);
  private memoCellZ = 0;
  private memoHashX0 = 0;
  private memoHashX1 = 0;

  private prepareColumn(x: number, z: number): void {
    const shiftedX = x + this.xOffset;
    const shiftedZ = z + this.zOffset;
    const cellX = Math.floor(shiftedX);
    const cellZ = Math.floor(shiftedZ);
    const localX = shiftedX - cellX;
    const localZ = shiftedZ - cellZ;
    const memo = this.columnMemo;
    memo[MEMO_X] = x;
    memo[MEMO_Z] = z;
    memo[MEMO_LOCAL_X] = localX;
    memo[MEMO_LOCAL_Z] = localZ;
    memo[MEMO_SMOOTH_X] = smoothstep(localX);
    memo[MEMO_SMOOTH_Z] = smoothstep(localZ);
    this.memoCellZ = cellZ;
    this.memoHashX0 = this.permutation[cellX & 255]!;
    this.memoHashX1 = this.permutation[(cellX + 1) & 255]!;
  }

  /** Java `noise(x, y, z)`. */
  noise(x: number, y: number, z: number): number {
    const memo = this.columnMemo;
    if (x !== memo[MEMO_X] || z !== memo[MEMO_Z]) this.prepareColumn(x, z);
    const shiftedY = y + memo[MEMO_Y_OFFSET]!;
    const cellY = Math.floor(shiftedY);
    const localY = shiftedY - cellY;
    return this.sampleAndLerp(cellY, localY, localY);
  }

  /** Java's deprecated `noise(x, y, z, yScale, yMax)`, used by BlendedNoise to smear the y lattice. */
  noiseWithYScale(x: number, y: number, z: number, yScale: number, yMax: number): number {
    const memo = this.columnMemo;
    if (x !== memo[MEMO_X] || z !== memo[MEMO_Z]) this.prepareColumn(x, z);
    const shiftedY = y + memo[MEMO_Y_OFFSET]!;
    const cellY = Math.floor(shiftedY);
    const localY = shiftedY - cellY;
    let yShift = 0.0;
    if (yScale !== 0.0) {
      const clampedY = yMax >= 0.0 && yMax < localY ? yMax : localY;
      yShift = Math.floor(clampedY / yScale + SHIFT_UP_EPSILON) * yScale;
    }
    return this.sampleAndLerp(cellY, localY - yShift, localY);
  }

  /** ImprovedNoise.sampleAndLerp for the prepared (x, z) column. */
  private sampleAndLerp(cellY: number, localY: number, localYForSmoothing: number): number {
    const permutation = this.permutation;
    const cellZ = this.memoCellZ;
    const memo = this.columnMemo;
    const localX = memo[MEMO_LOCAL_X]!;
    const localZ = memo[MEMO_LOCAL_Z]!;
    const hashX0 = this.memoHashX0;
    const hashX1 = this.memoHashX1;
    const hashX0Y0 = permutation[(hashX0 + cellY) & 255]!;
    const hashX0Y1 = permutation[(hashX0 + cellY + 1) & 255]!;
    const hashX1Y0 = permutation[(hashX1 + cellY) & 255]!;
    const hashX1Y1 = permutation[(hashX1 + cellY + 1) & 255]!;
    const corner000 = gradientDot(permutation[(hashX0Y0 + cellZ) & 255]!, localX, localY, localZ);
    const corner100 = gradientDot(permutation[(hashX1Y0 + cellZ) & 255]!, localX - 1.0, localY, localZ);
    const corner010 = gradientDot(permutation[(hashX0Y1 + cellZ) & 255]!, localX, localY - 1.0, localZ);
    const corner110 = gradientDot(permutation[(hashX1Y1 + cellZ) & 255]!, localX - 1.0, localY - 1.0, localZ);
    const corner001 = gradientDot(permutation[(hashX0Y0 + cellZ + 1) & 255]!, localX, localY, localZ - 1.0);
    const corner101 = gradientDot(permutation[(hashX1Y0 + cellZ + 1) & 255]!, localX - 1.0, localY, localZ - 1.0);
    const corner011 = gradientDot(permutation[(hashX0Y1 + cellZ + 1) & 255]!, localX, localY - 1.0, localZ - 1.0);
    const corner111 = gradientDot(permutation[(hashX1Y1 + cellZ + 1) & 255]!, localX - 1.0, localY - 1.0, localZ - 1.0);
    const smoothX = memo[MEMO_SMOOTH_X]!;
    const smoothY = smoothstep(localYForSmoothing);
    const smoothZ = memo[MEMO_SMOOTH_Z]!;
    // Mth.lerp3(dx, dy, dz, ...) = lerp(dz, lerp2(dx, dy, z0 corners), lerp2(dx, dy, z1 corners))
    return lerp(
      smoothZ,
      lerp(smoothY, lerp(smoothX, corner000, corner100), lerp(smoothX, corner010, corner110)),
      lerp(smoothY, lerp(smoothX, corner001, corner101), lerp(smoothX, corner011, corner111)),
    );
  }
}
