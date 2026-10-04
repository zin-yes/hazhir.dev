// Mirrors net.minecraft.world.level.levelgen.WorldgenRandom: a LegacyRandomSource subclass whose next(bits) delegates
// to a wrapped source (top bits of nextLong() when the wrapped source is not a LegacyRandomSource), so nextInt,
// nextFloat, nextDouble and nextLong use the java.util.Random formulas on top of Xoroshiro output.
// Quirk kept on purpose: setSeed is overridden without resetting the Gaussian cache, so the second value of a
// Marsaglia pair survives setFeatureSeed (ChunkGenerator.applyBiomeDecoration reseeds once per feature).

import {
  type Int64Halves,
  LegacyRandomSource,
  MarsagliaPolarGaussian,
  type PositionalRandomFactory,
  type RandomSource,
  XoroshiroRandomSource,
  halvesToBigInt,
} from "../../random";

const FLOAT_UNIT = 5.9604644775390625e-8; // (double)5.9604645E-8f == 2^-24
const DOUBLE_UNIT = 1.1102230246251565e-16; // (double)1.110223E-16f == 2^-53
const TWO_POW_27 = 134217728;
const scratch: Int64Halves = { high: 0, low: 0 };

export class WorldgenRandom implements RandomSource {
  private drawCount = 0;
  private readonly gaussianSource = new MarsagliaPolarGaussian(this);

  private readonly legacySource: LegacyRandomSource | undefined;
  private readonly xoroshiroSource: XoroshiroRandomSource | undefined;

  constructor(private readonly source: RandomSource) {
    this.legacySource = source instanceof LegacyRandomSource ? source : undefined;
    this.xoroshiroSource = source instanceof XoroshiroRandomSource ? source : undefined;
  }

  /** WorldgenRandom.getCount: number of next(bits) calls so far. */
  get count(): number {
    return this.drawCount;
  }

  next(bits: number): number {
    this.drawCount++;
    if (this.legacySource !== undefined) return this.legacySource.next(bits);
    if (this.xoroshiroSource !== undefined) {
      this.xoroshiroSource.nextLongInto(scratch);
    } else {
      const value = BigInt.asUintN(64, this.source.nextLong());
      scratch.high = Number(value >> BigInt(32)) | 0;
      scratch.low = Number(value & BigInt(0xffffffff)) | 0;
    }
    // (int)(nextLong() >>> (64 - bits)) for bits <= 32 only needs the high half.
    return bits === 32 ? scratch.high | 0 : (scratch.high >>> (32 - bits)) | 0;
  }

  nextInt(): number {
    return this.next(32);
  }

  nextIntBounded(bound: number): number {
    if (bound <= 0) throw new Error("Bound must be positive");
    if ((bound & (bound - 1)) === 0) return Math.floor((bound * this.next(31)) / 2147483648) | 0;
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

  private nextLongHalves(out: Int64Halves): void {
    const high = this.next(32);
    const low = this.next(32);
    out.high = (high + (low >> 31)) | 0;
    out.low = low;
  }

  nextLong(): bigint {
    this.nextLongHalves(scratch);
    return halvesToBigInt(scratch.high, scratch.low);
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
    return this.gaussianSource.nextGaussian();
  }

  triangle(center: number, spread: number): number {
    return center + spread * (this.nextDouble() - this.nextDouble());
  }

  skip(count: number): void {
    for (let index = 0; index < count; index++) this.next(32);
  }

  fork(): RandomSource {
    return this.source.fork();
  }

  forkPositional(): PositionalRandomFactory {
    return this.source.forkPositional();
  }

  setSeed(seed: bigint): void {
    this.source.setSeed(seed);
  }

  /** WorldgenRandom.setDecorationSeed: seeds per chunk origin and returns the decoration seed. */
  setDecorationSeed(levelSeed: bigint, minBlockX: number, minBlockZ: number): bigint {
    this.setSeed(levelSeed);
    const xMultiplier = this.nextLong() | BigInt(1);
    const zMultiplier = this.nextLong() | BigInt(1);
    const decorationSeed = BigInt.asIntN(64, (BigInt(minBlockX) * xMultiplier + BigInt(minBlockZ) * zMultiplier) ^ levelSeed);
    this.setSeed(decorationSeed);
    return decorationSeed;
  }

  /** WorldgenRandom.setFeatureSeed: decorationSeed + featureIndex + 10000 * step. */
  setFeatureSeed(decorationSeed: bigint, featureIndex: number, step: number): void {
    this.setSeed(BigInt.asIntN(64, decorationSeed + BigInt(featureIndex) + BigInt(10000 * step)));
  }
}

/** ChunkGenerator.applyBiomeDecoration's random: the Xoroshiro seed is irrelevant because it is reseeded at once. */
export function createDecorationRandom(): WorldgenRandom {
  return new WorldgenRandom(new XoroshiroRandomSource(BigInt(0)));
}
