// Mirrors net.minecraft.world.level.levelgen.XoroshiroRandomSource and Xoroshiro128PlusPlus.
// The 128-bit state is held as four int32 words so nextLong never touches BigInt.

import { bigIntToHalves, halvesToBigInt, type Int64Halves, multiplyUnsigned32High, positionalSeedInto } from "./int64";
import { MarsagliaPolarGaussian } from "./marsaglia-polar-gaussian";
import type { PositionalRandomFactory, RandomSource } from "./random-source";
import { seedWordsFromHashOf, upgradeSeedTo128bit } from "./random-support";
import { defineHotCounter, noteHot } from "../profiling/hot-counters";

const CREATED_FROM_SEED = defineHotCounter("random.xoroshiroCreatedFromSeed");
const CREATED_FROM_STATE = defineHotCounter("random.xoroshiroCreatedFromState");
const FORKS = defineHotCounter("random.xoroshiroForks");
const POSITIONAL_FORKS = defineHotCounter("random.xoroshiroPositionalForks");
const SET_SEED_CALLS = defineHotCounter("random.xoroshiroSetSeed");
const POSITIONAL_AT = defineHotCounter("random.xoroshiroPositionalAt");
const POSITIONAL_REUSED_AT = defineHotCounter("random.xoroshiroPositionalReusedAt");
const POSITIONAL_FROM_HASH = defineHotCounter("random.xoroshiroPositionalFromHashOf");
const POSITIONAL_FROM_SEED = defineHotCounter("random.xoroshiroPositionalFromSeed");

const FLOAT_UNIT = 5.9604644775390625e-8; // 2^-24, exactly Java's 5.9604645E-8f
const DOUBLE_UNIT = 1.1102230246251565e-16; // 2^-53, exactly Java's (double)1.110223E-16f
const TWO_POW_21 = 2097152;
const TWO_POW_32 = 4294967296;

// Xoroshiro128PlusPlus replaces an all-zero state with GOLDEN_RATIO_64 / SILVER_RATIO_64.
const GOLDEN_RATIO_HIGH = 0x9e3779b9 | 0;
const GOLDEN_RATIO_LOW = 0x7f4a7c15 | 0;
const SILVER_RATIO_HIGH = 0x6a09e667 | 0;
const SILVER_RATIO_LOW = 0xf3bcc909 | 0;

const scratchHalves: Int64Halves = { high: 0, low: 0 };
const scratchSecondHalves: Int64Halves = { high: 0, low: 0 };

export class XoroshiroRandomSource implements RandomSource {
  private seedLowHigh = 0;
  private seedLowLow = 0;
  private seedHighHigh = 0;
  private seedHighLow = 0;
  /** Result of the last `advance()`, as int32 halves. */
  private resultHigh = 0;
  private resultLow = 0;
  /** Created on first use: most random sources (positional ones especially) never draw a gaussian. */
  private gaussianSource: MarsagliaPolarGaussian | undefined;

  /** Java `new XoroshiroRandomSource(long seed)`: upgrades the seed to 128 bits with mixStafford13. */
  constructor(seed: bigint);
  /** Internal: raw 128-bit state as int32 words (low long high/low word, high long high/low word). */
  constructor(seedLowHigh: number, seedLowLow: number, seedHighHigh: number, seedHighLow: number);
  constructor(seedOrLowHigh: bigint | number, seedLowLow = 0, seedHighHigh = 0, seedHighLow = 0) {
    if (typeof seedOrLowHigh === "bigint") {
      noteHot(CREATED_FROM_SEED);
      this.setSeedWithoutGaussianReset(seedOrLowHigh);
    } else {
      noteHot(CREATED_FROM_STATE);
      this.setRawState(seedOrLowHigh, seedLowLow, seedHighHigh, seedHighLow);
    }
  }

  /** Java `new XoroshiroRandomSource(long seedLo, long seedHi)`: raw state, no mixing. */
  static fromSeed128(low: bigint, high: bigint): XoroshiroRandomSource {
    bigIntToHalves(low, scratchHalves);
    bigIntToHalves(high, scratchSecondHalves);
    return new XoroshiroRandomSource(scratchHalves.high, scratchHalves.low, scratchSecondHalves.high, scratchSecondHalves.low);
  }

  private setRawState(seedLowHigh: number, seedLowLow: number, seedHighHigh: number, seedHighLow: number): void {
    if ((seedLowHigh | seedLowLow | seedHighHigh | seedHighLow) === 0) {
      this.seedLowHigh = GOLDEN_RATIO_HIGH;
      this.seedLowLow = GOLDEN_RATIO_LOW;
      this.seedHighHigh = SILVER_RATIO_HIGH;
      this.seedHighLow = SILVER_RATIO_LOW;
      return;
    }
    this.seedLowHigh = seedLowHigh | 0;
    this.seedLowLow = seedLowLow | 0;
    this.seedHighHigh = seedHighHigh | 0;
    this.seedHighLow = seedHighLow | 0;
  }

  private setSeedWithoutGaussianReset(seed: bigint): void {
    const upgraded = upgradeSeedTo128bit(seed);
    bigIntToHalves(upgraded.low, scratchHalves);
    bigIntToHalves(upgraded.high, scratchSecondHalves);
    this.setRawState(scratchHalves.high, scratchHalves.low, scratchSecondHalves.high, scratchSecondHalves.low);
  }

  /** One step of Xoroshiro128PlusPlus.nextLong(); the result lands in resultHigh/resultLow. */
  private advance(): void {
    const lowHigh = this.seedLowHigh;
    const lowLow = this.seedLowLow;
    const highHigh = this.seedHighHigh;
    const highLow = this.seedHighLow;
    // result = rotateLeft(seedLo + seedHi, 17) + seedLo
    const sumLowUnsigned = (lowLow >>> 0) + (highLow >>> 0);
    const sumHigh = (lowHigh + highHigh + (sumLowUnsigned >= TWO_POW_32 ? 1 : 0)) | 0;
    const sumLow = sumLowUnsigned | 0;
    const rotatedHigh = (sumHigh << 17) | (sumLow >>> 15);
    const rotatedLow = (sumLow << 17) | (sumHigh >>> 15);
    const resultLowUnsigned = (rotatedLow >>> 0) + (lowLow >>> 0);
    this.resultHigh = (rotatedHigh + lowHigh + (resultLowUnsigned >= TWO_POW_32 ? 1 : 0)) | 0;
    this.resultLow = resultLowUnsigned | 0;
    // mixed = seedHi ^ seedLo; seedLo = rotateLeft(seedLo, 49) ^ mixed ^ (mixed << 21); seedHi = rotateLeft(mixed, 28)
    const mixedHigh = highHigh ^ lowHigh;
    const mixedLow = highLow ^ lowLow;
    const rotated49High = (lowLow << 17) | (lowHigh >>> 15);
    const rotated49Low = (lowHigh << 17) | (lowLow >>> 15);
    const shiftedHigh = (mixedHigh << 21) | (mixedLow >>> 11);
    const shiftedLow = mixedLow << 21;
    this.seedLowHigh = rotated49High ^ mixedHigh ^ shiftedHigh;
    this.seedLowLow = rotated49Low ^ mixedLow ^ shiftedLow;
    this.seedHighHigh = (mixedHigh << 28) | (mixedLow >>> 4);
    this.seedHighLow = (mixedLow << 28) | (mixedHigh >>> 4);
  }

  nextInt(): number {
    this.advance();
    return this.resultLow;
  }

  /** Lemire's multiply-shift with rejection, exactly as XoroshiroRandomSource.nextInt(int). */
  nextIntBounded(bound: number): number {
    if (bound <= 0) throw new Error("Bound must be positive");
    this.advance();
    let randomUnsigned = this.resultLow >>> 0;
    let productLow = Math.imul(randomUnsigned, bound) >>> 0;
    if (productLow < bound) {
      const threshold = ((-bound >>> 0) % bound) >>> 0;
      while (productLow < threshold) {
        this.advance();
        randomUnsigned = this.resultLow >>> 0;
        productLow = Math.imul(randomUnsigned, bound) >>> 0;
      }
    }
    return multiplyUnsigned32High(randomUnsigned, bound) | 0;
  }

  nextIntBetweenInclusive(min: number, max: number): number {
    return (this.nextIntBounded((max - min + 1) | 0) + min) | 0;
  }

  nextIntInRange(origin: number, bound: number): number {
    if (origin >= bound) throw new Error("bound - origin is non positive");
    return (origin + this.nextIntBounded((bound - origin) | 0)) | 0;
  }

  nextLong(): bigint {
    this.advance();
    return halvesToBigInt(this.resultHigh, this.resultLow);
  }

  /** nextLong() without BigInt, written into `out`. */
  nextLongInto(out: Int64Halves): void {
    this.advance();
    out.high = this.resultHigh;
    out.low = this.resultLow;
  }

  nextBoolean(): boolean {
    this.advance();
    return (this.resultLow & 1) !== 0;
  }

  nextFloat(): number {
    this.advance();
    return (this.resultHigh >>> 8) * FLOAT_UNIT;
  }

  nextDouble(): number {
    this.advance();
    return ((this.resultHigh >>> 0) * TWO_POW_21 + (this.resultLow >>> 11)) * DOUBLE_UNIT;
  }

  nextGaussian(): number {
    return (this.gaussianSource ??= new MarsagliaPolarGaussian(this)).nextGaussian();
  }

  triangle(center: number, spread: number): number {
    return center + spread * (this.nextDouble() - this.nextDouble());
  }

  skip(count: number): void {
    for (let index = 0; index < count; index++) this.advance();
  }

  fork(): XoroshiroRandomSource {
    noteHot(FORKS);
    this.advance();
    const lowHigh = this.resultHigh;
    const lowLow = this.resultLow;
    this.advance();
    return new XoroshiroRandomSource(lowHigh, lowLow, this.resultHigh, this.resultLow);
  }

  forkPositional(): XoroshiroPositionalRandomFactory {
    noteHot(POSITIONAL_FORKS);
    this.advance();
    const lowHigh = this.resultHigh;
    const lowLow = this.resultLow;
    this.advance();
    return new XoroshiroPositionalRandomFactory(lowHigh, lowLow, this.resultHigh, this.resultLow);
  }

  setSeed(seed: bigint): void {
    noteHot(SET_SEED_CALLS);
    this.setSeedWithoutGaussianReset(seed);
    this.gaussianSource?.reset();
  }

  /** Puts this source in the state `new XoroshiroRandomSource(seedLowHigh, ...)` starts in. */
  resetToRawState(seedLowHigh: number, seedLowLow: number, seedHighHigh: number, seedHighLow: number): void {
    this.setRawState(seedLowHigh, seedLowLow, seedHighHigh, seedHighLow);
    this.gaussianSource?.reset();
  }
}

const positionalScratch: Int64Halves = { high: 0, low: 0 };
/** The source `reusedAt` hands out: one per thread, re-seeded on every call. */
const reusedPositionalSource = new XoroshiroRandomSource(0, 0, 0, 0);

/** Mirrors XoroshiroRandomSource.XoroshiroPositionalRandomFactory. */
export class XoroshiroPositionalRandomFactory implements PositionalRandomFactory {
  constructor(
    private readonly seedLowHigh: number,
    private readonly seedLowLow: number,
    private readonly seedHighHigh: number,
    private readonly seedHighLow: number,
  ) {}

  static fromSeed128(low: bigint, high: bigint): XoroshiroPositionalRandomFactory {
    bigIntToHalves(low, scratchHalves);
    bigIntToHalves(high, scratchSecondHalves);
    return new XoroshiroPositionalRandomFactory(
      scratchHalves.high,
      scratchHalves.low,
      scratchSecondHalves.high,
      scratchSecondHalves.low,
    );
  }

  get seedLow(): bigint {
    return halvesToBigInt(this.seedLowHigh, this.seedLowLow);
  }

  get seedHigh(): bigint {
    return halvesToBigInt(this.seedHighHigh, this.seedHighLow);
  }

  at(x: number, y: number, z: number): XoroshiroRandomSource {
    noteHot(POSITIONAL_AT);
    positionalSeedInto(x, y, z, positionalScratch);
    return new XoroshiroRandomSource(
      positionalScratch.high ^ this.seedLowHigh,
      positionalScratch.low ^ this.seedLowLow,
      this.seedHighHigh,
      this.seedHighLow,
    );
  }

  /**
   * `at(x, y, z)` without allocating: the same draws, from a shared source that the next `reusedAt` call (on any
   * factory) re-seeds. Only for callers that finish drawing before anything else can ask for a positional random.
   */
  reusedAt(x: number, y: number, z: number): XoroshiroRandomSource {
    noteHot(POSITIONAL_REUSED_AT);
    positionalSeedInto(x, y, z, positionalScratch);
    reusedPositionalSource.resetToRawState(
      positionalScratch.high ^ this.seedLowHigh,
      positionalScratch.low ^ this.seedLowLow,
      this.seedHighHigh,
      this.seedHighLow,
    );
    return reusedPositionalSource;
  }

  fromHashOf(name: string): XoroshiroRandomSource {
    noteHot(POSITIONAL_FROM_HASH);
    const words = seedWordsFromHashOf(name);
    return new XoroshiroRandomSource(
      words[0] ^ this.seedLowHigh,
      words[1] ^ this.seedLowLow,
      words[2] ^ this.seedHighHigh,
      words[3] ^ this.seedHighLow,
    );
  }

  fromSeed(seed: bigint): XoroshiroRandomSource {
    noteHot(POSITIONAL_FROM_SEED);
    bigIntToHalves(seed, positionalScratch);
    return new XoroshiroRandomSource(
      positionalScratch.high ^ this.seedLowHigh,
      positionalScratch.low ^ this.seedLowLow,
      this.seedHighHigh,
      this.seedHighLow,
    );
  }
}

/**
 * `factory.at(x, y, z)` for draws that finish right away: Xoroshiro factories hand out their shared reused source
 * (see reusedAt), other factories a new one. The draws are identical either way.
 */
export function transientRandomAt<Source>(factory: { at(x: number, y: number, z: number): Source }, x: number, y: number, z: number): Source {
  // A Xoroshiro factory's `at` returns XoroshiroRandomSource, so the reused source has the same type.
  return factory instanceof XoroshiroPositionalRandomFactory ? (factory.reusedAt(x, y, z) as Source) : factory.at(x, y, z);
}
