// Mirrors the LinearCongruentialGenerator-based distance in net.minecraft.world.level.biome.BiomeManager:
//   next(seed, increment): seed *= seed * 6364136223846793005L + 1442695040888963407L; seed += increment;
// The 64-bit state is held as two int32 halves in module scratch registers so the hot path avoids BigInt.

const MULTIPLIER_HIGH = 0x5851f42d | 0;
const MULTIPLIER_LOW = 0x4c957f2d | 0;
const ADDEND_HIGH = 0x14057b7e | 0;
const ADDEND_LOW = 0xf767814f | 0;

let productHigh = 0;
let productLow = 0;
let stateHigh = 0;
let stateLow = 0;

function multiplyUnsigned32(left: number, right: number): void {
  const leftLow = left & 0xffff;
  const leftHigh = left >>> 16;
  const rightLow = right & 0xffff;
  const rightHigh = right >>> 16;
  const lowProduct = leftLow * rightLow;
  const middleProduct = leftLow * rightHigh + leftHigh * rightLow;
  const lowSum = lowProduct + (middleProduct % 65536) * 65536;
  productLow = lowSum >>> 0;
  productHigh = leftHigh * rightHigh + Math.floor(middleProduct / 65536) + Math.floor(lowSum / 4294967296);
}

/** Writes (leftHigh:leftLow) * (rightHigh:rightLow) mod 2^64 into product registers as int32 halves. */
function multiply64(leftHigh: number, leftLow: number, rightHigh: number, rightLow: number): void {
  multiplyUnsigned32(leftLow >>> 0, rightLow >>> 0);
  const low = productLow | 0;
  productHigh = (productHigh + Math.imul(leftLow, rightHigh) + Math.imul(leftHigh, rightLow)) | 0;
  productLow = low;
}

/** state = next(state, increment) with the increment already sign-extended into halves. */
function advanceState(incrementHigh: number, incrementLow: number): void {
  const seedHigh = stateHigh;
  const seedLow = stateLow;
  multiply64(seedHigh, seedLow, MULTIPLIER_HIGH, MULTIPLIER_LOW);
  const innerLowSum = (productLow >>> 0) + (ADDEND_LOW >>> 0);
  const innerHigh = (productHigh + ADDEND_HIGH + (innerLowSum > 0xffffffff ? 1 : 0)) | 0;
  multiply64(seedHigh, seedLow, innerHigh, innerLowSum | 0);
  const sumLow = (productLow >>> 0) + (incrementLow >>> 0);
  stateHigh = (productHigh + incrementHigh + (sumLow > 0xffffffff ? 1 : 0)) | 0;
  stateLow = sumLow | 0;
}

/** getFiddle: ((l >> 24) floorMod 1024) / 1024 - 0.5, scaled by 0.9. */
function currentFiddle(): number {
  const bits = ((stateLow >>> 24) | (stateHigh << 8)) & 1023;
  return (bits / 1024 - 0.5) * 0.9;
}

/**
 * BiomeManager.getFiddledDistance. The zoom seed is passed as int32 halves; cell coordinates are Java ints
 * (sign-extended to long when used as increments).
 */
export function getFiddledDistance(
  seedHigh: number,
  seedLow: number,
  cellX: number,
  cellY: number,
  cellZ: number,
  xNoise: number,
  yNoise: number,
  zNoise: number,
): number {
  stateHigh = seedHigh;
  stateLow = seedLow;
  advanceState(cellX >> 31, cellX);
  advanceState(cellY >> 31, cellY);
  advanceState(cellZ >> 31, cellZ);
  advanceState(cellX >> 31, cellX);
  advanceState(cellY >> 31, cellY);
  advanceState(cellZ >> 31, cellZ);
  const xFiddle = currentFiddle();
  advanceState(seedHigh, seedLow);
  const yFiddle = currentFiddle();
  advanceState(seedHigh, seedLow);
  const zFiddle = currentFiddle();
  const zTerm = zNoise + zFiddle;
  const yTerm = yNoise + yFiddle;
  const xTerm = xNoise + xFiddle;
  return zTerm * zTerm + yTerm * yTerm + xTerm * xTerm;
}

/** BigInt reference of one step, used by tests to verify the int32-halves implementation. */
export function linearCongruentialNextBigInt(seed: bigint, increment: bigint): bigint {
  const multiplier = BigInt("6364136223846793005");
  const addend = BigInt("1442695040888963407");
  return BigInt.asIntN(64, seed * BigInt.asIntN(64, seed * multiplier + addend) + increment);
}
