// Mirrors BiomeGenerationSettings.features() (one placed-feature list per generation step) and its featureSet
// (hasFeature, used by the biome placement filter). Registry references are keyed by id; inline placed features
// get a unique key per biome/step/position because Java creates a distinct object for each.

import type { JsonObject, JsonValue } from "../providers/json-fields";
import { normalizeTypeId } from "../providers/json-fields";

/** GenerationStep.Decoration in ordinal order. */
export const DECORATION_STEPS = [
  "raw_generation",
  "lakes",
  "local_modifications",
  "underground_structures",
  "surface_structures",
  "strongholds",
  "underground_ores",
  "underground_decoration",
  "fluid_springs",
  "vegetal_decoration",
  "top_layer_modification",
] as const;

export type DecorationStep = (typeof DECORATION_STEPS)[number];

interface BiomeFeatures {
  readonly steps: ReadonlyArray<readonly string[]>;
  readonly featureSet: ReadonlySet<string>;
}

export class BiomeFeatureIndex {
  private readonly featuresByBiome = new Map<string, BiomeFeatures>();
  private readonly inlineDefinitions = new Map<string, JsonValue>();

  constructor(private readonly biomeRegistry: Record<string, JsonObject>) {}

  private featuresOf(biomeId: string): BiomeFeatures {
    let features = this.featuresByBiome.get(biomeId);
    if (!features) {
      const biomeJson = this.biomeRegistry[biomeId];
      if (!biomeJson) throw new Error(`Unknown biome ${biomeId}`);
      const stepsJson = (biomeJson.features ?? []) as JsonValue[];
      const steps = stepsJson.map((stepJson, step) => {
        const entries = typeof stepJson === "string" ? [stepJson] : (stepJson as JsonValue[]);
        return entries.map((entry, position) => {
          if (typeof entry === "string") {
            if (entry.startsWith("#")) throw new Error(`Biome ${biomeId}: placed feature tags are not supported (${entry})`);
            return normalizeTypeId(entry);
          }
          const key = `inline:${biomeId}:${step}:${position}`;
          this.inlineDefinitions.set(key, entry);
          return key;
        });
      });
      features = { steps, featureSet: new Set(steps.flat()) };
      this.featuresByBiome.set(biomeId, features);
    }
    return features;
  }

  stepsOf(biomeId: string): ReadonlyArray<readonly string[]> {
    return this.featuresOf(biomeId).steps;
  }

  hasFeature(biomeId: string, placedFeatureKey: string): boolean {
    return this.featuresOf(biomeId).featureSet.has(placedFeatureKey);
  }

  /** The JSON of an inline placed feature key, undefined for registry ids. */
  inlineDefinition(placedFeatureKey: string): JsonValue | undefined {
    return this.inlineDefinitions.get(placedFeatureKey);
  }
}

/** BiomeSource.possibleBiomes for a multi_noise source: distinct biomes in parameter-list order. */
export function possibleBiomesOfDimension(overworldDimension: JsonObject): string[] {
  const generator = overworldDimension.generator as JsonObject | undefined;
  const biomeSource = generator?.biome_source as JsonObject | undefined;
  const entries = biomeSource?.biomes;
  if (!Array.isArray(entries)) throw new Error("possibleBiomesOfDimension needs an inline multi_noise biome list");
  const seen = new Set<string>();
  for (const entry of entries) seen.add(normalizeTypeId(String((entry as JsonObject).biome)));
  return [...seen];
}
