// Mirrors net.minecraft.world.level.levelgen.RandomSupport (seeding only, so BigInt is fine here).

import { encodeUtf8, md5 } from "./hashing";

const BIG_27 = BigInt(27);
const BIG_30 = BigInt(30);
const BIG_31 = BigInt(31);
const STAFFORD_MULTIPLIER_1 = BigInt("0xBF58476D1CE4E5B9");
const STAFFORD_MULTIPLIER_2 = BigInt("0x94D049BB133111EB");
/** The unnamed constant upgradeSeedTo128bitUnmixed xors the seed with. */
const SEED_UPGRADE_XOR = BigInt("0x6A09E667F3BCC909");
/** RandomSupport.GOLDEN_RATIO_64 = -7046029254386353131L. */
export const GOLDEN_RATIO_64 = BigInt("-7046029254386353131");
/** RandomSupport.SILVER_RATIO_64 = 7640891576956012809L. */
export const SILVER_RATIO_64 = BigInt("7640891576956012809");

export interface Seed128 {
  low: bigint;
  high: bigint;
}

/** Stafford variant 13 of the SplitMix64 finalizer, on a signed 64-bit long. */
export function mixStafford13(value: bigint): bigint {
  let mixed = BigInt.asUintN(64, value);
  mixed = BigInt.asUintN(64, (mixed ^ (mixed >> BIG_30)) * STAFFORD_MULTIPLIER_1);
  mixed = BigInt.asUintN(64, (mixed ^ (mixed >> BIG_27)) * STAFFORD_MULTIPLIER_2);
  return BigInt.asIntN(64, mixed ^ (mixed >> BIG_31));
}

export function upgradeSeedTo128bitUnmixed(seed: bigint): Seed128 {
  const low = BigInt.asIntN(64, seed ^ SEED_UPGRADE_XOR);
  const high = BigInt.asIntN(64, low + GOLDEN_RATIO_64);
  return { low, high };
}

export function upgradeSeedTo128bit(seed: bigint): Seed128 {
  const unmixed = upgradeSeedTo128bitUnmixed(seed);
  return { low: mixStafford13(unmixed.low), high: mixStafford13(unmixed.high) };
}

/** MD5 of the UTF-8 name; bytes 0-7 big-endian are the low seed, bytes 8-15 the high seed. As four int32 words. */
export function seedWordsFromHashOf(name: string): Int32Array {
  const digest = md5(encodeUtf8(name));
  const view = new DataView(digest.buffer, digest.byteOffset, 16);
  return new Int32Array([view.getInt32(0, false), view.getInt32(4, false), view.getInt32(8, false), view.getInt32(12, false)]);
}

export function seedFromHashOf(name: string): Seed128 {
  const words = seedWordsFromHashOf(name);
  const toLong = (high: number, low: number) =>
    BigInt.asIntN(64, (BigInt(high >>> 0) << BigInt(32)) | BigInt(low >>> 0));
  return { low: toLong(words[0], words[1]), high: toLong(words[2], words[3]) };
}
