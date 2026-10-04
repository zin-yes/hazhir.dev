// Source generation for noise samples written inline (no calls), used by the generated NormalNoise and BlendedNoise
// functions. V8 boxes every double passed to or returned from a call it does not inline, so octave loops built from
// calls allocate on every sample; the inlined octave below performs exactly ImprovedNoise.noise /
// noiseWithYScale's operations in the same order, on locals. Generated noise functions take their coordinates from
// NOISE_IO[0..2] and leave the result in NOISE_IO[3] for the same reason (generated functions never call each other).

import { GRADIENT_X, GRADIENT_Y, GRADIENT_Z, type ImprovedNoise } from "./improved-noise";
import { wrapNoiseCoordinate } from "./perlin-noise";

/** Shared argument and result slots of generated noise functions (one thread, no reentrancy). */
export const NOISE_IO = new Float64Array(4);
export const NOISE_IO_X = 0;
export const NOISE_IO_Y = 1;
export const NOISE_IO_Z = 2;
export const NOISE_IO_RESULT = 3;

/** Java `(double)1.0E-7f`, as in ImprovedNoise. */
const SHIFT_UP_EPSILON = Math.fround(1.0e-7);
const WRAP_IDENTITY_LIMIT = 8388608.0;

export function noiseNumberLiteral(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`Noise constant ${value} is not finite`);
  return Object.is(value, -0) ? "(-0)" : `(${String(value)})`;
}

export class InlineNoiseSource {
  readonly helperValues: unknown[] = [GRADIENT_X, GRADIENT_Y, GRADIENT_Z, wrapNoiseCoordinate, NOISE_IO];
  readonly helperNames: string[] = ["gradientX", "gradientY", "gradientZ", "wrapSlow", "noiseIo"];
  private temporaryCount = 0;

  private helper(value: unknown): string {
    const existing = this.helperValues.indexOf(value);
    if (existing !== -1) return this.helperNames[existing]!;
    const name = `noiseHelper${this.helperValues.length}`;
    this.helperValues.push(value);
    this.helperNames.push(name);
    return name;
  }

  temporary(prefix: string): string {
    return `${prefix}${this.temporaryCount++}`;
  }

  /** PerlinNoise.wrap of an expression, as an expression (the identity range needs no call). */
  wrapped(expression: string, lines: string[]): string {
    const value = this.temporary("input");
    lines.push(`const ${value} = ${expression};`);
    return `(${value} < ${WRAP_IDENTITY_LIMIT} && ${value} > -${WRAP_IDENTITY_LIMIT} ? ${value} : wrapSlow(${value}))`;
  }

  /**
   * Statements that set `const resultName` to `noise.noise(x, y, z)`, or to `noise.noiseWithYScale(x, y, z, yScale,
   * yMax)` when `yScale` is given. Coordinates are expressions evaluated once each.
   */
  octave(noise: ImprovedNoise, resultName: string, x: string, y: string, z: string, lines: string[], yScale?: string, yMax?: string): void {
    const permutation = this.helper(noise.permutation);
    const name = (part: string) => `${part}${resultName}`;
    lines.push(`const ${name("shiftedX")} = ${x} + ${noiseNumberLiteral(noise.xOffset)};`);
    lines.push(`const ${name("shiftedY")} = ${y} + ${noiseNumberLiteral(noise.yOffset)};`);
    lines.push(`const ${name("shiftedZ")} = ${z} + ${noiseNumberLiteral(noise.zOffset)};`);
    lines.push(`const ${name("cellX")} = Math.floor(${name("shiftedX")});`);
    lines.push(`const ${name("cellY")} = Math.floor(${name("shiftedY")});`);
    lines.push(`const ${name("cellZ")} = Math.floor(${name("shiftedZ")});`);
    lines.push(`const ${name("localYForSmoothing")} = ${name("shiftedY")} - ${name("cellY")};`);
    if (yScale === undefined) {
      lines.push(`const ${name("localY")} = ${name("localYForSmoothing")};`);
    } else {
      const ySmear = name("yScale");
      const yLimit = name("yMax");
      lines.push(`const ${ySmear} = ${yScale};`);
      lines.push(`const ${yLimit} = ${yMax};`);
      lines.push(`let ${name("yShift")} = 0.0;`);
      lines.push(
        `if (${ySmear} !== 0.0) { const clampedY = ${yLimit} >= 0.0 && ${yLimit} < ${name("localYForSmoothing")} ? ${yLimit} : ${name("localYForSmoothing")}; ` +
          `${name("yShift")} = Math.floor(clampedY / ${ySmear} + ${noiseNumberLiteral(SHIFT_UP_EPSILON)}) * ${ySmear}; }`,
      );
      lines.push(`const ${name("localY")} = ${name("localYForSmoothing")} - ${name("yShift")};`);
    }
    lines.push(`const ${name("localX")} = ${name("shiftedX")} - ${name("cellX")};`);
    lines.push(`const ${name("localZ")} = ${name("shiftedZ")} - ${name("cellZ")};`);
    const cellY = name("cellY");
    const cellZ = name("cellZ");
    lines.push(`const ${name("hashX0")} = ${permutation}[${name("cellX")} & 255];`);
    lines.push(`const ${name("hashX1")} = ${permutation}[(${name("cellX")} + 1) & 255];`);
    lines.push(`const ${name("hashX0Y0")} = ${permutation}[(${name("hashX0")} + ${cellY}) & 255];`);
    lines.push(`const ${name("hashX0Y1")} = ${permutation}[(${name("hashX0")} + ${cellY} + 1) & 255];`);
    lines.push(`const ${name("hashX1Y0")} = ${permutation}[(${name("hashX1")} + ${cellY}) & 255];`);
    lines.push(`const ${name("hashX1Y1")} = ${permutation}[(${name("hashX1")} + ${cellY} + 1) & 255];`);
    const localX = name("localX");
    const localY = name("localY");
    const localZ = name("localZ");
    const corner = (cornerName: string, hashName: string, zStep: string, dotX: string, dotY: string, dotZ: string) => {
      const gradient = name(`gradient${cornerName}`);
      lines.push(`const ${gradient} = ${permutation}[(${name(hashName)} + ${cellZ}${zStep}) & 255] & 15;`);
      lines.push(
        `const ${name(`corner${cornerName}`)} = gradientX[${gradient}] * ${dotX} + gradientY[${gradient}] * ${dotY} + gradientZ[${gradient}] * ${dotZ};`,
      );
    };
    corner("000", "hashX0Y0", "", localX, localY, localZ);
    corner("100", "hashX1Y0", "", `(${localX} - 1.0)`, localY, localZ);
    corner("010", "hashX0Y1", "", localX, `(${localY} - 1.0)`, localZ);
    corner("110", "hashX1Y1", "", `(${localX} - 1.0)`, `(${localY} - 1.0)`, localZ);
    corner("001", "hashX0Y0", " + 1", localX, localY, `(${localZ} - 1.0)`);
    corner("101", "hashX1Y0", " + 1", `(${localX} - 1.0)`, localY, `(${localZ} - 1.0)`);
    corner("011", "hashX0Y1", " + 1", localX, `(${localY} - 1.0)`, `(${localZ} - 1.0)`);
    corner("111", "hashX1Y1", " + 1", `(${localX} - 1.0)`, `(${localY} - 1.0)`, `(${localZ} - 1.0)`);
    const smooth = (target: string, value: string) =>
      lines.push(`const ${target} = ${value} * ${value} * ${value} * (${value} * (${value} * 6.0 - 15.0) + 10.0);`);
    smooth(name("smoothX"), localX);
    smooth(name("smoothY"), name("localYForSmoothing"));
    smooth(name("smoothZ"), localZ);
    const lerp = (target: string, delta: string, start: string, end: string) => lines.push(`const ${target} = ${start} + ${delta} * (${end} - ${start});`);
    lerp(name("x00"), name("smoothX"), name("corner000"), name("corner100"));
    lerp(name("x10"), name("smoothX"), name("corner010"), name("corner110"));
    lerp(name("y0"), name("smoothY"), name("x00"), name("x10"));
    lerp(name("x01"), name("smoothX"), name("corner001"), name("corner101"));
    lerp(name("x11"), name("smoothX"), name("corner011"), name("corner111"));
    lerp(name("y1"), name("smoothY"), name("x01"), name("x11"));
    lerp(resultName, name("smoothZ"), name("y0"), name("y1"));
  }

  /** Wraps a body (reading coordinates from noiseIo, writing the result to noiseIo[3]) into a factory source. */
  factorySource(functionName: string, body: string[]): string {
    const declarations = this.helperNames.map((helperName, index) => `const ${helperName} = helpers[${index}];`).join("\n");
    return `${declarations}\nreturn function ${functionName}() {\n${body.join("\n")}\n};`;
  }
}
