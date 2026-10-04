// Resolves configured_feature / placed_feature JSON (registry ids or inline objects, like RegistryFileCodec) into
// ConfiguredFeature / PlacedFeature objects, and exposes the codec helpers feature types use in parseConfig.
// Lenient resolvers (runtime) turn unregistered feature types, unknown placement modifiers and parse errors into
// a placeholder feature that places nothing and is counted in `diagnostics`; strict resolvers (tests) throw.

import type { BlockStateCatalog } from "../../block-state";
import type { WorldgenRegistries } from "../../registry/datapack-loader";
import { Direction } from "../core/direction";
import { type PlacementModifier, PlacementModifierTypeRegistry } from "../placement/placement-modifier";
import { VANILLA_PLACEMENT_MODIFIER_TYPES } from "../placement/vanilla-placement-modifiers";
import { type BlockPredicate, type BlockSet, parseBlockPredicate, parseBlockSet } from "../providers/block-predicates";
import { type BlockStateProvider, parseBlockState, parseBlockStateProvider } from "../providers/block-state-providers";
import { asArray, asObject, type JsonValue, normalizeTypeId, typeOf } from "../providers/json-fields";
import {
  type FloatProvider,
  type HeightProvider,
  type IntProvider,
  parseFloatProvider,
  parseHeightProvider,
  parseIntProvider,
  parseVerticalAnchor,
  type VerticalAnchor,
} from "../providers/value-providers";
import { defineFeatureType, type FeatureType, FeatureTypeRegistry } from "./feature-type";
import { ConfiguredFeature, PlacedFeature } from "./placed-feature";

/** Codec helpers available to FeatureType.parseConfig implementations. */
export interface FeatureParser {
  readonly blockStates: BlockStateCatalog;
  placedFeature(json: JsonValue | undefined, what?: string): PlacedFeature;
  configuredFeature(json: JsonValue | undefined, what?: string): ConfiguredFeature;
  blockState(json: JsonValue | undefined, what?: string): string;
  blockStateProvider(json: JsonValue | undefined, what?: string): BlockStateProvider;
  blockPredicate(json: JsonValue | undefined, what?: string): BlockPredicate;
  blockSet(json: JsonValue | undefined, what?: string): BlockSet;
  intProvider(json: JsonValue | undefined, what?: string): IntProvider;
  floatProvider(json: JsonValue | undefined, what?: string): FloatProvider;
  heightProvider(json: JsonValue | undefined, what?: string): HeightProvider;
  verticalAnchor(json: JsonValue | undefined, what?: string): VerticalAnchor;
  direction(json: JsonValue | undefined, what?: string): Direction;
}

export class FeatureDiagnostics {
  /** Feature type id -> number of configured features using it that could not be resolved. */
  readonly unsupportedFeatureTypes = new Map<string, number>();
  /** Placed/configured feature id -> parse error message. */
  readonly parseErrors = new Map<string, string>();
  /** Feature id -> number of placements that threw (lenient decoration skips the feature). */
  readonly placementErrors = new Map<string, number>();

  count(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) ?? 0) + 1);
  }
}

export interface FeatureResolverOptions {
  registries: Pick<WorldgenRegistries, "configured_feature" | "placed_feature">;
  blockStates: BlockStateCatalog;
  featureTypes: FeatureTypeRegistry;
  placementModifierTypes?: PlacementModifierTypeRegistry;
  /** Throw on unregistered types and parse errors instead of substituting a no-op placeholder. */
  strict?: boolean;
  diagnostics?: FeatureDiagnostics;
}

export class FeatureResolver implements FeatureParser {
  readonly blockStates: BlockStateCatalog;
  readonly diagnostics: FeatureDiagnostics;
  readonly strict: boolean;
  private readonly registries: FeatureResolverOptions["registries"];
  private readonly featureTypes: FeatureTypeRegistry;
  private readonly placementModifierTypes: PlacementModifierTypeRegistry;
  private readonly placedById = new Map<string, PlacedFeature>();
  private readonly configuredById = new Map<string, ConfiguredFeature>();
  private readonly resolving = new Set<string>();
  private inlineCounter = 0;

  constructor(options: FeatureResolverOptions) {
    this.registries = options.registries;
    this.blockStates = options.blockStates;
    this.featureTypes = options.featureTypes;
    this.placementModifierTypes = options.placementModifierTypes ?? new PlacementModifierTypeRegistry(VANILLA_PLACEMENT_MODIFIER_TYPES);
    this.strict = options.strict ?? false;
    this.diagnostics = options.diagnostics ?? new FeatureDiagnostics();
  }

  /** A registry id ("minecraft:patch_grass_plain") or an inline {feature, placement} object. */
  placedFeature(json: JsonValue | undefined, what = "placed feature"): PlacedFeature {
    if (typeof json === "string") {
      const id = normalizeTypeId(json);
      const cached = this.placedById.get(id);
      if (cached) return cached;
      const definition = this.registries.placed_feature[id];
      if (!definition) throw new Error(`${what}: unknown placed feature ${id}`);
      this.guardCycle(`placed:${id}`);
      try {
        const created = this.buildPlacedFeature(definition, id, id);
        this.placedById.set(id, created);
        return created;
      } finally {
        this.resolving.delete(`placed:${id}`);
      }
    }
    return this.buildPlacedFeature(asObject(json, what), `inline:${this.inlineCounter++}`, what);
  }

  private buildPlacedFeature(json: JsonValue, key: string, what: string): PlacedFeature {
    try {
      const object = asObject(json, what);
      const feature = this.configuredFeature(object.feature, `${what}.feature`);
      const placement = asArray(object.placement ?? [], `${what}.placement`).map((modifierJson, index) => this.placementModifier(modifierJson, `${what}.placement[${index}]`));
      return new PlacedFeature(key, feature, placement);
    } catch (error) {
      return new PlacedFeature(key, this.failedFeature(key, error), []);
    }
  }

  private placementModifier(json: JsonValue, what: string): PlacementModifier {
    const object = asObject(json, what);
    const typeId = typeOf(object, what);
    const type = this.placementModifierTypes.get(typeId);
    if (!type) throw new Error(`${what}: unknown placement modifier type ${typeId}`);
    return type.parse(object, this);
  }

  /** A registry id or an inline {type, config} object. */
  configuredFeature(json: JsonValue | undefined, what = "configured feature"): ConfiguredFeature {
    if (typeof json === "string") {
      const id = normalizeTypeId(json);
      const cached = this.configuredById.get(id);
      if (cached) return cached;
      const definition = this.registries.configured_feature[id];
      if (!definition) throw new Error(`${what}: unknown configured feature ${id}`);
      this.guardCycle(`configured:${id}`);
      try {
        const created = this.buildConfiguredFeature(definition, id, id);
        this.configuredById.set(id, created);
        return created;
      } finally {
        this.resolving.delete(`configured:${id}`);
      }
    }
    return this.buildConfiguredFeature(asObject(json, what), undefined, what);
  }

  private buildConfiguredFeature(json: JsonValue, id: string | undefined, what: string): ConfiguredFeature {
    const object = asObject(json, what);
    const typeId = typeOf(object, what);
    const type = this.featureTypes.get(typeId);
    if (!type) {
      if (this.strict) throw new Error(`${what}: feature type ${typeId} is not registered`);
      this.diagnostics.count(this.diagnostics.unsupportedFeatureTypes, typeId);
      return new ConfiguredFeature(unsupportedFeatureType(typeId), undefined, id);
    }
    try {
      return new ConfiguredFeature(type, type.parseConfig(object.config, this), id);
    } catch (error) {
      return this.failedFeature(id ?? what, error);
    }
  }

  private failedFeature(key: string, error: unknown): ConfiguredFeature {
    if (this.strict) throw error;
    this.diagnostics.parseErrors.set(key, error instanceof Error ? error.message : String(error));
    return new ConfiguredFeature(unsupportedFeatureType("engine:parse_error"), undefined, key);
  }

  private guardCycle(key: string): void {
    if (this.resolving.has(key)) throw new Error(`Feature reference cycle through ${key}`);
    this.resolving.add(key);
  }

  blockState(json: JsonValue | undefined, what = "block state"): string {
    return parseBlockState(json, this.blockStates, what);
  }

  blockStateProvider(json: JsonValue | undefined, what = "block state provider"): BlockStateProvider {
    return parseBlockStateProvider(json, this.blockStates, what);
  }

  blockPredicate(json: JsonValue | undefined, what = "block predicate"): BlockPredicate {
    return parseBlockPredicate(json, this.blockStates, what);
  }

  blockSet(json: JsonValue | undefined, what = "block set"): BlockSet {
    return parseBlockSet(json, this.blockStates, what);
  }

  intProvider(json: JsonValue | undefined, what?: string): IntProvider {
    return parseIntProvider(json, what);
  }

  floatProvider(json: JsonValue | undefined, what?: string): FloatProvider {
    return parseFloatProvider(json, what);
  }

  heightProvider(json: JsonValue | undefined, what?: string): HeightProvider {
    return parseHeightProvider(json, what);
  }

  verticalAnchor(json: JsonValue | undefined, what?: string): VerticalAnchor {
    return parseVerticalAnchor(json, what);
  }

  direction(json: JsonValue | undefined, what = "direction"): Direction {
    if (typeof json !== "string") throw new Error(`${what} must be a direction name`);
    return Direction.fromName(json);
  }
}

const unsupportedTypes = new Map<string, FeatureType<undefined>>();

/** Placeholder for feature types no agent has ported yet: places nothing, consumes no randomness. */
export function unsupportedFeatureType(typeId: string): FeatureType<undefined> {
  let type = unsupportedTypes.get(typeId);
  if (!type) {
    type = defineFeatureType<undefined>({ id: typeId, parseConfig: () => undefined, place: () => false });
    unsupportedTypes.set(typeId, type);
  }
  return type;
}

export function isUnsupportedFeature(feature: ConfiguredFeature): boolean {
  return unsupportedTypes.get(feature.type.id) === feature.type;
}
