// Structural views of the neighbouring engine modules, so the surface stage compiles and tests on its own.
// The real NoiseRouter, NoiseRegistry and PositionalRandomFactory are assignable to these.

export interface DensityPoint {
  blockX: number;
  blockY: number;
  blockZ: number;
}

export interface SurfaceNoiseRouter {
  initialDensityWithoutJaggedness: { compute(point: DensityPoint): number };
}

export interface SurfaceNoiseSource {
  getValue(x: number, y: number, z: number): number;
}

export interface SurfaceNoiseRegistry {
  get(noiseId: string): SurfaceNoiseSource;
}

export interface SurfaceRandomSource {
  nextIntBounded(bound: number): number;
  nextIntBetweenInclusive(min: number, max: number): number;
  nextBoolean(): boolean;
  nextFloat(): number;
  nextDouble(): number;
}

export interface SurfacePositionalRandomFactory {
  at(x: number, y: number, z: number): SurfaceRandomSource;
  fromHashOf(name: string): SurfaceRandomSource & { forkPositional(): SurfacePositionalRandomFactory };
}

export type TemperatureModifier = "none" | "frozen";

export interface BiomeClimate {
  temperature: number;
  temperatureModifier: TemperatureModifier;
}

export type BiomeClimateLookup = (biomeId: string) => BiomeClimate;

export type BiomeAtBlock = (blockX: number, blockY: number, blockZ: number) => string;

export function withDefaultNamespace(identifier: string): string {
  return identifier.includes(":") ? identifier : `minecraft:${identifier}`;
}
