// Mirrors net.minecraft.world.level.levelgen.MarsagliaPolarGaussian (same algorithm as java.util.Random.nextGaussian).

export interface UniformDoubleSource {
  nextDouble(): number;
}

export class MarsagliaPolarGaussian {
  private nextNextGaussian = 0;
  private haveNextNextGaussian = false;

  constructor(private readonly randomSource: UniformDoubleSource) {}

  reset(): void {
    this.haveNextNextGaussian = false;
  }

  nextGaussian(): number {
    if (this.haveNextNextGaussian) {
      this.haveNextNextGaussian = false;
      return this.nextNextGaussian;
    }
    let first: number;
    let second: number;
    let squaredRadius: number;
    do {
      first = 2.0 * this.randomSource.nextDouble() - 1.0;
      second = 2.0 * this.randomSource.nextDouble() - 1.0;
      squaredRadius = first * first + second * second;
    } while (squaredRadius >= 1.0 || squaredRadius === 0.0);
    const multiplier = Math.sqrt((-2.0 * Math.log(squaredRadius)) / squaredRadius);
    this.nextNextGaussian = second * multiplier;
    this.haveNextNextGaussian = true;
    return first * multiplier;
  }
}
