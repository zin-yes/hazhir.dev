// Seeded fractal noise fields. Raw fields cluster around zero, so the
// "uniform" variant squashes them to a roughly flat [-1, 1] distribution,
// which lets thresholds read as area fractions (-0.5 is the lowest quarter).

// @ts-ignore
import FastNoiseLite from "fastnoise-lite";

export type NoiseField = (x: number, z: number) => number;

export interface FractalNoiseOptions {
  seed: number;
  salt: number;
  frequency: number;
  octaves: number;
  gain?: number;
  lacunarity?: number;
}

const SINGLE_OCTAVE_DEVIATION = 0.46;
const UNIFORM_SQUASH_STRENGTH = 0.8;

function standardDeviationOf(octaves: number, gain: number): number {
  let amplitudeSum = 0;
  let squaredAmplitudeSum = 0;
  let amplitude = 1;
  for (let octave = 0; octave < octaves; octave++) {
    amplitudeSum += amplitude;
    squaredAmplitudeSum += amplitude * amplitude;
    amplitude *= gain;
  }
  return (SINGLE_OCTAVE_DEVIATION * Math.sqrt(squaredAmplitudeSum)) / amplitudeSum;
}

export function createFractalNoise(options: FractalNoiseOptions): NoiseField {
  const { seed, salt, frequency, octaves, gain = 0.5, lacunarity = 2 } = options;
  const generator = new FastNoiseLite((seed + Math.imul(salt, 7919)) | 0);
  generator.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2);
  generator.SetFractalType(octaves > 1 ? FastNoiseLite.FractalType.FBm : FastNoiseLite.FractalType.None);
  generator.SetFrequency(frequency);
  generator.SetFractalOctaves(octaves);
  generator.SetFractalLacunarity(lacunarity);
  generator.SetFractalGain(gain);
  return (x, z) => generator.GetNoise(x, z);
}

export function createUniformNoise(options: FractalNoiseOptions): NoiseField {
  const rawNoise = createFractalNoise(options);
  const deviation = standardDeviationOf(options.octaves, options.gain ?? 0.5);
  const squash = UNIFORM_SQUASH_STRENGTH / deviation;
  return (x, z) => Math.tanh(rawNoise(x, z) * squash);
}
