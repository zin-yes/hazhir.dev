// Turns a full datapack load into the pruned, compact files committed under `data/`.
// Pure (no filesystem access): the script `scripts/compile-terralith-data.ts` loads the packs and writes the result.

import type { DatapackLoadResult, JsonObject, JsonValue } from "../engine/registry/datapack-loader";
import { encodeBiomes } from "./compact-biomes";
import { encodeDimension } from "./compact-dimension";
import { OVERWORLD_NOISE_SETTINGS_ID } from "./constants";
import { stringifyStableJson } from "./stable-json";


/** Fields of a noise settings entry that world generation never reads. */
const UNUSED_NOISE_SETTINGS_FIELDS = ["spawn_target"];

type Registry = Record<string, JsonObject>;

function pickRegistry(registry: Registry, ids: Iterable<string>): Registry {
  const picked: Registry = {};
  for (const id of ids) {
    if (registry[id] === undefined) throw new Error(`Registry entry ${id} is referenced but missing`);
    picked[id] = registry[id]!;
  }
  return picked;
}

function collectStrings(value: JsonValue, collected: Set<string>): void {
  if (typeof value === "string") collected.add(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, collected);
  else if (value !== null && typeof value === "object") for (const item of Object.values(value)) collectStrings(item, collected);
}

function withDefaultNamespace(id: string): string {
  return id.includes(":") ? id : `minecraft:${id}`;
}

/** Transitive closure: every registry entry whose id appears as a string value inside an included entry. */
function closureOfReferences(roots: Iterable<string>, registries: Registry[]): Set<string> {
  const included = new Set<string>();
  const pending = [...roots].map(withDefaultNamespace);
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (included.has(id)) continue;
    const entries = registries.map((registry) => registry[id]).filter((entry): entry is JsonObject => entry !== undefined);
    if (entries.length === 0) continue;
    included.add(id);
    const referenced = new Set<string>();
    for (const entry of entries) collectStrings(entry, referenced);
    for (const candidate of referenced) pending.push(withDefaultNamespace(candidate));
  }
  return included;
}

function biomeIdsOfDimension(dimension: JsonObject): string[] {
  const biomeSource = (dimension.generator as JsonObject).biome_source as JsonObject;
  return [...new Set((biomeSource.biomes as JsonObject[]).map((entry) => entry.biome as string))];
}

function featureIdsOfBiomes(biomes: Registry): string[] {
  const ids = new Set<string>();
  for (const biome of Object.values(biomes)) collectStrings((biome.features ?? []) as JsonValue, ids);
  return [...ids];
}

function pickReferencedTags(tags: Record<string, string[]>, ...sources: JsonValue[]): Record<string, string[]> {
  const strings = new Set<string>();
  for (const source of sources) collectStrings(source, strings);
  const picked: Record<string, string[]> = {};
  for (const text of strings) {
    if (!text.startsWith("#")) continue;
    const tagId = withDefaultNamespace(text.slice(1));
    if (tags[tagId] !== undefined) picked[tagId] = tags[tagId]!;
  }
  return picked;
}

export interface CompiledDataFiles {
  /** File name under `data/` -> minified JSON text. */
  files: Record<string, string>;
  summary: Record<string, number>;
}

export function compileTerralithData(loaded: DatapackLoadResult): CompiledDataFiles {
  const { registries, overworldDimension } = loaded;
  if (overworldDimension === null) throw new Error("The datapacks define no overworld dimension");

  const biomes = pickRegistry(registries.biome, biomeIdsOfDimension(overworldDimension));
  const overworldNoiseSettings = { ...registries.noise_settings[OVERWORLD_NOISE_SETTINGS_ID] } as JsonObject;
  if (registries.noise_settings[OVERWORLD_NOISE_SETTINGS_ID] === undefined) throw new Error(`Missing ${OVERWORLD_NOISE_SETTINGS_ID} noise settings`);
  for (const field of UNUSED_NOISE_SETTINGS_FIELDS) delete overworldNoiseSettings[field];

  const densityFunctionIds = closureOfReferences(
    [...collectStringsOf(overworldNoiseSettings)],
    [registries.density_function],
  );
  const featureIds = closureOfReferences(featureIdsOfBiomes(biomes), [registries.placed_feature, registries.configured_feature]);
  const placedFeatures = pickRegistry(registries.placed_feature, [...featureIds].filter((id) => registries.placed_feature[id] !== undefined));
  const configuredFeatures = pickRegistry(registries.configured_feature, [...featureIds].filter((id) => registries.configured_feature[id] !== undefined));
  const carvers = registries.configured_carver;

  const blockTags = pickReferencedTags(loaded.blockTags, carvers, placedFeatures, configuredFeatures, overworldNoiseSettings);
  const biomeTags = loaded.biomeTags;

  const serializable = (value: unknown) => value as JsonValue;
  const files: Record<string, string> = {
    "biomes.json": stringifyStableJson(serializable(encodeBiomes(biomes))),
    "biome-tags.json": stringifyStableJson(biomeTags),
    "block-tags.json": stringifyStableJson(blockTags),
    "configured-carvers.json": stringifyStableJson(carvers),
    "configured-features.json": stringifyStableJson(configuredFeatures),
    "density-functions.json": stringifyStableJson(pickRegistry(registries.density_function, densityFunctionIds)),
    "dimension-overworld.json": stringifyStableJson(encodeDimension(overworldDimension)),
    "noise-settings-overworld.json": stringifyStableJson(overworldNoiseSettings),
    "noises.json": stringifyStableJson(registries.noise),
    "placed-features.json": stringifyStableJson(placedFeatures),
  };
  const summary = Object.fromEntries(Object.entries(files).map(([name, text]) => [name, text.length]));
  return { files, summary };
}

function collectStringsOf(value: JsonValue): Set<string> {
  const collected = new Set<string>();
  collectStrings(value, collected);
  return collected;
}
