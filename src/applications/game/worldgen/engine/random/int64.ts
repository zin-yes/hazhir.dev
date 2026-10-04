// 64-bit integer helpers on pairs of signed 32-bit halves, for hot paths where BigInt is too slow.
// A Java `long` is represented as (high, low): value = high * 2^32 + (low >>> 0), both halves as int32.

export interface Int64Halves {
  high: number;
  low: number;
}

const TWO_POW_32 = 4294967296;

/** High 32 bits of the unsigned 64-bit product of two unsigned 32-bit values, returned as an unsigned number. */
export function multiplyUnsigned32High(first: number, second: number): number {
  const firstLow = first & 0xffff;
  const firstHigh = first >>> 16;
  const secondLow = second & 0xffff;
  const secondHigh = second >>> 16;
  const lowLow = firstLow * secondLow;
  const lowHigh = firstLow * secondHigh;
  const highLow = firstHigh * secondLow;
  const highHigh = firstHigh * secondHigh;
  const middle = (lowLow >>> 16) + (lowHigh & 0xffff) + (highLow & 0xffff);
  return (highHigh + (lowHigh >>> 16) + (highLow >>> 16) + (middle >>> 16)) >>> 0;
}

/** out = first * second mod 2^64 (Java long multiplication). */
export function multiply64Into(
  firstHigh: number,
  firstLow: number,
  secondHigh: number,
  secondLow: number,
  out: Int64Halves,
): void {
  const low = Math.imul(firstLow, secondLow);
  const high =
    (multiplyUnsigned32High(firstLow >>> 0, secondLow >>> 0) +
      Math.imul(firstHigh, secondLow) +
      Math.imul(firstLow, secondHigh)) |
    0;
  out.high = high;
  out.low = low;
}

/** out = first + second mod 2^64 (Java long addition). */
export function add64Into(
  firstHigh: number,
  firstLow: number,
  secondHigh: number,
  secondLow: number,
  out: Int64Halves,
): void {
  const lowSum = (firstLow >>> 0) + (secondLow >>> 0);
  out.high = (firstHigh + secondHigh + (lowSum >= TWO_POW_32 ? 1 : 0)) | 0;
  out.low = lowSum | 0;
}

const scratchProduct: Int64Halves = { high: 0, low: 0 };
const scratchSquare: Int64Halves = { high: 0, low: 0 };

/**
 * Mirrors `Mth.getSeed(int x, int y, int z)`: the positional seed used by positional random factories.
 * `(long)(x * 3129871) ^ (long)z * 116129781L ^ (long)y`, then `seed * seed * 42317861L + seed * 11L`, then `>> 16`.
 */
export function positionalSeedInto(x: number, y: number, z: number, out: Int64Halves): void {
  const xTerm = Math.imul(x | 0, 3129871);
  const zInt = z | 0;
  const yInt = y | 0;
  multiply64Into(zInt >> 31, zInt, 0, 116129781, scratchProduct);
  const seedHigh = (xTerm >> 31) ^ scratchProduct.high ^ (yInt >> 31);
  const seedLow = xTerm ^ scratchProduct.low ^ yInt;
  multiply64Into(seedHigh, seedLow, seedHigh, seedLow, scratchSquare);
  multiply64Into(scratchSquare.high, scratchSquare.low, 0, 42317861, scratchSquare);
  multiply64Into(seedHigh, seedLow, 0, 11, scratchProduct);
  add64Into(scratchSquare.high, scratchSquare.low, scratchProduct.high, scratchProduct.low, scratchSquare);
  out.low = (scratchSquare.low >>> 16) | (scratchSquare.high << 16);
  out.high = scratchSquare.high >> 16;
}

/** Mirrors `Mth.getSeed(int, int, int)` returning a signed 64-bit bigint. */
export function positionalSeed(x: number, y: number, z: number): bigint {
  const out: Int64Halves = { high: 0, low: 0 };
  positionalSeedInto(x, y, z, out);
  return halvesToBigInt(out.high, out.low);
}

const BIG_32 = BigInt(32);
const BIG_MASK_32 = BigInt(0xffffffff);

export function halvesToBigInt(high: number, low: number): bigint {
  return BigInt.asIntN(64, (BigInt(high) << BIG_32) | BigInt(low >>> 0));
}

export function bigIntToHalves(value: bigint, out: Int64Halves): void {
  const unsigned = BigInt.asUintN(64, value);
  out.high = Number(unsigned >> BIG_32) | 0;
  out.low = Number(unsigned & BIG_MASK_32) | 0;
}
