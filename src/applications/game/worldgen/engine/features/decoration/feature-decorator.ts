// On-demand biome decoration. Mirrors ChunkGenerator.applyBiomeDecoration for one origin chunk (seeding, step
// loop, per-step feature indices of the biomes present in the 3x3 chunks, placeWithBiomeCheck), run inside a
// DecorationRegion over base columns. Because the game asks for one column at a time and needs a pure function of
// (seed, chunk), the decorated column C is the base column plus the patches written by the 9 origin chunks around
// C, applied in raster order (ascending chunkZ, then chunkX: later origins win where writes overlap). Vanilla's
// cross-chunk order dependence (a chunk decorating on top of its neighbors' earlier writes) is not reproduced:
// each origin decorates against base terrain only. Structures (which share the step loop) are not placed here.

import { BlockStateCatalog, BlockTagIndex, type BlockTagRegistry, SurvivalRules } from "../../block-state";
import { ChunkBlocks } from "../../chunk";
import { BoundedLruCache, packChunkColumnKey } from "../../pipeline/bounded-lru-cache";
import type { WorldgenRegistries } from "../../registry/datapack-loader";
import { BiomeTemperatureSampler, createBiomeClimateLookup } from "../../surface/biome-temperature";
import { BlockPos } from "../core/block-pos";
import { createDecorationRandom } from "../core/worldgen-random";
import { FeatureDiagnostics, FeatureResolver } from "../feature/feature-parser";
import type { FeatureChunkGenerator, FeatureTypeRegistry } from "../feature/feature-type";
import type { PlacedFeature } from "../feature/placed-feature";
import { createDefaultFeatureTypeRegistry } from "../feature-types";
import { type BaseColumnSource, collectChunkBiomes } from "../level/base-column-source";
import {
  addFeatureCounter,
  endDecorationSection,
  featureProfileState,
  flushOriginCounters,
  isFeatureProfilingActive,
  openFeatureSection,
  recoverOpenSections,
  resetFeatureProfileState,
  startDecorationSection,
  startSampledDecorationSection,
  stepSectionName,
} from "../profiling/feature-profiling";
import { BaseHeightmapCache, type ColumnPatch, DecorationRegion } from "../level/decoration-region";
import { BiomeFeatureIndex, DECORATION_STEPS } from "./biome-features";
import { buildFeaturesPerStep, type StepFeatureData } from "./feature-sorter";

export interface FeatureDecoratorParams {
  source: BaseColumnSource;
  seed: bigint;
  registries: Pick<WorldgenRegistries, "biome" | "configured_feature" | "placed_feature">;
  blockTags: BlockTagRegistry;
  /** BiomeSource.possibleBiomes() in order (see possibleBiomesOfDimension). */
  possibleBiomes: readonly string[];
  featureTypes?: FeatureTypeRegistry;
  blockStates?: BlockStateCatalog;
  /** Throw on unknown blocks, unregistered feature types and feature errors (tests). */
  strict?: boolean;
  /** Origin patches kept in memory (each origin is needed by 9 columns). */
  maxCachedOrigins?: number;
}

export interface OriginDecoration {
  readonly chunkX: number;
  readonly chunkZ: number;
  readonly decorationSeed: bigint;
  /** Biomes of the 3x3 chunks that are possible biomes (the set the step loop draws features from). */
  readonly biomes: readonly string[];
  readonly patches: readonly ColumnPatch[];
}

export interface OriginDecorationTrace {
  readonly step: number;
  readonly featureIndex: number;
  readonly featureKey: string;
  readonly placed: boolean;
}

export class FeatureDecorator {
  readonly blockStates: BlockStateCatalog;
  readonly blockTags: BlockTagIndex;
  readonly survival: SurvivalRules;
  readonly resolver: FeatureResolver;
  readonly biomeFeatures: BiomeFeatureIndex;
  readonly diagnostics: FeatureDiagnostics;
  readonly generator: FeatureChunkGenerator;
  private readonly source: BaseColumnSource;
  private readonly seed: bigint;
  private readonly possibleBiomes: ReadonlySet<string>;
  private readonly possibleBiomeOrder: readonly string[];
  private readonly strict: boolean;
  private readonly originCache: BoundedLruCache<number, OriginDecoration>;
  private readonly baseHeightmaps = new BaseHeightmapCache();
  private stepData: StepFeatureData[] | undefined;

  constructor(params: FeatureDecoratorParams) {
    this.source = params.source;
    this.seed = params.seed;
    this.strict = params.strict ?? false;
    this.blockStates = params.blockStates ?? new BlockStateCatalog({ strict: this.strict });
    this.blockTags = new BlockTagIndex(params.blockTags);
    this.survival = new SurvivalRules(this.blockStates);
    this.diagnostics = new FeatureDiagnostics();
    this.biomeFeatures = new BiomeFeatureIndex(params.registries.biome);
    this.resolver = new FeatureResolver({
      registries: params.registries,
      blockStates: this.blockStates,
      featureTypes: params.featureTypes ?? createDefaultFeatureTypeRegistry(),
      strict: this.strict,
      diagnostics: this.diagnostics,
    });
    this.possibleBiomeOrder = [...params.possibleBiomes];
    this.possibleBiomes = new Set(params.possibleBiomes);
    this.originCache = new BoundedLruCache(params.maxCachedOrigins ?? 48);
    const biomeFeatures = this.biomeFeatures;
    const temperatureSampler = new BiomeTemperatureSampler(createBiomeClimateLookup(params.registries.biome));
    this.generator = {
      biomeTemperature: (biomeId, x, y, z) => temperatureSampler.getTemperature(biomeId, x, y, z),
      minY: params.source.settings.minY,
      genDepth: params.source.settings.height,
      seaLevel: params.source.settings.seaLevel,
      biomeHasFeature: (biomeId: string, feature: PlacedFeature) => biomeFeatures.hasFeature(biomeId, feature.key),
    };
  }

  /** ChunkGenerator.featuresPerStep (memoized FeatureSorter over the possible biomes). */
  get featuresPerStep(): StepFeatureData[] {
    this.stepData ??= buildFeaturesPerStep(this.possibleBiomeOrder, (biome) => this.biomeFeatures.stepsOf(biome));
    return this.stepData;
  }

  placedFeatureByKey(featureKey: string): PlacedFeature {
    startSampledDecorationSection("feature.resolve", 16);
    const placedFeature = this.resolver.placedFeature(this.biomeFeatures.inlineDefinition(featureKey) ?? featureKey, featureKey);
    endDecorationSection();
    return placedFeature;
  }

  /** Decorates one origin chunk against base terrain and returns its clipped writes (cached). */
  decorateOrigin(chunkX: number, chunkZ: number, trace?: OriginDecorationTrace[]): OriginDecoration {
    const cacheKey = packChunkColumnKey(chunkX, chunkZ);
    const cached = trace ? undefined : this.originCache.get(cacheKey);
    if (cached) {
      addFeatureCounter("decoration.originCacheHits", 1);
      return cached;
    }
    addFeatureCounter("decoration.originCacheMisses", 1);
    const region = this.createRegion(chunkX, chunkZ);
    const decoration = this.decorateInRegion(region, trace);
    region.releaseColumnCopies();
    this.originCache.set(cacheKey, decoration);
    return decoration;
  }

  createRegion(chunkX: number, chunkZ: number): DecorationRegion {
    return new DecorationRegion({
      source: this.source,
      seed: this.seed,
      centerChunkX: chunkX,
      centerChunkZ: chunkZ,
      blockStates: this.blockStates,
      blockTags: this.blockTags,
      survival: this.survival,
      baseHeightmaps: this.baseHeightmaps,
    });
  }

  /** The applyBiomeDecoration loop over an existing region (exposed so tests can inspect the region afterwards). */
  decorateInRegion(region: DecorationRegion, trace?: OriginDecorationTrace[]): OriginDecoration {
    if (!isFeatureProfilingActive()) return this.runDecorationSteps(region, trace);
    const savedSectionDepth = featureProfileState.openSectionDepth;
    resetFeatureProfileState();
    openFeatureSection("feature.origin");
    try {
      const decoration = this.runDecorationSteps(region, trace);
      flushOriginCounters(region);
      return decoration;
    } finally {
      recoverOpenSections(savedSectionDepth);
    }
  }

  private runDecorationSteps(region: DecorationRegion, trace?: OriginDecorationTrace[]): OriginDecoration {
    const chunkX = region.centerChunkX;
    const chunkZ = region.centerChunkZ;
    const minBlockX = chunkX * 16;
    const minBlockZ = chunkZ * 16;
    const origin = new BlockPos(minBlockX, region.minY, minBlockZ);
    const random = createDecorationRandom();
    const decorationSeed = random.setDecorationSeed(this.seed, minBlockX, minBlockZ);

    startDecorationSection("feature.origin.biomeScan");
    const presentBiomes = new Set<string>();
    for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
      for (let offsetX = -1; offsetX <= 1; offsetX++) collectChunkBiomes(this.source, chunkX + offsetX, chunkZ + offsetZ, presentBiomes);
    }
    const biomes = [...presentBiomes].filter((biome) => this.possibleBiomes.has(biome));
    endDecorationSection();

    const stepData = this.featuresPerStep;
    const stepCount = Math.max(DECORATION_STEPS.length, stepData.length);
    for (let step = 0; step < stepCount; step++) {
      if (step >= stepData.length) continue;
      const data = stepData[step]!;
      startDecorationSection(stepSectionName(step, DECORATION_STEPS[step]));
      const indices = new Set<number>();
      for (const biome of biomes) {
        const steps = this.biomeFeatures.stepsOf(biome);
        if (step >= steps.length) continue;
        for (const featureKey of steps[step]!) {
          const index = data.indexOf.get(featureKey);
          if (index === undefined) throw new Error(`Feature ${featureKey} of ${biome} is missing from the step ${step} order`);
          indices.add(index);
        }
      }
      const sortedIndices = [...indices].sort((first, second) => first - second);
      for (const featureIndex of sortedIndices) {
        const featureKey = data.features[featureIndex]!;
        random.setFeatureSeed(decorationSeed, featureIndex, step);
        let placed = false;
        try {
          placed = this.placedFeatureByKey(featureKey).placeWithBiomeCheck(region, this.generator, random, origin);
        } catch (error) {
          if (this.strict) throw error;
          this.diagnostics.count(this.diagnostics.placementErrors, featureKey);
        }
        trace?.push({ step, featureIndex, featureKey, placed });
      }
      endDecorationSection();
    }
    startDecorationSection("feature.origin.extractPatches");
    const patches = region.extractPatches();
    endDecorationSection();
    return { chunkX, chunkZ, decorationSeed, biomes, patches };
  }

  /** Base column + the patches of the 9 origins around it, in raster order. */
  generateDecoratedColumn(chunkX: number, chunkZ: number): ChunkBlocks {
    startDecorationSection("feature.column.base");
    const base = this.source.generateBaseColumn(chunkX, chunkZ);
    const decorated = new ChunkBlocks(chunkX, chunkZ, base.minY, base.height, base.palette);
    decorated.blocks.set(base.blocks);
    endDecorationSection();
    let mergedBlocks = 0;
    for (let originZ = chunkZ - 1; originZ <= chunkZ + 1; originZ++) {
      for (let originX = chunkX - 1; originX <= chunkX + 1; originX++) {
        const decoration = this.decorateOrigin(originX, originZ);
        startDecorationSection("feature.column.merge");
        for (const patch of decoration.patches) {
          if (patch.chunkX !== chunkX || patch.chunkZ !== chunkZ) continue;
          for (let position = 0; position < patch.indices.length; position++) decorated.blocks[patch.indices[position]!] = patch.paletteIds[position]!;
          mergedBlocks += patch.indices.length;
        }
        endDecorationSection();
      }
    }
    addFeatureCounter("decoration.patchBlocksMerged", mergedBlocks);
    return decorated;
  }
}
