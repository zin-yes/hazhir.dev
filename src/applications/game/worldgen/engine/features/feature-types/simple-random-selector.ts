// Mirrors SimpleRandomSelectorFeature (minecraft:simple_random_selector): one uniformly chosen placed feature.

import { defineFeatureType } from "../feature/feature-type";
import type { PlacedFeature } from "../feature/placed-feature";
import { asObject, type JsonValue } from "../providers/json-fields";
import type { FeatureParser } from "../feature/feature-parser";

export interface SimpleRandomSelectorConfig {
  readonly features: readonly PlacedFeature[];
}

/** PlacedFeature.LIST_CODEC (a homogeneous HolderSet): a list, or a single id / inline object. Tags are not supported. */
export function parsePlacedFeatureList(json: JsonValue | undefined, parser: FeatureParser, what: string): PlacedFeature[] {
  if (typeof json === "string" && json.startsWith("#")) throw new Error(`${what}: placed feature tags are not supported`);
  const entries = Array.isArray(json) ? json : [json];
  return entries.map((entry, index) => parser.placedFeature(entry, `${what}[${index}]`));
}

export const simpleRandomSelectorFeature = defineFeatureType<SimpleRandomSelectorConfig>({
  id: "minecraft:simple_random_selector",
  parseConfig(json, parser) {
    const config = asObject(json, "simple_random_selector config");
    return { features: parsePlacedFeatureList(config.features, parser, "simple_random_selector.features") };
  },
  place({ config, random, level, generator, origin }) {
    const chosen = config.features[random.nextIntBounded(config.features.length)]!;
    return chosen.place(level, generator, random, origin);
  },
});
