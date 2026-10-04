// Mirrors net.minecraft.world.level.biome.Climate: Parameter, ParameterPoint, TargetPoint and ParameterList.
import type { JsonObject, JsonValue } from "../registry/datapack-loader";

/** Quantized climate coordinates (value * 10000, truncated), the same shape the density module produces. */
export interface TargetPoint {
  temperature: number;
  humidity: number;
  continentalness: number;
  erosion: number;
  depth: number;
  weirdness: number;
}

export const CLIMATE_DIMENSION_COUNT = 7; // temperature, humidity, continentalness, erosion, depth, weirdness, offset

/** Climate.quantizeCoord: (long)(coord * 10000.0F) with the coordinate and the product both held as floats. */
export function quantizeCoordinate(coordinate: number): number {
  return Math.trunc(Math.fround(Math.fround(coordinate) * 10000)) + 0; // + 0 turns -0 into 0
}

export interface ParameterPoint {
  biome: string;
  /** Quantized inclusive [min, max] intervals in order temperature, humidity, continentalness, erosion, depth, weirdness, offset. */
  intervals: number[][];
}

const PARAMETER_NAMES = ["temperature", "humidity", "continentalness", "erosion", "depth", "weirdness"] as const;

function parseInterval(rawValue: JsonValue | undefined, label: string): number[] {
  if (typeof rawValue === "number") {
    const quantized = quantizeCoordinate(rawValue);
    return [quantized, quantized];
  }
  if (Array.isArray(rawValue) && rawValue.length === 2 && typeof rawValue[0] === "number" && typeof rawValue[1] === "number") {
    if (rawValue[0] > rawValue[1]) throw new Error(`Climate parameter ${label} has min greater than max`);
    return [quantizeCoordinate(rawValue[0]), quantizeCoordinate(rawValue[1])];
  }
  throw new Error(`Climate parameter ${label} must be a number or a [min, max] pair`);
}

export function parseParameterPoints(biomeSourceJson: JsonObject): ParameterPoint[] {
  const entries = biomeSourceJson.biomes;
  if (!Array.isArray(entries)) throw new Error("multi_noise biome source needs a 'biomes' list");
  return entries.map((entry, entryIndex) => {
    const entryObject = entry as JsonObject;
    const parameters = entryObject.parameters as JsonObject;
    const intervals = PARAMETER_NAMES.map((name) => parseInterval(parameters[name], `${name} of entry ${entryIndex}`));
    intervals.push(parseInterval(parameters.offset, `offset of entry ${entryIndex}`));
    return { biome: entryObject.biome as string, intervals };
  });
}

/** Climate.Parameter.distance: 0 inside the interval, otherwise the distance to the nearest bound. */
export function intervalDistance(minimum: number, maximum: number, target: number): number {
  const above = target - maximum;
  if (above > 0) return above;
  const below = minimum - target;
  return below > 0 ? below : 0;
}

export function targetToParameterArray(target: TargetPoint): number[] {
  return [target.temperature, target.humidity, target.continentalness, target.erosion, target.depth, target.weirdness, 0];
}

/** Climate.ParameterPoint.fitness: sum of squared per-dimension distances (offset dimension targets 0). */
export function parameterPointFitness(point: ParameterPoint, targetArray: number[]): number {
  let fitness = 0;
  for (let dimension = 0; dimension < CLIMATE_DIMENSION_COUNT; dimension++) {
    const interval = point.intervals[dimension];
    const distance = intervalDistance(interval[0], interval[1], targetArray[dimension]);
    fitness += distance * distance;
  }
  return fitness;
}

/** Reference search: linear scan, the lowest index wins ties. Used to verify the R-tree. */
export function findBestParameterPointBruteForce(points: ParameterPoint[], target: TargetPoint): { index: number; fitness: number } {
  const targetArray = targetToParameterArray(target);
  let bestIndex = -1;
  let bestFitness = Infinity;
  for (let index = 0; index < points.length; index++) {
    const fitness = parameterPointFitness(points[index], targetArray);
    if (fitness < bestFitness) {
      bestFitness = fitness;
      bestIndex = index;
    }
  }
  return { index: bestIndex, fitness: bestFitness };
}
