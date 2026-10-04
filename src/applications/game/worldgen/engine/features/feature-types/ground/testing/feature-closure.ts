// Test support: the closure of a set of placed features over the placed and configured features they reference
// (registry ids in `feature`, `features`, `default` and `vegetation_feature` fields) plus every block name used by a
// block state ({Name, Properties}) along the way.

import type { WorldgenRegistries } from "../../../../registry/datapack-loader";

export interface FeatureClosure {
  readonly placedFeatureIds: Set<string>;
  readonly configuredFeatureIds: Set<string>;
  readonly blockNames: Set<string>;
}

function withDefaultNamespace(id: string): string {
  return id.includes(":") ? id : `minecraft:${id}`;
}

export function collectFeatureClosure(registries: Pick<WorldgenRegistries, "placed_feature" | "configured_feature">, rootPlacedFeatureIds: Iterable<string>): FeatureClosure {
  const closure: FeatureClosure = { placedFeatureIds: new Set(), configuredFeatureIds: new Set(), blockNames: new Set() };
  const visitValue = (value: unknown, isPlacedFeature: boolean): void => {
    if (Array.isArray(value)) {
      for (const entry of value) visitValue(entry, false);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    if (typeof object.Name === "string") closure.blockNames.add(withDefaultNamespace(object.Name));
    for (const [key, child] of Object.entries(object)) {
      if (key === "feature" || key === "features" || key === "default" || key === "vegetation_feature") {
        for (const entry of Array.isArray(child) ? child : [child]) {
          if (typeof entry === "string") visitReference(entry, isPlacedFeature && key === "feature");
        }
      }
      visitValue(child, key === "feature" && typeof child === "object" && child !== null && "placement" in child);
    }
  };
  const visitReference = (id: string, mustBeConfigured: boolean): void => {
    const qualified = withDefaultNamespace(id);
    if (!mustBeConfigured && registries.placed_feature[qualified]) {
      if (closure.placedFeatureIds.has(qualified)) return;
      closure.placedFeatureIds.add(qualified);
      visitValue(registries.placed_feature[qualified], true);
      return;
    }
    const configured = registries.configured_feature[qualified];
    if (!configured || closure.configuredFeatureIds.has(qualified)) return;
    closure.configuredFeatureIds.add(qualified);
    visitValue(configured, false);
  };
  for (const id of rootPlacedFeatureIds) visitReference(id, false);
  return closure;
}
