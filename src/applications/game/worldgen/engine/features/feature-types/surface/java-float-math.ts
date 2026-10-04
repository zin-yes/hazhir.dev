// Java float and int arithmetic helpers for the ported surface features: float intermediates are rounded to
// 32 bits after every operation (Math.fround), integer division truncates toward zero.

export const roundFloat = Math.fround;

/** Mth.ceil(float). */
export function ceilFloat(value: number): number {
  const truncated = Math.trunc(value) | 0; // `| 0` turns -0 into +0 like a Java int (it decides the sign of x / 0)
  return value > truncated ? truncated + 1 : truncated;
}

/** Java int division (truncates toward zero). */
export function divideInt(dividend: number, divisor: number): number {
  return Math.trunc(dividend / divisor) | 0;
}

/** Mth.clamp(float, float, float). */
export function clampFloat(value: number, minimum: number, maximum: number): number {
  if (value < minimum) return minimum;
  return value > maximum ? maximum : value;
}
