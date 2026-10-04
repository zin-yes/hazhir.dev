// The feature extension point. Mirrors net.minecraft.world.level.levelgen.feature.Feature (one instance per type
// id, `place(FeaturePlaceContext)`), its configuration codec (`parseConfig`) and FeaturePlaceContext.
// To add a feature type, write one file under feature-types/ exporting `defineFeatureType({...})` and list it in
// feature-types/index.ts (see engine/features/README.md for a worked example).

import type { RandomSource } from "../../random";
import type { BlockPos } from "../core/block-pos";
import type { WorldGenLevel } from "../level/world-gen-level";
import type { JsonValue } from "../providers/json-fields";
import type { FeatureParser } from "./feature-parser";
import type { ConfiguredFeature, PlacedFeature } from "./placed-feature";

/** The parts of ChunkGenerator that features and placement modifiers read. */
export interface FeatureChunkGenerator {
  /** ChunkGenerator.getMinY (noise settings min_y). */
  readonly minY: number;
  /** ChunkGenerator.getGenDepth (noise settings height). */
  readonly genDepth: number;
  readonly seaLevel: number;
  /** getBiomeGenerationSettings(biome).hasFeature(placedFeature): any step of the biome lists the feature. */
  biomeHasFeature(biomeId: string, feature: PlacedFeature): boolean;
}

export interface FeaturePlaceContext<Config> {
  readonly level: WorldGenLevel;
  readonly generator: FeatureChunkGenerator;
  readonly random: RandomSource;
  readonly origin: BlockPos;
  readonly config: Config;
  /** FeaturePlaceContext.topFeature: empty for features placed through PlacedFeature (vanilla never sets it there). */
  readonly topFeature?: ConfiguredFeature;
}

export interface FeatureType<Config> {
  /** Registry id, e.g. "minecraft:random_patch". */
  readonly id: string;
  /** The configuration codec: `json` is the configured feature's "config" object. */
  parseConfig(json: JsonValue | undefined, parser: FeatureParser): Config;
  /** Feature.place(FeaturePlaceContext). Return true when something was placed. */
  place(context: FeaturePlaceContext<Config>): boolean;
}

export function defineFeatureType<Config>(type: FeatureType<Config>): FeatureType<Config> {
  return type;
}

/** Any FeatureType regardless of its config type (method parameters are bivariant, so every FeatureType fits). */
export interface AnyFeatureType {
  readonly id: string;
  parseConfig(json: JsonValue | undefined, parser: FeatureParser): unknown;
  place(context: FeaturePlaceContext<never>): boolean;
}

export class FeatureTypeRegistry {
  private readonly typesById = new Map<string, FeatureType<unknown>>();

  constructor(types: readonly AnyFeatureType[] = []) {
    for (const type of types) this.register(type);
  }

  register(type: AnyFeatureType): this {
    if (this.typesById.has(type.id)) throw new Error(`Feature type ${type.id} is registered twice`);
    this.typesById.set(type.id, type as FeatureType<unknown>);
    return this;
  }

  get(id: string): FeatureType<unknown> | undefined {
    return this.typesById.get(id);
  }

  ids(): string[] {
    return [...this.typesById.keys()];
  }
}
