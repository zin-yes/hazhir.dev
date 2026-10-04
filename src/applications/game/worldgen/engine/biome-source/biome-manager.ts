// Mirrors net.minecraft.world.level.biome.BiomeManager: getBiome(BlockPos) zooms quart-resolution biomes to
// block resolution with a fiddled (jittered) nearest-of-8-cells lookup keyed by the obfuscated world seed.
import { sha256 } from "../random";
import { cellFiddles, computeCellFiddles } from "./linear-congruential-generator";

export type RawBiomeAtQuart = (quartX: number, quartY: number, quartZ: number) => string;

/** BiomeManager.obfuscateSeed: first 8 bytes (little-endian) of SHA-256 over the seed's 8 little-endian bytes, as a signed long. */
export function obfuscateSeed(seed: bigint): bigint {
  const unsignedSeed = BigInt.asUintN(64, seed);
  const seedBytes = new Uint8Array(8);
  for (let byteIndex = 0; byteIndex < 8; byteIndex++) {
    seedBytes[byteIndex] = Number((unsignedSeed >> BigInt(byteIndex * 8)) & BigInt(0xff));
  }
  const digest = sha256(seedBytes);
  let hashed = BigInt(0);
  for (let byteIndex = 7; byteIndex >= 0; byteIndex--) {
    hashed = (hashed << BigInt(8)) | BigInt(digest[byteIndex]);
  }
  return BigInt.asIntN(64, hashed);
}

// getBiome looks at the 8 quart cells around a block and every cell's fiddle offsets depend only on the cell, so
// neighbouring blocks (and the 8 candidates of one block) share them. A direct-mapped cache keeps the results.
const FIDDLE_CACHE_BITS = 16;
const FIDDLE_CACHE_MASK = (1 << FIDDLE_CACHE_BITS) - 1;

export class BiomeManager {
  private readonly zoomSeedHigh: number;
  private readonly zoomSeedLow: number;
  private readonly cachedCellX = new Int32Array(1 << FIDDLE_CACHE_BITS);
  private readonly cachedCellY = new Int32Array(1 << FIDDLE_CACHE_BITS);
  private readonly cachedCellZ = new Int32Array(1 << FIDDLE_CACHE_BITS);
  private readonly cachedCellIsFilled = new Uint8Array(1 << FIDDLE_CACHE_BITS);
  private readonly cachedFiddles = new Float64Array(3 << FIDDLE_CACHE_BITS);

  /** @param seed the WORLD seed; it is obfuscated here exactly as vanilla callers do before constructing BiomeManager. */
  constructor(
    private readonly rawBiomeAtQuart: RawBiomeAtQuart,
    seed: bigint,
  ) {
    const zoomSeed = BigInt.asUintN(64, obfuscateSeed(seed));
    this.zoomSeedHigh = Number(zoomSeed >> BigInt(32)) | 0;
    this.zoomSeedLow = Number(zoomSeed & BigInt(0xffffffff)) | 0;
  }

  private cacheSlotOf(cellX: number, cellY: number, cellZ: number): number {
    const slot = (Math.imul(cellX, 73856093) ^ Math.imul(cellY, 19349663) ^ Math.imul(cellZ, 83492791)) & FIDDLE_CACHE_MASK;
    if (
      this.cachedCellIsFilled[slot] === 0 ||
      this.cachedCellX[slot] !== cellX ||
      this.cachedCellY[slot] !== cellY ||
      this.cachedCellZ[slot] !== cellZ
    ) {
      computeCellFiddles(this.zoomSeedHigh, this.zoomSeedLow, cellX, cellY, cellZ);
      this.cachedCellIsFilled[slot] = 1;
      this.cachedCellX[slot] = cellX;
      this.cachedCellY[slot] = cellY;
      this.cachedCellZ[slot] = cellZ;
      this.cachedFiddles[slot * 3] = cellFiddles.x;
      this.cachedFiddles[slot * 3 + 1] = cellFiddles.y;
      this.cachedFiddles[slot * 3 + 2] = cellFiddles.z;
    }
    return slot * 3;
  }

  getBiome(blockX: number, blockY: number, blockZ: number): string {
    const shiftedX = blockX - 2;
    const shiftedY = blockY - 2;
    const shiftedZ = blockZ - 2;
    const baseQuartX = shiftedX >> 2;
    const baseQuartY = shiftedY >> 2;
    const baseQuartZ = shiftedZ >> 2;
    const fractionX = (shiftedX & 3) / 4;
    const fractionY = (shiftedY & 3) / 4;
    const fractionZ = (shiftedZ & 3) / 4;
    let closestCandidate = 0;
    let closestDistance = Infinity;
    for (let candidate = 0; candidate < 8; candidate++) {
      const useBaseX = (candidate & 4) === 0;
      const useBaseY = (candidate & 2) === 0;
      const useBaseZ = (candidate & 1) === 0;
      const cellX = useBaseX ? baseQuartX : baseQuartX + 1;
      const cellY = useBaseY ? baseQuartY : baseQuartY + 1;
      const cellZ = useBaseZ ? baseQuartZ : baseQuartZ + 1;
      const fiddleOffset = this.cacheSlotOf(cellX, cellY, cellZ);
      const zTerm = (useBaseZ ? fractionZ : fractionZ - 1) + this.cachedFiddles[fiddleOffset + 2]!;
      const yTerm = (useBaseY ? fractionY : fractionY - 1) + this.cachedFiddles[fiddleOffset + 1]!;
      const xTerm = (useBaseX ? fractionX : fractionX - 1) + this.cachedFiddles[fiddleOffset]!;
      const distance = zTerm * zTerm + yTerm * yTerm + xTerm * xTerm;
      if (closestDistance > distance) {
        closestCandidate = candidate;
        closestDistance = distance;
      }
    }
    return this.rawBiomeAtQuart(
      (closestCandidate & 4) === 0 ? baseQuartX : baseQuartX + 1,
      (closestCandidate & 2) === 0 ? baseQuartY : baseQuartY + 1,
      (closestCandidate & 1) === 0 ? baseQuartZ : baseQuartZ + 1,
    );
  }
}
