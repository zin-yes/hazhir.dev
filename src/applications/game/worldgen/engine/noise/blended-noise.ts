// Mirrors net.minecraft.world.level.levelgen.synth.BlendedNoise (density function `minecraft:old_blended_noise`):
// an 8-octave "main" noise picks, per point, a blend between two 16-octave limit noises.
// RandomState seeds it with `root.fromHashOf("minecraft:terrain")` when the settings use Xoroshiro.

import type { RandomSource } from "../random/random-source";
import type { ImprovedNoise } from "./improved-noise";
import { buildGeneratedFunction } from "../generated-function";
import { InlineNoiseSource, NOISE_IO, NOISE_IO_RESULT, NOISE_IO_X, NOISE_IO_Y, NOISE_IO_Z, noiseNumberLiteral } from "./inline-noise-source";
import { PerlinNoise, wrapNoiseCoordinate } from "./perlin-noise";
import { beginColdStart, defineColdStartLabel, endColdStart } from "../profiling/cold-start-ledger";
import { defineHotCounter, noteHot } from "../profiling/hot-counters";

const BLENDED_NOISE_SAMPLES = defineHotCounter("noise.blendedNoiseDirectSamples");
const COMPILE_BLENDED_LABEL = defineColdStartLabel("codegen.blendedNoise");

const BASE_SCALE = 684.412;
const LIMIT_OCTAVES = [-15, -14, -13, -12, -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0];
const MAIN_OCTAVES = [-7, -6, -5, -4, -3, -2, -1, 0];

function numberLiteral(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`Blended noise constant ${value} is not finite`);
  return Object.is(value, -0) ? "(-0)" : `(${String(value)})`;
}

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

  private compiled: (() => void) | null | undefined;

  /** ImprovedNoise evaluations of one compute when no octave is skipped (limit octaves are skipped at saturated blends). */
  get maxImprovedNoiseEvaluationsPerSample(): number {
    const present = (octaves: (ImprovedNoise | null)[]) => octaves.filter((octave) => octave !== null).length;
    return present(this.mainOctaves) + present(this.minLimitOctaves) + present(this.maxLimitOctaves);
  }

  /** Java `compute(FunctionContext)` at integer block coordinates. */
  compute(blockX: number, blockY: number, blockZ: number): number {
    noteHot(BLENDED_NOISE_SAMPLES);
    const sampler = this.compiledSampler();
    if (sampler === undefined) return this.computeInterpreted(blockX, blockY, blockZ);
    NOISE_IO[NOISE_IO_X] = blockX;
    NOISE_IO[NOISE_IO_Y] = blockY;
    NOISE_IO[NOISE_IO_Z] = blockZ;
    sampler();
    return NOISE_IO[NOISE_IO_RESULT]!;
  }

  /**
   * computeInterpreted as generated code with every octave sampled inline: reads the block position from NOISE_IO
   * and writes the value to NOISE_IO[NOISE_IO_RESULT]. The frequencies (powers of two) and null checks become
   * literals; operations and their order stay the same. The 40 octaves are split over a few functions (each stays
   * small enough for the optimizing compiler) that hand their running totals over in a Float64Array.
   */
  compiledSampler(): (() => void) | undefined {
    if (this.compiled === undefined) {
      const coldStartToken = beginColdStart(COMPILE_BLENDED_LABEL);
      this.compiled = this.compileSampler() ?? null;
      endColdStart(COMPILE_BLENDED_LABEL, coldStartToken);
    }
    return this.compiled ?? undefined;
  }

  private compileSampler(): (() => void) | undefined {
    const source = new InlineNoiseSource();
    const state = "blendedState";
    // State slots: 0..2 limit x/y/z, 3..5 main x/y/z, 6 limit smear, 7 main smear, 8..10 min/max/main totals, 11 blend.
    const loadState = [
      `const limitX = ${state}[0];`,
      `const limitY = ${state}[1];`,
      `const limitZ = ${state}[2];`,
      `const mainX = ${state}[3];`,
      `const mainY = ${state}[4];`,
      `const mainZ = ${state}[5];`,
      `const limitSmear = ${state}[6];`,
      `const mainSmear = ${state}[7];`,
    ];
    const setup = [
      "const blockX = noiseIo[0];",
      "const blockY = noiseIo[1];",
      "const blockZ = noiseIo[2];",
      `const limitX = blockX * ${noiseNumberLiteral(this.xzMultiplier)};`,
      `const limitY = blockY * ${noiseNumberLiteral(this.yMultiplier)};`,
      `const limitZ = blockZ * ${noiseNumberLiteral(this.xzMultiplier)};`,
      `const mainX = limitX / ${noiseNumberLiteral(this.xzFactor)};`,
      `const mainY = limitY / ${noiseNumberLiteral(this.yFactor)};`,
      `const mainZ = limitZ / ${noiseNumberLiteral(this.xzFactor)};`,
      `const limitSmear = ${noiseNumberLiteral(this.yMultiplier)} * ${noiseNumberLiteral(this.smearScaleMultiplier)};`,
      `const mainSmear = limitSmear / ${noiseNumberLiteral(this.yFactor)};`,
      `${state}[0] = limitX; ${state}[1] = limitY; ${state}[2] = limitZ;`,
      `${state}[3] = mainX; ${state}[4] = mainY; ${state}[5] = mainZ;`,
      `${state}[6] = limitSmear; ${state}[7] = mainSmear;`,
      "let mainTotal = 0.0;",
    ];
    let frequency = 1.0;
    for (let octave = 0; octave < 8; octave++) {
      const noise = this.mainOctaves[octave];
      if (noise !== null && noise !== undefined) {
        const factor = noiseNumberLiteral(frequency);
        const value = source.temporary("main");
        const wrappedX = source.wrapped(`mainX * ${factor}`, setup);
        const wrappedY = source.wrapped(`mainY * ${factor}`, setup);
        const wrappedZ = source.wrapped(`mainZ * ${factor}`, setup);
        source.octave(noise, value, wrappedX, wrappedY, wrappedZ, setup, `mainSmear * ${factor}`, `mainY * ${factor}`);
        setup.push(`mainTotal += ${value} / ${factor};`);
      }
      frequency /= 2.0;
    }
    setup.push("const blendFactor = (mainTotal / 10.0 + 1.0) / 2.0;");
    setup.push(`${state}[8] = 0.0; ${state}[9] = 0.0; ${state}[11] = blendFactor;`);

    const limitStages: string[][] = [];
    frequency = 1.0;
    for (let stage = 0; stage < 2; stage++) {
      const lines = [...loadState, `const blendFactor = ${state}[11];`, "const onlyMaxLimit = blendFactor >= 1.0;", "const onlyMinLimit = blendFactor <= 0.0;"];
      lines.push(`let minLimitTotal = ${state}[8];`, `let maxLimitTotal = ${state}[9];`);
      for (let octave = stage * 8; octave < stage * 8 + 8; octave++) {
        const factor = noiseNumberLiteral(frequency);
        lines.push("{");
        const wrappedX = source.wrapped(`limitX * ${factor}`, lines);
        const wrappedY = source.wrapped(`limitY * ${factor}`, lines);
        const wrappedZ = source.wrapped(`limitZ * ${factor}`, lines);
        const minLimitNoise = this.minLimitOctaves[octave];
        if (minLimitNoise !== null && minLimitNoise !== undefined) {
          const value = source.temporary("minimum");
          lines.push("if (!onlyMaxLimit) {");
          source.octave(minLimitNoise, value, wrappedX, wrappedY, wrappedZ, lines, `limitSmear * ${factor}`, `limitY * ${factor}`);
          lines.push(`minLimitTotal += ${value} / ${factor};`, "}");
        }
        const maxLimitNoise = this.maxLimitOctaves[octave];
        if (maxLimitNoise !== null && maxLimitNoise !== undefined) {
          const value = source.temporary("maximum");
          lines.push("if (!onlyMinLimit) {");
          source.octave(maxLimitNoise, value, wrappedX, wrappedY, wrappedZ, lines, `limitSmear * ${factor}`, `limitY * ${factor}`);
          lines.push(`maxLimitTotal += ${value} / ${factor};`, "}");
        }
        lines.push("}");
        frequency /= 2.0;
      }
      lines.push(`${state}[8] = minLimitTotal;`, `${state}[9] = maxLimitTotal;`);
      limitStages.push(lines);
    }
    const helperDeclarations = source.helperNames.map((helperName, index) => `const ${helperName} = helpers[${index}];`).join("\n");
    const body = `${helperDeclarations}
const ${state} = new Float64Array(12);
function blendedSetup() {\n${setup.join("\n")}\n}
function blendedLowLimits() {\n${limitStages[0]!.join("\n")}\n}
function blendedHighLimits() {\n${limitStages[1]!.join("\n")}\n}
return function blendedNoise() {
  blendedSetup();
  blendedLowLimits();
  blendedHighLimits();
  noiseIo[3] = clampedLerp(${state}[8] / 512.0, ${state}[9] / 512.0, ${state}[11]) / 128.0;
};`;
    return buildGeneratedFunction<() => void>(["helpers", "clampedLerp"], body, [source.helperValues, clampedLerp]);
  }

  /** The loop form of compute (reference for the generated sampler). */
  computeInterpreted(blockX: number, blockY: number, blockZ: number): number {
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
