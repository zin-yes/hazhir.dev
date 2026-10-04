// Mirrors net.minecraft.world.level.levelgen.synth.PerlinNoise: a stack of ImprovedNoise octaves.

import type { RandomSource } from "../random/random-source";
import { ImprovedNoise } from "./improved-noise";

/** PerlinNoise.ROUND_OFF = 2^25: inputs are wrapped into [-2^24, 2^24] to keep precision far from the origin. */
const ROUND_OFF = 33554432.0;

/** Java `PerlinNoise.wrap`. */
export function wrapNoiseCoordinate(value: number): number {
  return value - Math.floor(value / ROUND_OFF + 0.5) * ROUND_OFF;
}

/** PerlinNoise.makeAmplitudes: a sorted octave set becomes (firstOctave, 1.0 at each listed octave). */
function amplitudesFromOctaves(octaves: number[]): { firstOctave: number; amplitudes: number[] } {
  if (octaves.length === 0) throw new Error("Need some octaves!");
  const sortedOctaves = [...new Set(octaves)].sort((first, second) => first - second);
  const negativeFirstOctave = -sortedOctaves[0];
  const lastOctave = sortedOctaves[sortedOctaves.length - 1];
  const octaveCount = negativeFirstOctave + lastOctave + 1;
  if (octaveCount < 1) throw new Error("Total number of octaves needs to be >= 1");
  const amplitudes = new Array<number>(octaveCount).fill(0.0);
  for (const octave of sortedOctaves) amplitudes[octave + negativeFirstOctave] = 1.0;
  return { firstOctave: -negativeFirstOctave, amplitudes };
}

export class PerlinNoise {
  readonly firstOctave: number;
  readonly amplitudes: readonly number[];
  /** Indexed by octave slot (lowest frequency first); null where the amplitude is zero. */
  private readonly noiseLevels: (ImprovedNoise | null)[];
  private readonly lowestFreqInputFactor: number;
  private readonly lowestFreqValueFactor: number;
  readonly maxValue: number;
  // Hot-path view of the non-null octaves, with the per-slot factors Java derives by repeated doubling and halving.
  private readonly activeNoises: ImprovedNoise[];
  private readonly activeAmplitudes: Float64Array;
  private readonly activeInputFactors: Float64Array;
  private readonly activeValueFactors: Float64Array;

  /** Java `PerlinNoise.create(random, firstOctave, amplitudes)` (`useNewInitialization` true unless legacy). */
  static create(
    random: RandomSource,
    firstOctave: number,
    amplitudes: readonly number[],
    useNewInitialization = true,
  ): PerlinNoise {
    return new PerlinNoise(random, firstOctave, amplitudes, useNewInitialization);
  }

  /** Java `PerlinNoise.create(random, List<Integer> octaves)`. */
  static createFromOctaves(random: RandomSource, octaves: number[]): PerlinNoise {
    const { firstOctave, amplitudes } = amplitudesFromOctaves(octaves);
    return new PerlinNoise(random, firstOctave, amplitudes, true);
  }

  /** Java `PerlinNoise.createLegacyForBlendedNoise(random, IntStream octaves)`. */
  static createLegacyForBlendedNoise(random: RandomSource, octaves: number[]): PerlinNoise {
    const { firstOctave, amplitudes } = amplitudesFromOctaves(octaves);
    return new PerlinNoise(random, firstOctave, amplitudes, false);
  }

  private constructor(
    random: RandomSource,
    firstOctave: number,
    amplitudes: readonly number[],
    useNewInitialization: boolean,
  ) {
    this.firstOctave = firstOctave;
    this.amplitudes = amplitudes.slice();
    const octaveCount = amplitudes.length;
    const negativeFirstOctave = -firstOctave;
    this.noiseLevels = new Array<ImprovedNoise | null>(octaveCount).fill(null);
    if (useNewInitialization) {
      const positionalRandom = random.forkPositional();
      for (let slot = 0; slot < octaveCount; slot++) {
        if (amplitudes[slot] === 0.0) continue;
        const octave = firstOctave + slot;
        this.noiseLevels[slot] = new ImprovedNoise(positionalRandom.fromHashOf(`octave_${octave}`));
      }
    } else {
      // Legacy initialization: the zero octave is created first, then lower octaves in descending order,
      // skipping 262 random calls (one ImprovedNoise construction) for each zero amplitude.
      const zeroOctaveNoise = new ImprovedNoise(random);
      if (negativeFirstOctave >= 0 && negativeFirstOctave < octaveCount && amplitudes[negativeFirstOctave] !== 0.0) {
        this.noiseLevels[negativeFirstOctave] = zeroOctaveNoise;
      }
      for (let slot = negativeFirstOctave - 1; slot >= 0; slot--) {
        if (slot < octaveCount && amplitudes[slot] !== 0.0) {
          this.noiseLevels[slot] = new ImprovedNoise(random);
        } else {
          random.skip(262);
        }
      }
      const createdCount = this.noiseLevels.filter((noise) => noise !== null).length;
      const nonZeroCount = amplitudes.filter((amplitude) => amplitude !== 0.0).length;
      if (createdCount !== nonZeroCount) {
        throw new Error("Failed to create correct number of noise levels for given non-zero amplitudes");
      }
      if (negativeFirstOctave < octaveCount - 1) throw new Error("Positive octaves are temporarily disabled");
    }
    this.lowestFreqInputFactor = Math.pow(2.0, -negativeFirstOctave);
    this.lowestFreqValueFactor = Math.pow(2.0, octaveCount - 1) / (Math.pow(2.0, octaveCount) - 1.0);

    const activeNoises: ImprovedNoise[] = [];
    const activeAmplitudes: number[] = [];
    const activeInputFactors: number[] = [];
    const activeValueFactors: number[] = [];
    let inputFactor = this.lowestFreqInputFactor;
    let valueFactor = this.lowestFreqValueFactor;
    for (let slot = 0; slot < octaveCount; slot++) {
      const noise = this.noiseLevels[slot];
      if (noise !== null) {
        activeNoises.push(noise);
        activeAmplitudes.push(amplitudes[slot]);
        activeInputFactors.push(inputFactor);
        activeValueFactors.push(valueFactor);
      }
      inputFactor *= 2.0;
      valueFactor /= 2.0;
    }
    this.activeNoises = activeNoises;
    this.activeAmplitudes = new Float64Array(activeAmplitudes);
    this.activeInputFactors = new Float64Array(activeInputFactors);
    this.activeValueFactors = new Float64Array(activeValueFactors);
    this.maxValue = this.edgeValue(2.0);
  }

  /** Java `getValue(x, y, z)`. */
  getValue(x: number, y: number, z: number): number {
    let total = 0.0;
    const noises = this.activeNoises;
    const amplitudes = this.activeAmplitudes;
    const inputFactors = this.activeInputFactors;
    const valueFactors = this.activeValueFactors;
    for (let index = 0; index < noises.length; index++) {
      const inputFactor = inputFactors[index];
      const octaveValue = noises[index].noise(
        wrapNoiseCoordinate(x * inputFactor),
        wrapNoiseCoordinate(y * inputFactor),
        wrapNoiseCoordinate(z * inputFactor),
      );
      total += amplitudes[index] * octaveValue * valueFactors[index];
    }
    return total;
  }

  /** Java's deprecated `getValue(x, y, z, yScale, yMax, useFixedY)`. */
  getValueWithYScale(x: number, y: number, z: number, yScale: number, yMax: number, useFixedY: boolean): number {
    let total = 0.0;
    const noises = this.activeNoises;
    for (let index = 0; index < noises.length; index++) {
      const noise = noises[index];
      const inputFactor = this.activeInputFactors[index];
      const octaveValue = noise.noiseWithYScale(
        wrapNoiseCoordinate(x * inputFactor),
        useFixedY ? -noise.yOffset : wrapNoiseCoordinate(y * inputFactor),
        wrapNoiseCoordinate(z * inputFactor),
        yScale * inputFactor,
        yMax * inputFactor,
      );
      total += this.activeAmplitudes[index] * octaveValue * this.activeValueFactors[index];
    }
    return total;
  }

  /** Java `maxBrokenValue(yMultiplier)`. */
  maxBrokenValue(yMultiplier: number): number {
    return this.edgeValue(yMultiplier + 2.0);
  }

  private edgeValue(multiplier: number): number {
    let total = 0.0;
    for (let index = 0; index < this.activeNoises.length; index++) {
      total += this.activeAmplitudes[index] * multiplier * this.activeValueFactors[index];
    }
    return total;
  }

  /** Java `getOctaveNoise(i)`: octave 0 is the highest frequency (last slot). */
  getOctaveNoise(octaveFromHighest: number): ImprovedNoise | null {
    return this.noiseLevels[this.noiseLevels.length - 1 - octaveFromHighest] ?? null;
  }
}
