// Port of net.minecraft.world.level.levelgen.SurfaceSystem (Minecraft 1.20.6): rewrites the terrain stage's
// stone/water column into the surface blocks chosen by the compiled `surface_rule`, plus the eroded badlands
// and frozen ocean (iceberg) extensions.

import {
  addWorkerCounter,
  endWorkerSection,
  isWorkerProfiling,
  startWorkerSection,
} from "@/applications/game/profiler/worker-recorder";
import type { ChunkBlocks } from "../chunk";
import { createColumnMemoizedDensity } from "../density/column-memoization";
import { transientRandomAt } from "../random/xoroshiro-random-source";
import { compileDensityFunction } from "../density/density-codegen";
import { DensityNode } from "../density/density-function";
import type { JsonObject } from "../registry/datapack-loader";
import { generateClayBands, CLAY_BAND_COUNT } from "./clay-bands";
import { BiomeTemperatureSampler } from "./biome-temperature";
import { NO_WATER_HEIGHT, SurfaceRuleContext, type SurfaceContextServices } from "./surface-rule-context";
import type { GeneratedSurfaceRule } from "./surface-rule-codegen";
import { compileSurfaceRules, NO_RULE_MATCH, SurfaceResultTable, type SurfaceRule } from "./surface-rule-compiler";
import type {
  BiomeAtBlock,
  BiomeClimateLookup,
  DensityPoint,
  SurfaceNoiseRegistry,
  SurfaceNoiseRouter,
  SurfaceNoiseSource,
  SurfacePositionalRandomFactory,
} from "./surface-types";
import { BLOCK_KIND_AIR, BLOCK_KIND_FLUID, BLOCK_KIND_SOLID, SurfaceChunkAccess } from "./surface-chunk-access";

/** One in this many evaluations is repeated through the per-type wrapped rules to time each rule and condition type. */
const RULE_TYPE_SAMPLE_EVERY = 4096;
const INITIAL_DENSITY_SURFACE_THRESHOLD = 0.390625;
const PRELIMINARY_SURFACE_CELL_HEIGHT = 4;
const PRELIMINARY_CACHE_LIMIT = 200_000;
const WAY_BELOW_MIN_Y = -2147483648 >> 4;
const WATER_BLOCK_NAME = "minecraft:water";
const SNOW_BLOCK_STATE = "minecraft:snow_block";
const PACKED_ICE_STATE = "minecraft:packed_ice";

export interface SurfaceSystemConfig {
  noises: SurfaceNoiseRegistry;
  /** Root factory of the seed, as created by createRootRandomFactory. */
  randomFactory: SurfacePositionalRandomFactory;
  surfaceRule: JsonObject;
  seaLevel: number;
  defaultBlock: string;
  minY?: number;
  height?: number;
  /** Needed only when the rules reach a `temperature` condition or the frozen ocean extension. */
  biomeClimate?: BiomeClimateLookup;
}

interface PreparedSurfaceBuild {
  access: SurfaceChunkAccess;
  defaultBlockId: number;
  resultIdOf: (resultIndex: number) => number;
  context: SurfaceRuleContext;
}

export interface SurfaceChunkInputs {
  chunk: ChunkBlocks;
  router: SurfaceNoiseRouter;
  biomeAt: BiomeAtBlock;
  /** Every biome stored in the 3x3 chunks around the chunk (lets rules skip biome checks that cannot match). */
  biomesNearChunk?: ReadonlySet<string>;
}

export class SurfaceSystem {
  readonly minY: number;
  readonly height: number;

  private readonly resultTable = new SurfaceResultTable();
  private readonly rule: SurfaceRule;
  private profiledRule: SurfaceRule | undefined;
  private readonly clayBandResultIndices: number[];
  private readonly clayBandsOffsetNoise: SurfaceNoiseSource;
  private readonly surfaceNoise: SurfaceNoiseSource;
  private readonly surfaceSecondaryNoise: SurfaceNoiseSource;
  private readonly badlandsPillarNoise: SurfaceNoiseSource;
  private readonly badlandsPillarRoofNoise: SurfaceNoiseSource;
  private readonly badlandsSurfaceNoise: SurfaceNoiseSource;
  private readonly icebergPillarNoise: SurfaceNoiseSource;
  private readonly icebergPillarRoofNoise: SurfaceNoiseSource;
  private readonly icebergSurfaceNoise: SurfaceNoiseSource;
  private readonly temperatureSampler: BiomeTemperatureSampler;
  private readonly preliminarySurfaceLevels = new Map<number, number>();
  private preliminaryRouter: SurfaceNoiseRouter | undefined;
  private preliminaryDensity: SurfaceNoiseRouter["initialDensityWithoutJaggedness"] | undefined;
  private readonly preliminaryProbe: DensityPoint = { blockX: 0, blockY: 0, blockZ: 0 };

  constructor(private readonly config: SurfaceSystemConfig) {
    this.minY = config.minY ?? -64;
    this.height = config.height ?? 384;
    const { noises, randomFactory } = config;
    this.clayBandsOffsetNoise = noises.get("minecraft:clay_bands_offset");
    this.surfaceNoise = noises.get("minecraft:surface");
    this.surfaceSecondaryNoise = noises.get("minecraft:surface_secondary");
    this.badlandsPillarNoise = noises.get("minecraft:badlands_pillar");
    this.badlandsPillarRoofNoise = noises.get("minecraft:badlands_pillar_roof");
    this.badlandsSurfaceNoise = noises.get("minecraft:badlands_surface");
    this.icebergPillarNoise = noises.get("minecraft:iceberg_pillar");
    this.icebergPillarRoofNoise = noises.get("minecraft:iceberg_pillar_roof");
    this.icebergSurfaceNoise = noises.get("minecraft:iceberg_surface");
    this.temperatureSampler = new BiomeTemperatureSampler(config.biomeClimate);
    this.clayBandResultIndices = generateClayBands(randomFactory.fromHashOf("minecraft:clay_bands")).map((state) =>
      this.resultTable.indexOf(state),
    );
    const isProfiling = isWorkerProfiling();
    if (isProfiling) startWorkerSection("surface.compileRules");
    try {
      this.rule = this.compileRules(false);
    } finally {
      if (isProfiling) endWorkerSection();
    }
  }

  private compileRules(profileRuleTypes: boolean): SurfaceRule {
    return compileSurfaceRules(this.config.surfaceRule, {
      noises: this.config.noises,
      randomFactory: this.config.randomFactory,
      resultTable: this.resultTable,
      getBandResultIndex: (blockX, blockY, blockZ) => this.getBandResultIndex(blockX, blockY, blockZ),
      profileRuleTypes,
    });
  }

  /** The rules wrapped per type for the profiler, compiled on first use because the plain rules never need them. */
  private profiledRules(): SurfaceRule {
    if (this.profiledRule === undefined) {
      startWorkerSection("surface.compileProfiledRules");
      try {
        this.profiledRule = this.compileRules(true);
      } finally {
        endWorkerSection();
      }
    }
    return this.profiledRule;
  }

  getBandResultIndex(blockX: number, blockY: number, blockZ: number): number {
    const offset = Math.floor(this.clayBandsOffsetNoise.getValue(blockX, 0, blockZ) * 4 + 0.5);
    return this.clayBandResultIndices[(blockY + offset + CLAY_BAND_COUNT) % CLAY_BAND_COUNT]!;
  }

  getBandState(blockX: number, blockY: number, blockZ: number): string {
    return this.resultTable.states[this.getBandResultIndex(blockX, blockY, blockZ)]!;
  }

  getSurfaceDepth(blockX: number, blockZ: number): number {
    const noiseValue = this.surfaceNoise.getValue(blockX, 0, blockZ);
    const jitter = transientRandomAt(this.config.randomFactory, blockX, 0, blockZ).nextDouble();
    return Math.trunc(noiseValue * 2.75 + 3 + jitter * 0.25);
  }

  getSurfaceSecondary(blockX: number, blockZ: number): number {
    return this.surfaceSecondaryNoise.getValue(blockX, 0, blockZ);
  }

  /** NoiseChunk.preliminarySurfaceLevel: first y (scanning cells from the top) where initial density exceeds 0.390625. */
  getPreliminarySurfaceLevel(router: SurfaceNoiseRouter, blockX: number, blockZ: number): number {
    if (this.preliminaryRouter !== router) {
      this.preliminaryRouter = router;
      this.preliminarySurfaceLevels.clear();
      const density = router.initialDensityWithoutJaggedness;
      if (density instanceof DensityNode) {
        const evaluate = compileDensityFunction(createColumnMemoizedDensity(density));
        this.preliminaryDensity = { compute: (point) => evaluate(point.blockX, point.blockY, point.blockZ) };
      } else {
        this.preliminaryDensity = density;
      }
    }
    const quartAlignedX = (blockX >> 2) << 2;
    const quartAlignedZ = (blockZ >> 2) << 2;
    const cacheKey = (quartAlignedX + 2 ** 24) * 2 ** 25 + (quartAlignedZ + 2 ** 24);
    const cached = this.preliminarySurfaceLevels.get(cacheKey);
    const isProfiling = isWorkerProfiling();
    if (cached !== undefined) {
      if (isProfiling) addWorkerCounter("surfacePreliminaryLevelCacheHits", 1);
      return cached;
    }
    if (isProfiling) {
      addWorkerCounter("surfacePreliminaryLevelCacheMisses", 1);
      startWorkerSection("surface.preliminaryLevel");
    }
    let level = 2147483647;
    const density = this.preliminaryDensity!;
    const probe = this.preliminaryProbe;
    probe.blockX = quartAlignedX;
    probe.blockZ = quartAlignedZ;
    for (let blockY = this.minY + this.height; blockY >= this.minY; blockY -= PRELIMINARY_SURFACE_CELL_HEIGHT) {
      probe.blockY = blockY;
      if (density.compute(probe) > INITIAL_DENSITY_SURFACE_THRESHOLD) {
        level = blockY;
        break;
      }
    }
    if (isProfiling) endWorkerSection();
    if (this.preliminarySurfaceLevels.size > PRELIMINARY_CACHE_LIMIT) this.preliminarySurfaceLevels.clear();
    this.preliminarySurfaceLevels.set(cacheKey, level);
    return level;
  }

  buildSurface(inputs: SurfaceChunkInputs): void {
    const isProfiling = isWorkerProfiling();
    if (isProfiling) startWorkerSection("surface.setup");
    let prepared: PreparedSurfaceBuild;
    try {
      prepared = this.prepareSurfaceBuild(inputs);
    } finally {
      if (isProfiling) endWorkerSection();
    }
    if (isProfiling) startWorkerSection("surface.scanColumns");
    try {
      this.scanColumns(inputs, prepared, isProfiling);
    } finally {
      if (isProfiling) endWorkerSection();
    }
  }

  private prepareSurfaceBuild(inputs: SurfaceChunkInputs): PreparedSurfaceBuild {
    const { chunk, router, biomeAt } = inputs;
    const access = new SurfaceChunkAccess(chunk);
    const defaultBlockId = access.idOf(this.config.defaultBlock);
    const resultIdByIndex: number[] = [];
    const resultIdOf = (resultIndex: number): number => {
      let blockId = resultIdByIndex[resultIndex];
      if (blockId === undefined) {
        blockId = access.idOf(this.resultTable.states[resultIndex]!);
        resultIdByIndex[resultIndex] = blockId;
      }
      return blockId;
    };

    const services: SurfaceContextServices = {
      minY: this.minY,
      height: this.height,
      getSurfaceDepth: (blockX, blockZ) => this.getSurfaceDepth(blockX, blockZ),
      getSurfaceSecondary: (blockX, blockZ) => this.getSurfaceSecondary(blockX, blockZ),
      getPreliminarySurfaceLevel: (blockX, blockZ) => this.getPreliminarySurfaceLevel(router, blockX, blockZ),
      isColdEnoughToSnow: (biomeId, blockX, blockY, blockZ) =>
        this.temperatureSampler.isColdEnoughToSnow(biomeId, blockX, blockY, blockZ),
    };
    const context = new SurfaceRuleContext(services, access.heightmap, biomeAt);
    const biomeConditionSets = (this.rule as Partial<GeneratedSurfaceRule>).biomeConditionSets;
    if (biomeConditionSets !== undefined) {
      context.biomeConditionPossible = new Uint8Array(biomeConditionSets.length).fill(1);
      const biomesNearChunk = inputs.biomesNearChunk;
      if (biomesNearChunk !== undefined) {
        biomeConditionSets.forEach((biomeIds, conditionIndex) => {
          let isPossible = false;
          for (const biomeId of biomeIds) {
            if (biomesNearChunk.has(biomeId)) {
              isPossible = true;
              break;
            }
          }
          context.biomeConditionPossible[conditionIndex] = isPossible ? 1 : 0;
        });
      }
    }
    return { access, defaultBlockId, resultIdOf, context };
  }

  private scanColumns(inputs: SurfaceChunkInputs, prepared: PreparedSurfaceBuild, isProfiling: boolean): void {
    const { chunk, biomeAt } = inputs;
    const { access, defaultBlockId, resultIdOf, context } = prepared;
    const rule = this.rule;
    const typeProfiledRule = isProfiling ? this.profiledRules() : undefined;
    const chunkMinBlockX = chunk.chunkX * 16;
    const chunkMinBlockZ = chunk.chunkZ * 16;
    const minY = chunk.minY;
    const maxY = chunk.maxY;
    const blocks = chunk.blocks;
    let ruleEvaluations = 0;
    let solidBlocksScanned = 0;

    for (let localX = 0; localX < 16; localX++) {
      for (let localZ = 0; localZ < 16; localZ++) {
        const blockX = chunkMinBlockX + localX;
        const blockZ = chunkMinBlockZ + localZ;
        const originalSurfaceHeight = access.heightmap.getHeight(localX, localZ) + 1;
        const columnBiome = biomeAt(blockX, originalSurfaceHeight, blockZ);
        if (columnBiome === "minecraft:eroded_badlands") {
          if (isProfiling) startWorkerSection("surface.erodedBadlandsExtension");
          this.applyErodedBadlandsExtension(access, localX, localZ, blockX, blockZ, originalSurfaceHeight, defaultBlockId);
          if (isProfiling) endWorkerSection();
        }
        const startY = access.heightmap.getHeight(localX, localZ) + 1;
        context.updateXZ(blockX, blockZ);
        let stoneDepthAbove = 0;
        let waterHeight = NO_WATER_HEIGHT;
        let stoneRegionBottom = 2147483647;
        const columnIndex = localZ * 16 + localX;
        for (let y = startY; y >= minY; y--) {
          const blockId = y > maxY ? 0 : blocks[(y - minY) * 256 + columnIndex]!;
          const kind = access.kindOf(blockId);
          if (kind === BLOCK_KIND_AIR) {
            stoneDepthAbove = 0;
            waterHeight = NO_WATER_HEIGHT;
            continue;
          }
          if (kind === BLOCK_KIND_FLUID) {
            if (waterHeight === NO_WATER_HEIGHT) waterHeight = y + 1;
            continue;
          }
          if (stoneRegionBottom >= y) {
            stoneRegionBottom = WAY_BELOW_MIN_Y;
            for (let belowY = y - 1; belowY >= minY - 1; belowY--) {
              const belowBlockId = belowY < minY ? 0 : blocks[(belowY - minY) * 256 + columnIndex]!;
              if (access.kindOf(belowBlockId) !== BLOCK_KIND_SOLID) {
                stoneRegionBottom = belowY + 1;
                break;
              }
            }
          }
          stoneDepthAbove++;
          solidBlocksScanned++;
          context.updateY(stoneDepthAbove, y - stoneRegionBottom + 1, waterHeight, blockX, y, blockZ);
          if (blockId !== defaultBlockId) continue;
          ruleEvaluations++;
          const resultIndex = rule(context);
          if (isProfiling) {
            if (ruleEvaluations % RULE_TYPE_SAMPLE_EVERY === 0) {
              startWorkerSection("surface.sampleRuleTypes");
              typeProfiledRule!(context);
              endWorkerSection();
            }
          }
          if (resultIndex === NO_RULE_MATCH) continue;
          access.setBlockId(localX, y, localZ, resultIdOf(resultIndex));
        }
        if (columnBiome === "minecraft:frozen_ocean" || columnBiome === "minecraft:deep_frozen_ocean") {
          if (isProfiling) startWorkerSection("surface.frozenOceanExtension");
          this.applyFrozenOceanExtension(access, context.getMinSurfaceLevel(), columnBiome, localX, localZ, blockX, blockZ, originalSurfaceHeight);
          if (isProfiling) endWorkerSection();
        }
      }
    }
    if (isProfiling) {
      addWorkerCounter("surfaceColumnsBuilt", 1);
      addWorkerCounter("surfaceSolidBlocksScanned", solidBlocksScanned);
      addWorkerCounter("surfaceRuleEvaluations", ruleEvaluations);
    }
  }

  /** SurfaceSystem.erodedBadlandsExtension: raises stone pillars above the surface of eroded badlands. */
  private applyErodedBadlandsExtension(
    access: SurfaceChunkAccess,
    localX: number,
    localZ: number,
    blockX: number,
    blockZ: number,
    surfaceHeight: number,
    defaultBlockId: number,
  ): void {
    const pillarHeight = Math.min(
      Math.abs(this.badlandsSurfaceNoise.getValue(blockX, 0, blockZ) * 8.25),
      this.badlandsPillarNoise.getValue(blockX * 0.2, 0, blockZ * 0.2) * 15,
    );
    if (pillarHeight <= 0) return;
    const roofNoise = Math.abs(this.badlandsPillarRoofNoise.getValue(blockX * 0.75, 0, blockZ * 0.75) * 1.5);
    const topY = Math.floor(64 + Math.min(pillarHeight * pillarHeight * 2.5, Math.ceil(roofNoise * 50) + 24));
    if (surfaceHeight > topY) return;
    for (let y = topY; y >= this.minY; y--) {
      const blockId = access.getBlockId(localX, y, localZ);
      if (blockId === defaultBlockId) break;
      if (access.nameOf(blockId) !== WATER_BLOCK_NAME) continue;
      return;
    }
    for (let y = topY; y >= this.minY && access.kindOf(access.getBlockId(localX, y, localZ)) === BLOCK_KIND_AIR; y--) {
      access.setBlockId(localX, y, localZ, defaultBlockId);
    }
  }

  /** SurfaceSystem.frozenOceanExtension: grows icebergs (packed ice with a snow cap) in frozen oceans. */
  private applyFrozenOceanExtension(
    access: SurfaceChunkAccess,
    minSurfaceLevel: number,
    biomeId: string,
    localX: number,
    localZ: number,
    blockX: number,
    blockZ: number,
    surfaceHeight: number,
  ): void {
    const pillarHeight = Math.min(
      Math.abs(this.icebergSurfaceNoise.getValue(blockX, 0, blockZ) * 8.25),
      this.icebergPillarNoise.getValue(blockX * 1.28, 0, blockZ * 1.28) * 15,
    );
    if (pillarHeight <= 1.8) return;
    const roofNoise = Math.abs(this.icebergPillarRoofNoise.getValue(blockX * 1.17, 0, blockZ * 1.17) * 1.5);
    let icebergTop = Math.min(pillarHeight * pillarHeight * 1.2, Math.ceil(roofNoise * 40) + 14);
    if (this.temperatureSampler.shouldMeltFrozenOceanIcebergSlightly(biomeId, blockX, this.config.seaLevel, blockZ)) {
      icebergTop -= 2;
    }
    let icebergBottom: number;
    if (icebergTop > 2) {
      icebergBottom = this.config.seaLevel - icebergTop - 7;
      icebergTop += this.config.seaLevel;
    } else {
      icebergTop = 0;
      icebergBottom = 0;
    }
    const topCeiling = icebergTop;
    const random = this.config.randomFactory.at(blockX, 0, blockZ);
    const maxSnowLayers = 2 + random.nextIntBounded(4);
    const snowMinimumY = this.config.seaLevel + 18 + random.nextIntBounded(10);
    let placedSnowLayers = 0;
    const snowBlockId = access.idOf(SNOW_BLOCK_STATE);
    const packedIceId = access.idOf(PACKED_ICE_STATE);
    for (let y = Math.max(surfaceHeight, Math.trunc(icebergTop) + 1); y >= minSurfaceLevel; y--) {
      const blockId = access.getBlockId(localX, y, localZ);
      const replacesAir =
        access.kindOf(blockId) === BLOCK_KIND_AIR && y < Math.trunc(topCeiling) && random.nextDouble() > 0.01;
      const replacesWater =
        !replacesAir &&
        access.nameOf(blockId) === WATER_BLOCK_NAME &&
        y > Math.trunc(icebergBottom) &&
        y < this.config.seaLevel &&
        icebergBottom !== 0 &&
        random.nextDouble() > 0.15;
      if (!replacesAir && !replacesWater) continue;
      if (placedSnowLayers <= maxSnowLayers && y > snowMinimumY) {
        access.setBlockId(localX, y, localZ, snowBlockId);
        placedSnowLayers++;
      } else {
        access.setBlockId(localX, y, localZ, packedIceId);
      }
    }
  }
}

/** Mirrors the surface-only convenience of one SurfaceSystem per (seed, rule): chunk generation calls this. */
const systemsByRandomFactory = new WeakMap<object, { surfaceRule: JsonObject; system: SurfaceSystem }>();

export function createSurfaceSystem(config: SurfaceSystemConfig): SurfaceSystem {
  return new SurfaceSystem(config);
}

export interface BuildSurfaceParams extends SurfaceChunkInputs {
  noises: SurfaceNoiseRegistry;
  randomFactory: SurfacePositionalRandomFactory;
  surfaceRule: JsonObject;
  seaLevel: number;
  defaultBlock: string;
  biomeClimate?: BiomeClimateLookup;
}

export function buildSurface(params: BuildSurfaceParams): void {
  let cached = systemsByRandomFactory.get(params.randomFactory);
  if (!cached || cached.surfaceRule !== params.surfaceRule) {
    cached = { surfaceRule: params.surfaceRule, system: createSurfaceSystem(params) };
    systemsByRandomFactory.set(params.randomFactory, cached);
  }
  cached.system.buildSurface(params);
}
