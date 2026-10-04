// Mirrors Climate.Sampler as RandomState builds it: the six climate router functions with every HolderHolder and
// Marker stripped (so no NoiseChunk caching), sampled at quart positions and quantized with Climate.quantizeCoord.

import { type DensityNode, MemoizingDensityVisitor, SinglePointContext } from "./density-function";
import { HolderNode, MarkerNode } from "./nodes/structural-nodes";
import type { NoiseRouter } from "./router-wiring";

/** Climate.TargetPoint: each parameter quantized to a long (x10000), held as a number. */
export interface TargetPoint {
  temperature: number;
  humidity: number;
  continentalness: number;
  erosion: number;
  depth: number;
  weirdness: number;
}

/** Climate.quantizeCoord(float): `(long)(value * 10000.0F)`, the input first narrowed to float. */
export function quantizeClimateCoordinate(value: number): number {
  const scaled = Math.fround(Math.fround(value) * 10000);
  return Number.isNaN(scaled) ? 0 : Math.trunc(scaled);
}

/** RandomState's second visitor: HolderHolder -> its value, Marker -> its wrapped function. */
export class StripMarkersVisitor extends MemoizingDensityVisitor {
  protected wrapNew(node: DensityNode): DensityNode {
    if (node instanceof HolderNode) return node.target;
    if (node instanceof MarkerNode) return node.wrapped;
    return node;
  }
}

export interface ClimateSampler {
  readonly temperature: DensityNode;
  readonly humidity: DensityNode;
  readonly continentalness: DensityNode;
  readonly erosion: DensityNode;
  readonly depth: DensityNode;
  readonly weirdness: DensityNode;
  sample(quartX: number, quartY: number, quartZ: number): TargetPoint;
}

export function createClimateSampler(router: NoiseRouter): ClimateSampler {
  const visitor = new StripMarkersVisitor();
  const temperature = visitor.map(router.temperature);
  const humidity = visitor.map(router.vegetation);
  const continentalness = visitor.map(router.continents);
  const erosion = visitor.map(router.erosion);
  const depth = visitor.map(router.depth);
  const weirdness = visitor.map(router.ridges);
  return {
    temperature,
    humidity,
    continentalness,
    erosion,
    depth,
    weirdness,
    sample(quartX: number, quartY: number, quartZ: number): TargetPoint {
      const context = new SinglePointContext(quartX << 2, quartY << 2, quartZ << 2);
      return {
        temperature: quantizeClimateCoordinate(temperature.compute(context)),
        humidity: quantizeClimateCoordinate(humidity.compute(context)),
        continentalness: quantizeClimateCoordinate(continentalness.compute(context)),
        erosion: quantizeClimateCoordinate(erosion.compute(context)),
        depth: quantizeClimateCoordinate(depth.compute(context)),
        weirdness: quantizeClimateCoordinate(weirdness.compute(context)),
      };
    },
  };
}
