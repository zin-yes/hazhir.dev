// Mirrors net.minecraft.world.level.levelgen.synth.BlendedNoise (density function `minecraft:old_blended_noise`):
// an 8-octave "main" noise picks, per point, a blend between two 16-octave limit noises.
// RandomState seeds it with `root.fromHashOf("minecraft:terrain")` when the settings use Xoroshiro.

import type { RandomSource } from "../random/random-source";
import type { ImprovedNoise } from "./improved-noise";
import { PerlinNoise, wrapNoiseCoordinate } from "./perlin-noise";

const BASE_SCALE = 684.412;
const LIMIT_OCTAVES = [-15, -14, -13, -12, -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0];
const MAIN_OCTAVES = [-7, -6, -5, -4, -3, -2, -1, 0];

function clampedLerp(start: number, end: number, delta: number): number {
  if (delta < 0.0) return start;
  if (delta > 1.0) return end;
  return start + delta * (end - start);
}

export class BlendedNoise {
  readonly minValue: number;
  readonly maxValue: number;
  private readonly xzMultiplier: number;
  private readonly yMultiplier: number;
  // Octave noises indexed from the highest frequency (Java `getOctaveNoise(i)`), null-free for these octave sets.
  private readonly minLimitOctaves: (ImprovedNoise | null)[];
  private readonly maxLimitOctaves: (ImprovedNoise | null)[];
  private readonly mainOctaves: (ImprovedNoise | null)[];

  constructor(
    random: RandomSource,
    readonly xzScale: number,
    readonly yScale: number,
    readonly xzFactor: number,
    readonly yFactor: number,
    readonly smearScaleMultiplier: number,
  ) {
    const minLimitNoise = PerlinNoise.createLegacyForBlendedNoise(random, LIMIT_OCTAVES);
    const maxLimitNoise = PerlinNoise.createLegacyForBlendedNoise(random, LIMIT_OCTAVES);
    const mainNoise = PerlinNoise.createLegacyForBlendedNoise(random, MAIN_OCTAVES);
    this.minLimitOctaves = LIMIT_OCTAVES.map((_, octave) => minLimitNoise.getOctaveNoise(octave));
    this.maxLimitOctaves = LIMIT_OCTAVES.map((_, octave) => maxLimitNoise.getOctaveNoise(octave));
    this.mainOctaves = MAIN_OCTAVES.map((_, octave) => mainNoise.getOctaveNoise(octave));
    this.xzMultiplier = BASE_SCALE * xzScale;
    this.yMultiplier = BASE_SCALE * yScale;
    this.maxValue = minLimitNoise.maxBrokenValue(this.yMultiplier);
    this.minValue = -this.maxValue;
  }

  /** Java `compute(FunctionContext)` at integer block coordinates. */
  compute(blockX: number, blockY: number, blockZ: number): number {
    const limitX = blockX * this.xzMultiplier;
    const limitY = blockY * this.yMultiplier;
    const limitZ = blockZ * this.xzMultiplier;
    const mainX = limitX / this.xzFactor;
    const mainY = limitY / this.yFactor;
    const mainZ = limitZ / this.xzFactor;
    const limitSmear = this.yMultiplier * this.smearScaleMultiplier;
    const mainSmear = limitSmear / this.yFactor;
    let minLimitTotal = 0.0;
    let maxLimitTotal = 0.0;
    let mainTotal = 0.0;
    let frequency = 1.0;
    for (let octave = 0; octave < 8; octave++) {
      const noise = this.mainOctaves[octave];
      if (noise !== null) {
        mainTotal +=
          noise.noiseWithYScale(
            wrapNoiseCoordinate(mainX * frequency),
            wrapNoiseCoordinate(mainY * frequency),
            wrapNoiseCoordinate(mainZ * frequency),
            mainSmear * frequency,
            mainY * frequency,
          ) / frequency;
      }
      frequency /= 2.0;
    }
    const blendFactor = (mainTotal / 10.0 + 1.0) / 2.0;
    const onlyMaxLimit = blendFactor >= 1.0;
    const onlyMinLimit = blendFactor <= 0.0;
    frequency = 1.0;
    for (let octave = 0; octave < 16; octave++) {
      const wrappedX = wrapNoiseCoordinate(limitX * frequency);
      const wrappedY = wrapNoiseCoordinate(limitY * frequency);
      const wrappedZ = wrapNoiseCoordinate(limitZ * frequency);
      const smear = limitSmear * frequency;
      if (!onlyMaxLimit) {
        const noise = this.minLimitOctaves[octave];
        if (noise !== null) {
          minLimitTotal += noise.noiseWithYScale(wrappedX, wrappedY, wrappedZ, smear, limitY * frequency) / frequency;
        }
      }
      if (!onlyMinLimit) {
        const noise = this.maxLimitOctaves[octave];
        if (noise !== null) {
          maxLimitTotal += noise.noiseWithYScale(wrappedX, wrappedY, wrappedZ, smear, limitY * frequency) / frequency;
        }
      }
      frequency /= 2.0;
    }
    return clampedLerp(minLimitTotal / 512.0, maxLimitTotal / 512.0, blendFactor) / 128.0;
  }
}
