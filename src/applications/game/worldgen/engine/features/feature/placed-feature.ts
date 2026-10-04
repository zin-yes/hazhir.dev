// Mirrors ConfiguredFeature (feature type + parsed config) and PlacedFeature (configured feature + placement
// modifiers). Identity matters: like registry Holders, one id resolves to one object (FeatureSorter, the biome
// filter and BiomeGenerationSettings.hasFeature compare placed features by identity / key).

import type { RandomSource } from "../../random";
import { BlockPos } from "../core/block-pos";
import type { WorldGenLevel } from "../level/world-gen-level";
import { PlacementContext, type PlacementModifier } from "../placement/placement-modifier";
import type { FeatureChunkGenerator, FeatureType } from "./feature-type";

export class ConfiguredFeature<Config = unknown> {
  constructor(
    readonly type: FeatureType<Config>,
    readonly config: Config,
    /** Registry id when resolved from the configured_feature registry, undefined when inline. */
    readonly id: string | undefined,
  ) {}

  /** ConfiguredFeature.place -> Feature.place(config, level, generator, random, origin). */
  place(level: WorldGenLevel, generator: FeatureChunkGenerator, random: RandomSource, origin: BlockPos): boolean {
    if (!level.ensureCanWrite(origin.x, origin.y, origin.z)) return false;
    return this.type.place({ level, generator, random, origin, config: this.config });
  }
}

export class PlacedFeature {
  constructor(
    /** Registry id, or a unique "inline:..." key for placed features written inline in JSON. */
    readonly key: string,
    readonly feature: ConfiguredFeature,
    readonly placement: readonly PlacementModifier[],
  ) {}

  /** PlacedFeature.place: no biome check (used by composite features such as random_patch). */
  place(level: WorldGenLevel, generator: FeatureChunkGenerator, random: RandomSource, origin: BlockPos): boolean {
    return this.placeWithContext(new PlacementContext(level, generator, undefined), random, origin);
  }

  /** PlacedFeature.placeWithBiomeCheck: what ChunkGenerator.applyBiomeDecoration calls per feature index. */
  placeWithBiomeCheck(level: WorldGenLevel, generator: FeatureChunkGenerator, random: RandomSource, origin: BlockPos): boolean {
    return this.placeWithContext(new PlacementContext(level, generator, this), random, origin);
  }

  /**
   * The modifier chain's output without placing anything (diagnostics and tests). Matches the positions
   * placeWithBiomeCheck visits only when the feature itself draws no randomness.
   */
  placementPositions(level: WorldGenLevel, generator: FeatureChunkGenerator, random: RandomSource, origin: BlockPos, withBiomeCheck = true): BlockPos[] {
    const positions: BlockPos[] = [];
    this.walkPositions(new PlacementContext(level, generator, withBiomeCheck ? this : undefined), random, origin, (position) => positions.push(position));
    return positions;
  }

  private placeWithContext(context: PlacementContext, random: RandomSource, origin: BlockPos): boolean {
    let placedAny = false;
    this.walkPositions(context, random, origin, (position) => {
      if (this.feature.place(context.level, context.generator, random, position)) placedAny = true;
    });
    return placedAny;
  }

  /** Depth first, like the lazy Stream.flatMap chain: each position flows to the end before the next is produced. */
  private walkPositions(context: PlacementContext, random: RandomSource, origin: BlockPos, accept: (position: BlockPos) => void): void {
    const visit = (modifierIndex: number, position: BlockPos): void => {
      if (modifierIndex === this.placement.length) {
        accept(position);
        return;
      }
      for (const next of this.placement[modifierIndex]!.getPositions(context, random, position)) visit(modifierIndex + 1, next);
    };
    visit(0, origin instanceof BlockPos ? origin : BlockPos.of(origin));
  }
}
