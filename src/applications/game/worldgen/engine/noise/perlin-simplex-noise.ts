// Mirrors net.minecraft.world.level.levelgen.synth.PerlinSimplexNoise (2D only, as in Java), used by
// Biome temperature adjustment and surface noise. Java wraps the secondary source in a WorldgenRandom over a
// LegacyRandomSource, which yields the same sequence as the LegacyRandomSource itself.

import { LegacyRandomSource } from "../random/legacy-random-source";
import type { RandomSource } from "../random/random-source";
import { SimplexNoise } from "./simplex-noise";

const LONG_MAX = BigInt("9223372036854775807");
const LONG_MIN = BigInt("-9223372036854775808");

/** Java `(long)value` cast: truncation toward zero, saturating, NaN to 0. */
function doubleToJavaLong(value: number): bigint {
  if (Number.isNaN(value)) return BigInt(0);
  if (value >= 9.223372036854776e18) return LONG_MAX;
  if (value <= -9.223372036854776e18) return LONG_MIN;
  return BigInt(Math.trunc(value));
}

export class PerlinSimplexNoise {
  private readonly noiseLevels: (SimplexNoise | null)[];
  private readonly highestFreqValueFactor: number;
  private readonly highestFreqInputFactor: number;

  constructor(random: RandomSource, octaves: number[]) {
    if (octaves.length === 0) throw new Error("Need some octaves!");
    const octaveSet = new Set(octaves);
    const sortedOctaves = [...octaveSet].sort((first, second) => first - second);
    const negativeFirstOctave = -sortedOctaves[0];
    const lastOctave = sortedOctaves[sortedOctaves.length - 1];
    const octaveCount = negativeFirstOctave + lastOctave + 1;
    if (octaveCount < 1) throw new Error("Total number of octaves needs to be >= 1");
    const zeroOctaveNoise = new SimplexNoise(random);
    const zeroSlot = lastOctave;
    this.noiseLevels = new Array<SimplexNoise | null>(octaveCount).fill(null);
    if (zeroSlot >= 0 && zeroSlot < octaveCount && octaveSet.has(0)) this.noiseLevels[zeroSlot] = zeroOctaveNoise;
    for (let slot = zeroSlot + 1; slot < octaveCount; slot++) {
      if (slot >= 0 && octaveSet.has(zeroSlot - slot)) this.noiseLevels[slot] = new SimplexNoise(random);
      else random.skip(262);
    }
    if (lastOctave > 0) {
      const derivedSeed = doubleToJavaLong(
        zeroOctaveNoise.getValue3D(zeroOctaveNoise.xOffset, zeroOctaveNoise.yOffset, zeroOctaveNoise.zOffset) *
          9.223372036854776e18,
      );
      const derivedRandom = new LegacyRandomSource(derivedSeed);
      for (let slot = zeroSlot - 1; slot >= 0; slot--) {
        if (slot < octaveCount && octaveSet.has(zeroSlot - slot)) this.noiseLevels[slot] = new SimplexNoise(derivedRandom);
        else derivedRandom.skip(262);
      }
    }
    this.highestFreqInputFactor = Math.pow(2.0, lastOctave);
    this.highestFreqValueFactor = 1.0 / (Math.pow(2.0, octaveCount) - 1.0);
  }

  getValue(x: number, y: number, useNoiseOffsets: boolean): number {
    let total = 0.0;
    let inputFactor = this.highestFreqInputFactor;
    let valueFactor = this.highestFreqValueFactor;
    for (const noise of this.noiseLevels) {
      if (noise !== null) {
        total +=
          noise.getValue2D(
            x * inputFactor + (useNoiseOffsets ? noise.xOffset : 0.0),
            y * inputFactor + (useNoiseOffsets ? noise.yOffset : 0.0),
          ) * valueFactor;
      }
      inputFactor /= 2.0;
      valueFactor *= 2.0;
    }
    return total;
  }
}
