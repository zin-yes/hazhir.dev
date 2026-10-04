// Mirrors net.minecraft.world.level.levelgen.synth.SimplexNoise (end islands, PerlinSimplexNoise).

import type { RandomSource } from "../random/random-source";
import { GRADIENT_X, GRADIENT_Y, GRADIENT_Z } from "./improved-noise";

const SQRT_3 = Math.sqrt(3.0);
const SKEW_2D = 0.5 * (SQRT_3 - 1.0);
const UNSKEW_2D = (3.0 - SQRT_3) / 6.0;
const ONE_THIRD = 0.3333333333333333;
const ONE_SIXTH = 0.16666666666666666;

function cornerNoise(gradientIndex: number, x: number, y: number, z: number, radiusSquared: number): number {
  let falloff = radiusSquared - x * x - y * y - z * z;
  if (falloff < 0.0) return 0.0;
  falloff *= falloff;
  return (
    falloff *
    falloff *
    (GRADIENT_X[gradientIndex] * x + GRADIENT_Y[gradientIndex] * y + GRADIENT_Z[gradientIndex] * z)
  );
}

export class SimplexNoise {
  readonly xOffset: number;
  readonly yOffset: number;
  readonly zOffset: number;
  private readonly permutation: Int32Array;

  constructor(random: RandomSource) {
    this.xOffset = random.nextDouble() * 256.0;
    this.yOffset = random.nextDouble() * 256.0;
    this.zOffset = random.nextDouble() * 256.0;
    const permutation = new Int32Array(256);
    for (let index = 0; index < 256; index++) permutation[index] = index;
    for (let index = 0; index < 256; index++) {
      const swapOffset = random.nextIntBounded(256 - index);
      const swapped = permutation[index];
      permutation[index] = permutation[swapOffset + index];
      permutation[swapOffset + index] = swapped;
    }
    this.permutation = permutation;
  }

  private hash(value: number): number {
    return this.permutation[value & 255];
  }

  /** Java `getValue(double x, double y)`. */
  getValue2D(x: number, y: number): number {
    const skew = (x + y) * SKEW_2D;
    const cellX = Math.floor(x + skew);
    const cellY = Math.floor(y + skew);
    const unskew = (cellX + cellY) * UNSKEW_2D;
    const originX = cellX - unskew;
    const originY = cellY - unskew;
    const localX = x - originX;
    const localY = y - originY;
    let middleOffsetX: number;
    let middleOffsetY: number;
    if (localX > localY) {
      middleOffsetX = 1;
      middleOffsetY = 0;
    } else {
      middleOffsetX = 0;
      middleOffsetY = 1;
    }
    const middleX = localX - middleOffsetX + UNSKEW_2D;
    const middleY = localY - middleOffsetY + UNSKEW_2D;
    const farX = localX - 1.0 + 2.0 * UNSKEW_2D;
    const farY = localY - 1.0 + 2.0 * UNSKEW_2D;
    const wrappedX = cellX & 255;
    const wrappedY = cellY & 255;
    const gradientOrigin = this.hash(wrappedX + this.hash(wrappedY)) % 12;
    const gradientMiddle = this.hash(wrappedX + middleOffsetX + this.hash(wrappedY + middleOffsetY)) % 12;
    const gradientFar = this.hash(wrappedX + 1 + this.hash(wrappedY + 1)) % 12;
    const originContribution = cornerNoise(gradientOrigin, localX, localY, 0.0, 0.5);
    const middleContribution = cornerNoise(gradientMiddle, middleX, middleY, 0.0, 0.5);
    const farContribution = cornerNoise(gradientFar, farX, farY, 0.0, 0.5);
    return 70.0 * (originContribution + middleContribution + farContribution);
  }

  /** Java `getValue(double x, double y, double z)`. */
  getValue3D(x: number, y: number, z: number): number {
    const skew = (x + y + z) * ONE_THIRD;
    const cellX = Math.floor(x + skew);
    const cellY = Math.floor(y + skew);
    const cellZ = Math.floor(z + skew);
    const unskew = (cellX + cellY + cellZ) * ONE_SIXTH;
    const localX = x - (cellX - unskew);
    const localY = y - (cellY - unskew);
    const localZ = z - (cellZ - unskew);
    let firstX: number, firstY: number, firstZ: number, secondX: number, secondY: number, secondZ: number;
    if (localX >= localY) {
      if (localY >= localZ) {
        firstX = 1; firstY = 0; firstZ = 0; secondX = 1; secondY = 1; secondZ = 0;
      } else if (localX >= localZ) {
        firstX = 1; firstY = 0; firstZ = 0; secondX = 1; secondY = 0; secondZ = 1;
      } else {
        firstX = 0; firstY = 0; firstZ = 1; secondX = 1; secondY = 0; secondZ = 1;
      }
    } else if (localY < localZ) {
      firstX = 0; firstY = 0; firstZ = 1; secondX = 0; secondY = 1; secondZ = 1;
    } else if (localX < localZ) {
      firstX = 0; firstY = 1; firstZ = 0; secondX = 0; secondY = 1; secondZ = 1;
    } else {
      firstX = 0; firstY = 1; firstZ = 0; secondX = 1; secondY = 1; secondZ = 0;
    }
    const firstCornerX = localX - firstX + ONE_SIXTH;
    const firstCornerY = localY - firstY + ONE_SIXTH;
    const firstCornerZ = localZ - firstZ + ONE_SIXTH;
    const secondCornerX = localX - secondX + ONE_THIRD;
    const secondCornerY = localY - secondY + ONE_THIRD;
    const secondCornerZ = localZ - secondZ + ONE_THIRD;
    const farX = localX - 1.0 + 0.5;
    const farY = localY - 1.0 + 0.5;
    const farZ = localZ - 1.0 + 0.5;
    const wrappedX = cellX & 255;
    const wrappedY = cellY & 255;
    const wrappedZ = cellZ & 255;
    const gradientOrigin = this.hash(wrappedX + this.hash(wrappedY + this.hash(wrappedZ))) % 12;
    const gradientFirst =
      this.hash(wrappedX + firstX + this.hash(wrappedY + firstY + this.hash(wrappedZ + firstZ))) % 12;
    const gradientSecond =
      this.hash(wrappedX + secondX + this.hash(wrappedY + secondY + this.hash(wrappedZ + secondZ))) % 12;
    const gradientFar = this.hash(wrappedX + 1 + this.hash(wrappedY + 1 + this.hash(wrappedZ + 1))) % 12;
    const originContribution = cornerNoise(gradientOrigin, localX, localY, localZ, 0.6);
    const firstContribution = cornerNoise(gradientFirst, firstCornerX, firstCornerY, firstCornerZ, 0.6);
    const secondContribution = cornerNoise(gradientSecond, secondCornerX, secondCornerY, secondCornerZ, 0.6);
    const farContribution = cornerNoise(gradientFar, farX, farY, farZ, 0.6);
    return 32.0 * (originContribution + firstContribution + secondContribution + farContribution);
  }
}
