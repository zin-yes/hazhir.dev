// Mirrors net.minecraft.util.valueproviders (IntProvider, FloatProvider), net.minecraft.util.random weighted lists,
// VerticalAnchor, WorldGenerationContext and net.minecraft.world.level.levelgen.heightproviders.
// Float providers return float32 values (Math.fround) because the Java fields and arithmetic are float.

import type { RandomSource } from "../../random";
import { asArray, asObject, type JsonValue, optionalNumber, requireNumber, typeOf } from "./json-fields";

const fround = Math.fround;

// ---- weighted lists (SimpleWeightedRandomList / WeightedRandom) -------------------------------------------------

export interface WeightedEntry<Value> {
  readonly data: Value;
  readonly weight: number;
}

export class SimpleWeightedRandomList<Value> {
  readonly totalWeight: number;

  constructor(readonly entries: ReadonlyArray<WeightedEntry<Value>>) {
    let total = 0;
    for (const entry of entries) total += entry.weight;
    if (total > 2147483647) throw new Error("Sum of weights must be <= 2147483647");
    this.totalWeight = total;
  }

  /** WeightedRandomList.getRandom: one nextInt(totalWeight) draw, then walk the entries. */
  getRandomValue(random: RandomSource): Value | undefined {
    if (this.totalWeight === 0) return undefined;
    let remaining = random.nextIntBounded(this.totalWeight);
    for (const entry of this.entries) {
      remaining -= entry.weight;
      if (remaining < 0) return entry.data;
    }
    return undefined;
  }
}

export function parseWeightedList<Value>(json: JsonValue | undefined, parseData: (data: JsonValue) => Value, what: string): SimpleWeightedRandomList<Value> {
  const entries = asArray(json, what).map((entryJson) => {
    const entry = asObject(entryJson, `${what} entry`);
    const weight = requireNumber(entry, "weight", `${what} entry`);
    if (entry.data === undefined) throw new Error(`${what} entry needs "data"`);
    return { data: parseData(entry.data), weight };
  });
  if (entries.length === 0) throw new Error(`${what} must not be empty`);
  return new SimpleWeightedRandomList(entries);
}

// ---- Mth helpers -------------------------------------------------------------------------------------------------

/** Mth.randomBetweenInclusive. */
export function randomBetweenInclusive(random: RandomSource, minInclusive: number, maxInclusive: number): number {
  return (random.nextIntBounded((maxInclusive - minInclusive + 1) | 0) + minInclusive) | 0;
}

/** Mth.nextInt(random, min, max): min when min >= max. */
export function mthNextInt(random: RandomSource, minInclusive: number, maxInclusive: number): number {
  return minInclusive >= maxInclusive ? minInclusive : randomBetweenInclusive(random, minInclusive, maxInclusive);
}

/** Mth.normal (float): mean + (float)nextGaussian * deviation. */
export function mthNormal(random: RandomSource, mean: number, deviation: number): number {
  return fround(mean + fround(fround(random.nextGaussian()) * deviation));
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

// ---- IntProvider ------------------------------------------------------------------------------------------------

export interface IntProvider {
  sample(random: RandomSource): number;
  readonly minValue: number;
  readonly maxValue: number;
}

export function constantInt(value: number): IntProvider {
  return { sample: () => value, minValue: value, maxValue: value };
}

/** IntProvider.CODEC: a bare int is ConstantInt, otherwise a typed object. */
export function parseIntProvider(json: JsonValue | undefined, what = "int provider"): IntProvider {
  if (typeof json === "number") return constantInt(json);
  const object = asObject(json, what);
  const type = typeOf(object, what);
  switch (type) {
    case "minecraft:constant":
      return constantInt(requireNumber(object, "value", what));
    case "minecraft:uniform": {
      const minInclusive = requireNumber(object, "min_inclusive", what);
      const maxInclusive = requireNumber(object, "max_inclusive", what);
      return { sample: (random) => randomBetweenInclusive(random, minInclusive, maxInclusive), minValue: minInclusive, maxValue: maxInclusive };
    }
    case "minecraft:biased_to_bottom": {
      const minInclusive = requireNumber(object, "min_inclusive", what);
      const maxInclusive = requireNumber(object, "max_inclusive", what);
      return {
        sample: (random) => (minInclusive + random.nextIntBounded(random.nextIntBounded(maxInclusive - minInclusive + 1) + 1)) | 0,
        minValue: minInclusive,
        maxValue: maxInclusive,
      };
    }
    case "minecraft:clamped": {
      const source = parseIntProvider(object.source, `${what}.source`);
      const minInclusive = requireNumber(object, "min_inclusive", what);
      const maxInclusive = requireNumber(object, "max_inclusive", what);
      return {
        sample: (random) => clamp(source.sample(random), minInclusive, maxInclusive),
        minValue: Math.max(minInclusive, source.minValue),
        maxValue: Math.min(maxInclusive, source.maxValue),
      };
    }
    case "minecraft:clamped_normal": {
      const mean = fround(requireNumber(object, "mean", what));
      const deviation = fround(requireNumber(object, "deviation", what));
      const minInclusive = requireNumber(object, "min_inclusive", what);
      const maxInclusive = requireNumber(object, "max_inclusive", what);
      // ClampedNormalInt.sample: (int)Mth.clamp(Mth.normal(...), (float)min, (float)max)
      return { sample: (random) => Math.trunc(clamp(mthNormal(random, mean, deviation), minInclusive, maxInclusive)), minValue: minInclusive, maxValue: maxInclusive };
    }
    case "minecraft:weighted_list": {
      const distribution = parseWeightedList(object.distribution, (data) => parseIntProvider(data, `${what} entry`), `${what}.distribution`);
      let minValue = 2147483647;
      let maxValue = -2147483648;
      for (const entry of distribution.entries) {
        minValue = Math.min(minValue, entry.data.minValue);
        maxValue = Math.max(maxValue, entry.data.maxValue);
      }
      return {
        sample: (random) => {
          const chosen = distribution.getRandomValue(random);
          if (!chosen) throw new Error("weighted_list int provider is empty");
          return chosen.sample(random);
        },
        minValue,
        maxValue,
      };
    }
    default:
      throw new Error(`Unknown int provider type ${type}`);
  }
}

// ---- FloatProvider ----------------------------------------------------------------------------------------------

export interface FloatProvider {
  sample(random: RandomSource): number;
  readonly minValue: number;
  readonly maxValue: number;
}

export function parseFloatProvider(json: JsonValue | undefined, what = "float provider"): FloatProvider {
  if (typeof json === "number") {
    const value = fround(json);
    return { sample: () => value, minValue: value, maxValue: fround(value + 1) };
  }
  const object = asObject(json, what);
  const type = typeOf(object, what);
  switch (type) {
    case "minecraft:constant": {
      const value = fround(requireNumber(object, "value", what));
      return { sample: () => value, minValue: value, maxValue: fround(value + 1) };
    }
    case "minecraft:uniform": {
      const minInclusive = fround(requireNumber(object, "min_inclusive", what));
      const maxExclusive = fround(requireNumber(object, "max_exclusive", what));
      const span = fround(maxExclusive - minInclusive);
      // Mth.randomBetween: nextFloat() * (max - min) + min, all float.
      return { sample: (random) => fround(fround(random.nextFloat() * span) + minInclusive), minValue: minInclusive, maxValue: maxExclusive };
    }
    case "minecraft:clamped_normal": {
      const mean = fround(requireNumber(object, "mean", what));
      const deviation = fround(requireNumber(object, "deviation", what));
      const min = fround(requireNumber(object, "min", what));
      const max = fround(requireNumber(object, "max", what));
      return { sample: (random) => clamp(mthNormal(random, mean, deviation), min, max), minValue: min, maxValue: max };
    }
    case "minecraft:trapezoid": {
      const min = fround(requireNumber(object, "min", what));
      const max = fround(requireNumber(object, "max", what));
      const plateau = fround(requireNumber(object, "plateau", what));
      const range = fround(max - min);
      const slope = fround(fround(range - plateau) / 2);
      const upper = fround(range - slope);
      return {
        sample: (random) => fround(fround(min + fround(random.nextFloat() * upper)) + fround(random.nextFloat() * slope)),
        minValue: min,
        maxValue: max,
      };
    }
    default:
      throw new Error(`Unknown float provider type ${type}`);
  }
}

// ---- VerticalAnchor / WorldGenerationContext / HeightProvider ---------------------------------------------------

/** WorldGenerationContext: minY = max(level min, generator min), height = min(level height, generator depth). */
export interface WorldGenerationContext {
  readonly minGenY: number;
  readonly genDepth: number;
}

export type VerticalAnchor = { readonly kind: "absolute" | "above_bottom" | "below_top"; readonly value: number };

export function parseVerticalAnchor(json: JsonValue | undefined, what = "vertical anchor"): VerticalAnchor {
  const object = asObject(json, what);
  for (const kind of ["absolute", "above_bottom", "below_top"] as const) {
    if (object[kind] !== undefined) return { kind, value: requireNumber(object, kind, what) };
  }
  throw new Error(`${what} needs absolute, above_bottom or below_top`);
}

export function resolveVerticalAnchor(anchor: VerticalAnchor, context: WorldGenerationContext): number {
  switch (anchor.kind) {
    case "absolute":
      return anchor.value;
    case "above_bottom":
      return context.minGenY + anchor.value;
    case "below_top":
      return context.genDepth - 1 + context.minGenY - anchor.value;
  }
}

export interface HeightProvider {
  sample(random: RandomSource, context: WorldGenerationContext): number;
}

/** HeightProvider.CODEC: a bare VerticalAnchor is ConstantHeight, otherwise a typed object. */
export function parseHeightProvider(json: JsonValue | undefined, what = "height provider"): HeightProvider {
  const object = asObject(json, what);
  if (object.type === undefined) {
    const anchor = parseVerticalAnchor(object, what);
    return { sample: (_random, context) => resolveVerticalAnchor(anchor, context) };
  }
  const type = typeOf(object, what);
  switch (type) {
    case "minecraft:constant": {
      const anchor = parseVerticalAnchor(object.value, `${what}.value`);
      return { sample: (_random, context) => resolveVerticalAnchor(anchor, context) };
    }
    case "minecraft:uniform": {
      const minAnchor = parseVerticalAnchor(object.min_inclusive, `${what}.min_inclusive`);
      const maxAnchor = parseVerticalAnchor(object.max_inclusive, `${what}.max_inclusive`);
      return {
        sample: (random, context) => {
          const minY = resolveVerticalAnchor(minAnchor, context);
          const maxY = resolveVerticalAnchor(maxAnchor, context);
          return minY > maxY ? minY : randomBetweenInclusive(random, minY, maxY);
        },
      };
    }
    case "minecraft:trapezoid": {
      const minAnchor = parseVerticalAnchor(object.min_inclusive, `${what}.min_inclusive`);
      const maxAnchor = parseVerticalAnchor(object.max_inclusive, `${what}.max_inclusive`);
      const plateau = optionalNumber(object, "plateau", 0);
      return {
        sample: (random, context) => {
          const minY = resolveVerticalAnchor(minAnchor, context);
          const maxY = resolveVerticalAnchor(maxAnchor, context);
          if (minY > maxY) return minY;
          const range = maxY - minY;
          if (plateau >= range) return randomBetweenInclusive(random, minY, maxY);
          const slope = Math.trunc((range - plateau) / 2);
          const upper = range - slope;
          return minY + randomBetweenInclusive(random, 0, upper) + randomBetweenInclusive(random, 0, slope);
        },
      };
    }
    case "minecraft:biased_to_bottom":
    case "minecraft:very_biased_to_bottom": {
      const minAnchor = parseVerticalAnchor(object.min_inclusive, `${what}.min_inclusive`);
      const maxAnchor = parseVerticalAnchor(object.max_inclusive, `${what}.max_inclusive`);
      const inner = optionalNumber(object, "inner", 1);
      const veryBiased = type === "minecraft:very_biased_to_bottom";
      return {
        sample: (random, context) => {
          const minY = resolveVerticalAnchor(minAnchor, context);
          const maxY = resolveVerticalAnchor(maxAnchor, context);
          if (maxY - minY - inner + 1 <= 0) return minY;
          if (!veryBiased) {
            const spread = random.nextIntBounded(maxY - minY - inner + 1);
            return random.nextIntBounded(spread + inner) + minY;
          }
          const first = mthNextInt(random, minY + inner, maxY);
          const second = mthNextInt(random, minY, first - 1);
          return mthNextInt(random, minY, second - 1 + inner);
        },
      };
    }
    case "minecraft:weighted_list": {
      const distribution = parseWeightedList(object.distribution, (data) => parseHeightProvider(data, `${what} entry`), `${what}.distribution`);
      return {
        sample: (random, context) => {
          const chosen = distribution.getRandomValue(random);
          if (!chosen) throw new Error("weighted_list height provider is empty");
          return chosen.sample(random, context);
        },
      };
    }
    default:
      throw new Error(`Unknown height provider type ${type}`);
  }
}
