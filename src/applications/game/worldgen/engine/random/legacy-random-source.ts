// Mirrors net.minecraft.world.level.levelgen.LegacyRandomSource (the java.util.Random 48-bit LCG)
// with the BitRandomSource defaults, plus LegacyRandomSource.LegacyPositionalRandomFactory.
// The 48-bit state is two 24-bit halves so every intermediate product stays exact in a double.

import { javaStringHashCode } from "./hashing";
import { bigIntToHalves, halvesToBigInt, type Int64Halves, positionalSeedInto } from "./int64";
import { MarsagliaPolarGaussian } from "./marsaglia-polar-gaussian";
import type { PositionalRandomFactory, RandomSource } from "./random-source";

const TWO_POW_24 = 16777216;
// MULTIPLIER = 0x5DEECE66D = MULTIPLIER_HIGH * 2^24 + MULTIPLIER_LOW
const MULTIPLIER_HIGH = 0x5de;
const MULTIPLIER_LOW = 0xece66d;
const INCREMENT = 11;
const SCRAMBLER_HIGH = 0x5;
const SCRAMBLER_LOW = 0xdeece66d | 0;
const FLOAT_UNIT = 5.9604644775390625e-8; // 2^-24
const DOUBLE_UNIT = 1.1102230246251565e-16; // 2^-53
const TWO_POW_27 = 134217728;
const POWERS_OF_TWO: number[] = [];
for (let exponent = 0; exponent <= 48; exponent++) POWERS_OF_TWO.push(2 ** exponent);

const scratchHalves: Int64Halves = { high: 0, low: 0 };

export class LegacyRandomSource implements RandomSource {
  private stateHigh = 0;
  private stateLow = 0;
  /** Created on first use: most random sources (positional ones especially) never draw a gaussian. */
  private gaussianSource: MarsagliaPolarGaussian | undefined;

  constructor(seed: bigint);
  /** Internal: seed given as int32 halves of a Java long. */
  constructor(seedHigh: number, seedLow: number);
  constructor(seedOrHigh: bigint | number, seedLow = 0) {
    if (typeof seedOrHigh === "bigint") {
      bigIntToHalves(seedOrHigh, scratchHalves);
      this.setSeedFromHalves(scratchHalves.high, scratchHalves.low);
    } else {
      this.setSeedFromHalves(seedOrHigh, seedLow);
    }
  }

  /** `(seed ^ 0x5DEECE66DL) & 0xFFFFFFFFFFFFL`. */
  private setSeedFromHalves(seedHigh: number, seedLow: number): void {
    const scrambledHigh = seedHigh ^ SCRAMBLER_HIGH;
    const scrambledLow = seedLow ^ SCRAMBLER_LOW;
    this.stateLow = scrambledLow & 0xffffff;
    this.stateHigh = ((scrambledHigh & 0xffff) << 8) | (scrambledLow >>> 24);
  }

  /** Java `next(int bits)`: advances the LCG and returns the top `bits` bits as an int. */
  next(bits: number): number {
    const lowProduct = this.stateLow * MULTIPLIER_LOW + INCREMENT;
    const carry = Math.floor(lowProduct / TWO_POW_24);
    const newLow = lowProduct - carry * TWO_POW_24;
    const highProduct = this.stateHigh * MULTIPLIER_LOW + this.stateLow * MULTIPLIER_HIGH + carry;
    const newHigh = highProduct - Math.floor(highProduct / TWO_POW_24) * TWO_POW_24;
    this.stateHigh = newHigh;
    this.stateLow = newLow;
    return Math.floor((newHigh * TWO_POW_24 + newLow) / POWERS_OF_TWO[48 - bits]) | 0;
  }

  nextInt(): number {
    return this.next(32);
  }

  nextIntBounded(bound: number): number {
    if (bound <= 0) throw new Error("Bound must be positive");
    if ((bound & (bound - 1)) === 0) {
      // (int)((long)bound * (long)next(31) >> 31); exact in a double because bound is a power of two.
      return Math.floor((bound * this.next(31)) / 2147483648) | 0;
    }
    let candidate: number;
    let remainder: number;
    do {
      candidate = this.next(31);
      remainder = candidate % bound;
    } while (((candidate - remainder + (bound - 1)) | 0) < 0);
    return remainder;
  }

  nextIntBetweenInclusive(min: number, max: number): number {
    return (this.nextIntBounded((max - min + 1) | 0) + min) | 0;
  }

  nextIntInRange(origin: number, bound: number): number {
    if (origin >= bound) throw new Error("bound - origin is non positive");
    return (origin + this.nextIntBounded((bound - origin) | 0)) | 0;
  }

  /** `((long)next(32) << 32) + (long)next(32)` written into `out` without BigInt. */
  nextLongInto(out: Int64Halves): void {
    const high = this.next(32);
    const low = this.next(32);
    out.high = (high + (low >> 31)) | 0;
    out.low = low;
  }

  nextLong(): bigint {
    this.nextLongInto(scratchHalves);
    return halvesToBigInt(scratchHalves.high, scratchHalves.low);
  }

  nextBoolean(): boolean {
    return this.next(1) !== 0;
  }

  nextFloat(): number {
    return this.next(24) * FLOAT_UNIT;
  }

  nextDouble(): number {
    const high = this.next(26);
    const low = this.next(27);
    return (high * TWO_POW_27 + low) * DOUBLE_UNIT;
  }

  nextGaussian(): number {
    return (this.gaussianSource ??= new MarsagliaPolarGaussian(this)).nextGaussian();
  }

  triangle(center: number, spread: number): number {
    return center + spread * (this.nextDouble() - this.nextDouble());
  }

  skip(count: number): void {
    for (let index = 0; index < count; index++) this.next(32);
  }

  fork(): LegacyRandomSource {
    this.nextLongInto(scratchHalves);
    return new LegacyRandomSource(scratchHalves.high, scratchHalves.low);
  }

  forkPositional(): LegacyPositionalRandomFactory {
    this.nextLongInto(scratchHalves);
    return new LegacyPositionalRandomFactory(scratchHalves.high, scratchHalves.low);
  }

  setSeed(seed: bigint): void {
    bigIntToHalves(seed, scratchHalves);
    this.setSeedFromHalves(scratchHalves.high, scratchHalves.low);
    this.gaussianSource?.reset();
  }
}

const positionalScratch: Int64Halves = { high: 0, low: 0 };

/** Mirrors LegacyRandomSource.LegacyPositionalRandomFactory. */
export class LegacyPositionalRandomFactory implements PositionalRandomFactory {
  constructor(
    private readonly seedHigh: number,
    private readonly seedLow: number,
  ) {}

  static withSeed(seed: bigint): LegacyPositionalRandomFactory {
    bigIntToHalves(seed, positionalScratch);
    return new LegacyPositionalRandomFactory(positionalScratch.high, positionalScratch.low);
  }

  get seed(): bigint {
    return halvesToBigInt(this.seedHigh, this.seedLow);
  }

  at(x: number, y: number, z: number): LegacyRandomSource {
    positionalSeedInto(x, y, z, positionalScratch);
    return new LegacyRandomSource(positionalScratch.high ^ this.seedHigh, positionalScratch.low ^ this.seedLow);
  }

  fromHashOf(name: string): LegacyRandomSource {
    const hash = javaStringHashCode(name);
    return new LegacyRandomSource((hash >> 31) ^ this.seedHigh, hash ^ this.seedLow);
  }

  fromSeed(seed: bigint): LegacyRandomSource {
    bigIntToHalves(seed, positionalScratch);
    return new LegacyRandomSource(positionalScratch.high ^ this.seedHigh, positionalScratch.low ^ this.seedLow);
  }
}
