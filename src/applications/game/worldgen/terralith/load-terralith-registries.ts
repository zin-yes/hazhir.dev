// Runtime access to the compiled Terralith data. The JSON files are static imports, so Next bundles them into the
// worker and Bun reads them in tests; nothing touches the filesystem.

import type { DatapackLoadResult, JsonObject, WorldgenRegistries } from "../engine/registry/datapack-loader";
import { decodeBiomes, type CompactBiomeTable } from "./compact-biomes";
import { decodeDimension } from "./compact-dimension";
import biomeTagsJson from "./data/biome-tags.json";
import biomesJson from "./data/biomes.json";
import blockTagsJson from "./data/block-tags.json";
import configuredCarversJson from "./data/configured-carvers.json";
import configuredFeaturesJson from "./data/configured-features.json";
import densityFunctionsJson from "./data/density-functions.json";
import dimensionOverworldJson from "./data/dimension-overworld.json";
import noiseSettingsOverworldJson from "./data/noise-settings-overworld.json";
import noisesJson from "./data/noises.json";
import placedFeaturesJson from "./data/placed-features.json";
import { OVERWORLD_NOISE_SETTINGS_ID } from "./constants";

export type TerralithRegistries = Omit<DatapackLoadResult, "overworldDimension"> & { overworldDimension: JsonObject };

let loadedRegistries: TerralithRegistries | undefined;

function asRegistry(json: unknown): Record<string, JsonObject> {
  return json as Record<string, JsonObject>;
}

/** Decoded once per thread; the result is shared, treat it as read-only. */
export function loadTerralithRegistries(): TerralithRegistries {
  if (loadedRegistries !== undefined) return loadedRegistries;
  const registries: WorldgenRegistries = {
    biome: decodeBiomes(biomesJson as unknown as CompactBiomeTable),
    configured_carver: asRegistry(configuredCarversJson),
    configured_feature: asRegistry(configuredFeaturesJson),
    density_function: asRegistry(densityFunctionsJson),
    noise: asRegistry(noisesJson),
    noise_settings: { [OVERWORLD_NOISE_SETTINGS_ID]: noiseSettingsOverworldJson as unknown as JsonObject },
    placed_feature: asRegistry(placedFeaturesJson),
    structure: {},
    structure_set: {},
    processor_list: {},
    template_pool: {},
  };
  loadedRegistries = {
    registries,
    overworldDimension: decodeDimension(dimensionOverworldJson as unknown as JsonObject),
    blockTags: blockTagsJson as Record<string, string[]>,
    biomeTags: biomeTagsJson as Record<string, string[]>,
  };
  return loadedRegistries;
}
