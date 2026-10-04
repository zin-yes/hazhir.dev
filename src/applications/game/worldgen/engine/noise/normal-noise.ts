// Mirrors net.minecraft.world.level.levelgen.synth.NormalNoise: two PerlinNoise stacks summed, the second
// sampled at a slightly scaled input, normalized so the result has roughly a target deviation of 1/3.

import type { RandomSource } from "../random/random-source";
import { PerlinNoise } from "./perlin-noise";

/** The `minecraft:noise` registry entry shape. */
export interface NoiseParameters {
  firstOctave: number;
  amplitudes: number[];
}

const INPUT_FACTOR = 1.0181268882175227;
const TARGET_DEVIATION_HALF = 0.16666666666666666;
const INT_MAX = 2147483647;
const INT_MIN = -2147483648;

function expectedDeviation(octaveSpan: number): number {
  return 0.1 * (1.0 + 1.0 / (octaveSpan + 1));
}

export class NormalNoise {
  readonly parameters: NoiseParameters;
  readonly maxValue: number;
  private readonly valueFactor: number;
  private readonly first: PerlinNoise;
  private readonly second: PerlinNoise;

  static create(random: RandomSource, parameters: NoiseParameters): NormalNoise {
    return new NormalNoise(random, parameters, true);
  }

  /** Java `createLegacyNetherBiome`: legacy PerlinNoise initialization (only for legacy-random noise settings). */
  static createLegacyNetherBiome(random: RandomSource, parameters: NoiseParameters): NormalNoise {
    return new NormalNoise(random, parameters, false);
  }

  private constructor(random: RandomSource, parameters: NoiseParameters, useNewInitialization: boolean) {
    this.parameters = parameters;
    const { firstOctave, amplitudes } = parameters;
    this.first = PerlinNoise.create(random, firstOctave, amplitudes, useNewInitialization);
    this.second = PerlinNoise.create(random, firstOctave, amplitudes, useNewInitialization);
    let lowestNonZeroIndex = INT_MAX;
    let highestNonZeroIndex = INT_MIN;
    for (let index = 0; index < amplitudes.length; index++) {
      if (amplitudes[index] === 0.0) continue;
      lowestNonZeroIndex = Math.min(lowestNonZeroIndex, index);
      highestNonZeroIndex = Math.max(highestNonZeroIndex, index);
    }
    // Java int subtraction: with no non-zero amplitude this overflows to 1, which we reproduce.
    const octaveSpan = (highestNonZeroIndex - lowestNonZeroIndex) | 0;
    this.valueFactor = TARGET_DEVIATION_HALF / expectedDeviation(octaveSpan);
    this.maxValue = (this.first.maxValue + this.second.maxValue) * this.valueFactor;
  }

  getValue(x: number, y: number, z: number): number {
    const scaledX = x * INPUT_FACTOR;
    const scaledY = y * INPUT_FACTOR;
    const scaledZ = z * INPUT_FACTOR;
    return (this.first.getValue(x, y, z) + this.second.getValue(scaledX, scaledY, scaledZ)) * this.valueFactor;
  }
}
