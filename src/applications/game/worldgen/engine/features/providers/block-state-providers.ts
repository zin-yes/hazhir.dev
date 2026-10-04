// Mirrors net.minecraft.world.level.levelgen.feature.stateproviders: simple, weighted, noise, noise_threshold,
// dual_noise, rotated_block and randomized_int providers, plus BlockState JSON ({Name, Properties}) parsing.
// Noise providers seed NormalNoise from new WorldgenRandom(new LegacyRandomSource(seed)), which behaves exactly
// like the bare LegacyRandomSource for noise construction (fork / forkPositional delegate to it).

import type { BlockStateCatalog } from "../../block-state";
import { formatBlockState } from "../../chunk";
import { type NoiseParameters, NormalNoise } from "../../noise";
import { LegacyRandomSource, type RandomSource } from "../../random";
import { AXES } from "../core/direction";
import { asArray, asObject, type JsonValue, requireNumber, requireString, typeOf } from "./json-fields";
import { type IntProvider, parseIntProvider, parseWeightedList, type SimpleWeightedRandomList } from "./value-providers";

const fround = Math.fround;

export interface BlockStateProvider {
  getState(random: RandomSource, x: number, y: number, z: number): string;
}

/** BlockState.CODEC: {Name, Properties?}; omitted properties take the block defaults. */
export function parseBlockState(json: JsonValue | undefined, catalog: BlockStateCatalog, what = "block state"): string {
  const object = asObject(json, what);
  const name = requireString(object, "Name", what);
  const qualifiedName = name.includes(":") ? name : `minecraft:${name}`;
  const properties = object.Properties === undefined ? undefined : (asObject(object.Properties, `${what}.Properties`) as Record<string, string>);
  if (!catalog.isKnownBlock(qualifiedName)) catalog.reportUnknownBlock(qualifiedName, what);
  return catalog.normalize(formatBlockState(qualifiedName, properties));
}

export function parseNoiseParameters(json: JsonValue | undefined, what = "noise parameters"): NoiseParameters {
  const object = asObject(json, what);
  return {
    firstOctave: requireNumber(object, "firstOctave", what),
    amplitudes: asArray(object.amplitudes, `${what}.amplitudes`).map((amplitude) => Number(amplitude)),
  };
}

/** NormalNoise.create(new WorldgenRandom(new LegacyRandomSource(seed)), parameters). */
export function createLegacySeededNoise(seed: bigint, parameters: NoiseParameters): NormalNoise {
  return NormalNoise.create(new LegacyRandomSource(seed), parameters);
}

function parseSeed(json: JsonValue | undefined, what: string): bigint {
  if (typeof json !== "number" || !Number.isSafeInteger(json)) throw new Error(`${what}: seed must be an integer within 2^53 (JSON numbers lose precision beyond)`);
  return BigInt(json);
}

/** InclusiveRange<Integer> codec: [min, max] or {min_inclusive, max_inclusive}. */
function parseInclusiveRange(json: JsonValue | undefined, what: string): { min: number; max: number } {
  if (Array.isArray(json)) return { min: Number(json[0]), max: Number(json[1]) };
  const object = asObject(json, what);
  return { min: requireNumber(object, "min_inclusive", what), max: requireNumber(object, "max_inclusive", what) };
}

/** Mth.clampedMap(value, fromMin, fromMax, toMin, toMax) in double precision. */
function clampedMap(value: number, fromMin: number, fromMax: number, toMin: number, toMax: number): number {
  const progress = (value - fromMin) / (fromMax - fromMin);
  if (progress < 0) return toMin;
  if (progress > 1) return toMax;
  return toMin + progress * (toMax - toMin);
}

/** NoiseProvider.getRandomState(list, noiseValue). */
function stateForNoise(states: readonly string[], noiseValue: number): string {
  const normalized = Math.min(Math.max((1 + noiseValue) / 2, 0), 0.9999);
  return states[Math.trunc(normalized * states.length)]!;
}

function randomElement<Value>(list: readonly Value[], random: RandomSource): Value {
  return list[random.nextIntBounded(list.length)]!;
}

export function parseBlockStateProvider(json: JsonValue | undefined, catalog: BlockStateCatalog, what = "block state provider"): BlockStateProvider {
  const object = asObject(json, what);
  const type = typeOf(object, what);
  const stateList = (field: string) => asArray(object[field], `${what}.${field}`).map((state) => parseBlockState(state, catalog, `${what}.${field}`));
  switch (type) {
    case "minecraft:simple_state_provider": {
      const state = parseBlockState(object.state, catalog, `${what}.state`);
      return { getState: () => state };
    }
    case "minecraft:weighted_state_provider": {
      const weighted: SimpleWeightedRandomList<string> = parseWeightedList(object.entries, (data) => parseBlockState(data, catalog, `${what} entry`), `${what}.entries`);
      return {
        getState: (random) => {
          const state = weighted.getRandomValue(random);
          if (state === undefined) throw new Error("weighted_state_provider is empty");
          return state;
        },
      };
    }
    case "minecraft:rotated_block_provider": {
      const state = parseBlockState(object.state, catalog, `${what}.state`);
      return { getState: (random) => catalog.withProperty(state, "axis", randomElement(AXES, random)) };
    }
    case "minecraft:randomized_int_state_provider": {
      const source = parseBlockStateProvider(object.source, catalog, `${what}.source`);
      const propertyName = requireString(object, "property", what);
      const values: IntProvider = parseIntProvider(object.values, `${what}.values`);
      return {
        getState: (random, x, y, z) => {
          const state = source.getState(random, x, y, z);
          return catalog.withProperty(state, propertyName, String(values.sample(random)));
        },
      };
    }
    case "minecraft:noise_provider":
    case "minecraft:noise_threshold_provider":
    case "minecraft:dual_noise_provider": {
      const seed = parseSeed(object.seed, what);
      const noise = createLegacySeededNoise(seed, parseNoiseParameters(object.noise, `${what}.noise`));
      const scale = fround(requireNumber(object, "scale", what));
      const noiseValueAt = (x: number, y: number, z: number, noiseScale: number) => noise.getValue(x * noiseScale, y * noiseScale, z * noiseScale);
      if (type === "minecraft:noise_threshold_provider") {
        const threshold = fround(requireNumber(object, "threshold", what));
        const highChance = fround(requireNumber(object, "high_chance", what));
        const defaultState = parseBlockState(object.default_state, catalog, `${what}.default_state`);
        const lowStates = stateList("low_states");
        const highStates = stateList("high_states");
        return {
          getState: (random, x, y, z) => {
            if (noiseValueAt(x, y, z, scale) < threshold) return randomElement(lowStates, random);
            if (random.nextFloat() < highChance) return randomElement(highStates, random);
            return defaultState;
          },
        };
      }
      const states = stateList("states");
      if (type === "minecraft:noise_provider") return { getState: (_random, x, y, z) => stateForNoise(states, noiseValueAt(x, y, z, scale)) };
      const variety = parseInclusiveRange(object.variety, `${what}.variety`);
      const slowNoise = createLegacySeededNoise(seed, parseNoiseParameters(object.slow_noise, `${what}.slow_noise`));
      const slowScale = fround(requireNumber(object, "slow_scale", what));
      // DualNoiseProvider.getSlowNoiseValue multiplies (float)coordinate by the float scale in float precision.
      const slowNoiseAt = (x: number, y: number, z: number) =>
        slowNoise.getValue(fround(fround(x) * slowScale), fround(fround(y) * slowScale), fround(fround(z) * slowScale));
      return {
        getState: (_random, x, y, z) => {
          const count = Math.trunc(clampedMap(slowNoiseAt(x, y, z), -1, 1, variety.min, variety.max + 1));
          const candidates: string[] = [];
          for (let index = 0; index < count; index++) {
            candidates.push(stateForNoise(states, slowNoiseAt(x + index * 54545, y, z + index * 34234)));
          }
          return stateForNoise(candidates, noiseValueAt(x, y, z, scale));
        },
      };
    }
    default:
      throw new Error(`Unknown block state provider type ${type}`);
  }
}
