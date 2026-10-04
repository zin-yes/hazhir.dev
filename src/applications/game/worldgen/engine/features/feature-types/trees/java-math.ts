// Java numeric semantics the tree code depends on: float arithmetic (Math.fround), (int) casts of floats and the
// lookup-table sine and cosine of net.minecraft.util.Mth.

const fround = Math.fround;
const INT_MIN = -2147483648;
const INT_MAX = 2147483647;
const SIN_TABLE_SIZE = 65536;
const RADIANS_TO_TABLE_INDEX = fround(10430.378);
const QUARTER_TURN_TABLE_OFFSET = 16384;

const SIN_TABLE = new Float32Array(SIN_TABLE_SIZE);
for (let index = 0; index < SIN_TABLE_SIZE; index++) SIN_TABLE[index] = Math.sin((index * Math.PI * 2.0) / 65536.0);

/** Java (int) cast of a float or double: truncation toward zero, saturating, NaN becomes 0. */
export function javaToInt(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value >= INT_MAX) return INT_MAX;
  if (value <= INT_MIN) return INT_MIN;
  return Math.trunc(value);
}

/** Mth.floor(float) and Mth.floor(double). */
export function mthFloor(value: number): number {
  const truncated = javaToInt(value);
  return value < truncated ? truncated - 1 : truncated;
}

/** Mth.sin(float). */
export function mthSin(angle: number): number {
  return SIN_TABLE[javaToInt(fround(angle * RADIANS_TO_TABLE_INDEX)) & 0xffff]!;
}

/** Mth.cos(float). */
export function mthCos(angle: number): number {
  return SIN_TABLE[javaToInt(fround(fround(angle * RADIANS_TO_TABLE_INDEX) + QUARTER_TURN_TABLE_OFFSET)) & 0xffff]!;
}

/** Mth.sqrt(float). */
export function mthSqrt(value: number): number {
  return fround(Math.sqrt(value));
}

/** BlockPos.distManhattan. */
export function manhattanDistance(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by) + Math.abs(az - bz);
}
