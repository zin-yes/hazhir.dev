// FloatProvider, HeightProvider and VerticalAnchor as the carver configs use them (1.20.6 JSON), with the exact
// float arithmetic and random call order of the Java samplers.

import type { RandomSource } from "../random";
import type { JsonValue } from "../registry/datapack-loader";

const fround = Math.fround;

export interface FloatProvider {
  /** Returns a Java float (as a double holding a float value). */
  sample(random: RandomSource): number;
}

/** Block coordinates of the generation area, as WorldGenerationContext exposes them. */
export interface GenerationHeights {
  minGenY: number;
  genDepth: number;
}

export interface HeightProvider {
  sample(random: RandomSource, heights: GenerationHeights): number;
}

export type VerticalAnchor = (heights: GenerationHeights) => number;

function asObject(value: JsonValue | undefined, description: string): { [key: string]: JsonValue } {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be an object, got ${JSON.stringify(value)}`);
  }
  return value;
}

function asNumber(value: JsonValue | undefined, description: string): number {
  if (typeof value !== "number") throw new Error(`${description} must be a number, got ${JSON.stringify(value)}`);
  return value;
}

function stripNamespace(typeId: JsonValue | undefined): string {
  return String(typeId).replace(/^minecraft:/, "");
}

/** Mth.randomBetween(random, min, max) in float arithmetic. */
function randomBetweenFloat(random: RandomSource, min: number, max: number): number {
  return fround(fround(random.nextFloat() * fround(max - min)) + min);
}

export function parseFloatProvider(json: JsonValue | undefined): FloatProvider {
  if (typeof json === "number") {
    const constant = fround(json);
    return { sample: () => constant };
  }
  const object = asObject(json, "float provider");
  switch (stripNamespace(object.type)) {
    case "constant": {
      const constant = fround(asNumber(object.value, "constant float value"));
      return { sample: () => constant };
    }
    case "uniform": {
      const min = fround(asNumber(object.min_inclusive, "uniform float min_inclusive"));
      const max = fround(asNumber(object.max_exclusive, "uniform float max_exclusive"));
      return { sample: (random) => randomBetweenFloat(random, min, max) };
    }
    case "trapezoid": {
      const min = fround(asNumber(object.min, "trapezoid float min"));
      const max = fround(asNumber(object.max, "trapezoid float max"));
      const plateau = fround(asNumber(object.plateau, "trapezoid float plateau"));
      return {
        sample: (random) => {
          const span = fround(max - min);
          const slope = fround(fround(span - plateau) / 2);
          const body = fround(span - slope);
          const first = fround(random.nextFloat() * body);
          const second = fround(random.nextFloat() * slope);
          return fround(fround(min + first) + second);
        },
      };
    }
    case "clamped_normal": {
      const mean = fround(asNumber(object.mean, "clamped_normal mean"));
      const deviation = fround(asNumber(object.deviation, "clamped_normal deviation"));
      const min = fround(asNumber(object.min, "clamped_normal min"));
      const max = fround(asNumber(object.max, "clamped_normal max"));
      return {
        sample: (random) => {
          const normal = fround(mean + fround(fround(random.nextGaussian()) * deviation));
          return normal < min ? min : Math.min(normal, max);
        },
      };
    }
    default:
      throw new Error(`Unsupported float provider type ${String(object.type)}`);
  }
}

export function parseVerticalAnchor(json: JsonValue | undefined): VerticalAnchor {
  const object = asObject(json, "vertical anchor");
  if (typeof object.absolute === "number") {
    const absolute = object.absolute;
    return () => absolute;
  }
  if (typeof object.above_bottom === "number") {
    const offset = object.above_bottom;
    return (heights) => heights.minGenY + offset;
  }
  if (typeof object.below_top === "number") {
    const offset = object.below_top;
    return (heights) => heights.genDepth - 1 + heights.minGenY - offset;
  }
  throw new Error(`Unsupported vertical anchor ${JSON.stringify(json)}`);
}

function randomBetweenInclusive(random: RandomSource, min: number, max: number): number {
  return random.nextIntBounded(max - min + 1) + min;
}

export function parseHeightProvider(json: JsonValue | undefined): HeightProvider {
  const object = asObject(json, "height provider");
  if (object.type === undefined) {
    const anchor = parseVerticalAnchor(json);
    return { sample: (_random, heights) => anchor(heights) };
  }
  switch (stripNamespace(object.type)) {
    case "constant": {
      const anchor = parseVerticalAnchor(object.value);
      return { sample: (_random, heights) => anchor(heights) };
    }
    case "uniform": {
      const minInclusive = parseVerticalAnchor(object.min_inclusive);
      const maxInclusive = parseVerticalAnchor(object.max_inclusive);
      return {
        sample: (random, heights) => {
          const min = minInclusive(heights);
          const max = maxInclusive(heights);
          return min > max ? min : randomBetweenInclusive(random, min, max);
        },
      };
    }
    case "biased_to_bottom": {
      const minInclusive = parseVerticalAnchor(object.min_inclusive);
      const maxInclusive = parseVerticalAnchor(object.max_inclusive);
      const inner = typeof object.inner === "number" ? object.inner : 1;
      return {
        sample: (random, heights) => {
          const min = minInclusive(heights);
          const max = maxInclusive(heights);
          if (max - min - inner + 1 <= 0) return min;
          const bound = random.nextIntBounded(max - min - inner + 1);
          return random.nextIntBounded(bound + inner) + min;
        },
      };
    }
    case "trapezoid": {
      const minInclusive = parseVerticalAnchor(object.min_inclusive);
      const maxInclusive = parseVerticalAnchor(object.max_inclusive);
      const plateau = typeof object.plateau === "number" ? object.plateau : 0;
      return {
        sample: (random, heights) => {
          const min = minInclusive(heights);
          const max = maxInclusive(heights);
          if (min > max) return min;
          const span = max - min;
          if (plateau >= span) return randomBetweenInclusive(random, min, max);
          const slope = Math.trunc((span - plateau) / 2);
          const body = span - slope;
          const first = randomBetweenInclusive(random, 0, body);
          const second = randomBetweenInclusive(random, 0, slope);
          return min + first + second;
        },
      };
    }
    default:
      throw new Error(`Unsupported height provider type ${String(object.type)}`);
  }
}
