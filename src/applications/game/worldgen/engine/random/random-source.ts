// Mirrors net.minecraft.util.RandomSource and net.minecraft.world.level.levelgen.PositionalRandomFactory.
// Java `long` values cross this API as bigint; Java `int` as a number in int32 range.

export interface RandomSource {
  /** Java `nextInt()`: a uniformly distributed int32. */
  nextInt(): number;
  /** Java `nextInt(int bound)`: uniform in [0, bound), bound must be positive. */
  nextIntBounded(bound: number): number;
  /** Java `nextIntBetweenInclusive(min, max)`. */
  nextIntBetweenInclusive(min: number, max: number): number;
  /** Java `nextInt(int origin, int bound)`: uniform in [origin, bound). */
  nextIntInRange(origin: number, bound: number): number;
  nextLong(): bigint;
  nextBoolean(): boolean;
  nextFloat(): number;
  nextDouble(): number;
  nextGaussian(): number;
  /** Java `triangle(center, spread)`. */
  triangle(center: number, spread: number): number;
  /** Java `consumeCount(count)`. */
  skip(count: number): void;
  fork(): RandomSource;
  forkPositional(): PositionalRandomFactory;
  setSeed(seed: bigint): void;
}

export interface PositionalRandomFactory {
  /** Java `at(x, y, z)`: a source seeded from `Mth.getSeed(x, y, z)` mixed with this factory's seed. */
  at(x: number, y: number, z: number): RandomSource;
  /** Xoroshiro: md5(name) xor seed. Legacy: String.hashCode xor seed. */
  fromHashOf(name: string): RandomSource;
  /** What `at` does after computing the positional seed: the given long mixed with this factory's seed. */
  fromSeed(seed: bigint): RandomSource;
}
