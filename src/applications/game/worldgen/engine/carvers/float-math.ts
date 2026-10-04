// Java float semantics for the carver arithmetic, and Mth's table-driven sin and cos
// (Mth.sin(x) = SIN_TABLE[(int)(x * 10430.378f) & 0xFFFF], a float table of Math.sin).

const fround = Math.fround;

export const FLOAT_PI = fround(Math.PI);
export const FLOAT_TWO_PI = fround(FLOAT_PI * 2);
export const FLOAT_HALF_PI = fround(1.5707964);

const SIN_TABLE_SIZE = 65536;
const SIN_INDEX_SCALE = fround(10430.378);
const COS_INDEX_OFFSET = 16384;

const sinTable = new Float32Array(SIN_TABLE_SIZE);
for (let index = 0; index < SIN_TABLE_SIZE; index++) sinTable[index] = Math.sin((index * Math.PI * 2) / SIN_TABLE_SIZE);

export function mthSin(angle: number): number {
  return sinTable[(fround(angle * SIN_INDEX_SCALE) | 0) & 0xffff]!;
}

export function mthCos(angle: number): number {
  return sinTable[(fround(fround(angle * SIN_INDEX_SCALE) + COS_INDEX_OFFSET) | 0) & 0xffff]!;
}
