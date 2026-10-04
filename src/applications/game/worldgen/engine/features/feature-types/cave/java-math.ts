// Java arithmetic helpers the cave feature ports need: float rounding, Mth's table-driven sin/cos, the float and
// double overloads of Mth.clampedMap, Mth.floor/ceil and Math.round(float).

export const fround = Math.fround;

export const FLOAT_PI = fround(Math.PI);

const SIN_TABLE_SIZE = 65536;
const SIN_INDEX_SCALE = fround(10430.378);
const COS_INDEX_OFFSET = 16384;

const sinTable = new Float32Array(SIN_TABLE_SIZE);
for (let index = 0; index < SIN_TABLE_SIZE; index++) sinTable[index] = Math.sin((index * Math.PI * 2) / SIN_TABLE_SIZE);

/** Mth.sin(float). */
export function mthSin(angle: number): number {
  return sinTable[(fround(angle * SIN_INDEX_SCALE) | 0) & 0xffff]!;
}

/** Mth.cos(float). */
export function mthCos(angle: number): number {
  return sinTable[(fround(fround(angle * SIN_INDEX_SCALE) + COS_INDEX_OFFSET) | 0) & 0xffff]!;
}

/** Mth.sqrt(float). */
export function mthSqrtFloat(value: number): number {
  return fround(Math.sqrt(value));
}

/** Mth.invSqrt(double) (JOML Math.invsqrt). */
export function mthInvSqrt(value: number): number {
  return 1 / Math.sqrt(value);
}

/** Mth.floor(double). */
export function mthFloor(value: number): number {
  return Math.floor(value) | 0;
}

/** Mth.ceil(double) and Mth.ceil(float). */
export function mthCeil(value: number): number {
  return Math.ceil(value) | 0;
}

/** Math.round(float): floor(value + 0.5), exact for float inputs. */
export function javaRoundFloat(value: number): number {
  return Math.floor(value + 0.5) | 0;
}

/** Mth.lerp(double, double, double). */
export function mthLerp(delta: number, start: number, end: number): number {
  return start + delta * (end - start);
}

/** Mth.clampedMap(double x5). */
export function clampedMapDouble(value: number, fromMin: number, fromMax: number, toMin: number, toMax: number): number {
  const progress = (value - fromMin) / (fromMax - fromMin);
  if (progress < 0) return toMin;
  if (progress > 1) return toMax;
  return mthLerp(progress, toMin, toMax);
}

/** Mth.clampedMap(float x5): every operation rounds to float. Arguments must already be floats. */
export function clampedMapFloat(value: number, fromMin: number, fromMax: number, toMin: number, toMax: number): number {
  const progress = fround(fround(value - fromMin) / fround(fromMax - fromMin));
  if (progress < 0) return toMin;
  if (progress > 1) return toMax;
  return fround(toMin + fround(progress * fround(toMax - toMin)));
}

/** Mth.clamp(float, float, float). */
export function clampFloat(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Mth.clamp(int, int, int). */
export function clampInt(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
