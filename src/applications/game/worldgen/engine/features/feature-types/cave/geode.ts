// Mirrors GeodeFeature (minecraft:geode) with GeodeConfiguration, GeodeBlockSettings, GeodeLayerSettings and
// GeodeCrackSettings. As in the 1.20.6 class, invalid blocks come from the geode_invalid_blocks tag (the
// `invalid_blocks` field is parsed but, like in Java, not consulted). Fluid scheduled ticks have no block effect and
// are omitted.

import { normalizeTagId } from "../../../block-state";
import { type NormalNoise } from "../../../noise";
import { createLegacySeededNoise, type BlockStateProvider } from "../../providers/block-state-providers";
import { defineFeatureType } from "../../feature/feature-type";
import type { WorldGenLevel } from "../../level/world-gen-level";
import { asArray, asObject, type JsonObject, type JsonValue, optionalBoolean, optionalNumber, requireString } from "../../providers/json-fields";
import { type IntProvider, parseIntProvider } from "../../providers/value-providers";
import { Direction } from "../../core/direction";
import { addFeatureCounter, endFeatureStep, noteFeatureRejection, startFeatureStep } from "../../profiling/feature-profiling";
import { betweenClosed } from "./block-iteration";
import { optionalInt, parseBlockStateIgnoringUnknownProperties, requireInt } from "./config-fields";
import { mthInvSqrt } from "./java-math";

interface GeodeBlockSettings {
  readonly fillingProvider: BlockStateProvider;
  readonly innerLayerProvider: BlockStateProvider;
  readonly alternateInnerLayerProvider: BlockStateProvider;
  readonly middleLayerProvider: BlockStateProvider;
  readonly outerLayerProvider: BlockStateProvider;
  readonly innerPlacements: readonly string[];
  readonly cannotReplaceTag: string;
}

export interface GeodeConfig {
  readonly blocks: GeodeBlockSettings;
  readonly fillingLayer: number;
  readonly innerLayer: number;
  readonly middleLayer: number;
  readonly outerLayer: number;
  readonly generateCrackChance: number;
  readonly baseCrackSize: number;
  readonly crackPointOffset: number;
  readonly usePotentialPlacementsChance: number;
  readonly useAlternateLayer0Chance: number;
  readonly placementsRequireLayer0Alternate: boolean;
  readonly outerWallDistance: IntProvider;
  readonly distributionPoints: IntProvider;
  readonly pointOffset: IntProvider;
  readonly minGenOffset: number;
  readonly maxGenOffset: number;
  readonly noiseMultiplier: number;
  readonly invalidBlocksThreshold: number;
}

function uniformInt(minInclusive: number, maxInclusive: number): JsonValue {
  return { type: "minecraft:uniform", min_inclusive: minInclusive, max_inclusive: maxInclusive };
}

const GEODE_INVALID_BLOCKS_TAG = "minecraft:geode_invalid_blocks";
const GEODE_NOISE_PARAMETERS = { firstOctave: -4, amplitudes: [1] };
const noiseBySeed = new Map<bigint, NormalNoise>();

/** NormalNoise.create(new WorldgenRandom(new LegacyRandomSource(seed)), -4, 1.0), memoized per world seed. */
function geodeNoise(seed: bigint): NormalNoise {
  let noise = noiseBySeed.get(seed);
  if (!noise) {
    noise = createLegacySeededNoise(seed, GEODE_NOISE_PARAMETERS);
    noiseBySeed.set(seed, noise);
  }
  return noise;
}

/** BuddingAmethystBlock.canClusterGrowAtState. */
function canClusterGrowAtState(level: WorldGenLevel, x: number, y: number, z: number): boolean {
  const info = level.getBlockInfo(x, y, z);
  return info.isAir || (info.name === "minecraft:water" && info.fluidAmount === 8);
}

function parseChance(config: JsonObject, field: string, fallback: number, what: string): number {
  const value = optionalNumber(config, field, fallback);
  if (value < 0 || value > 1) throw new Error(`${what}: ${field} must be within 0..1`);
  return value;
}

export const geodeFeature = defineFeatureType<GeodeConfig>({
  id: "minecraft:geode",
  parseConfig(json, parser) {
    const config = asObject(json, "geode config");
    const blocks = asObject(config.blocks, "geode.blocks");
    const layers = asObject(config.layers ?? {}, "geode.layers");
    const crack = asObject(config.crack ?? {}, "geode.crack");
    const innerPlacements = asArray(blocks.inner_placements, "geode.blocks.inner_placements").map((state) => parseBlockStateIgnoringUnknownProperties(state, parser, "geode.blocks.inner_placements"));
    if (innerPlacements.length === 0) throw new Error("geode.blocks.inner_placements must not be empty");
    const cannotReplace = requireString(blocks, "cannot_replace", "geode.blocks");
    return {
      blocks: {
        fillingProvider: parser.blockStateProvider(blocks.filling_provider, "geode.blocks.filling_provider"),
        innerLayerProvider: parser.blockStateProvider(blocks.inner_layer_provider, "geode.blocks.inner_layer_provider"),
        alternateInnerLayerProvider: parser.blockStateProvider(blocks.alternate_inner_layer_provider, "geode.blocks.alternate_inner_layer_provider"),
        middleLayerProvider: parser.blockStateProvider(blocks.middle_layer_provider, "geode.blocks.middle_layer_provider"),
        outerLayerProvider: parser.blockStateProvider(blocks.outer_layer_provider, "geode.blocks.outer_layer_provider"),
        innerPlacements,
        cannotReplaceTag: normalizeTagId(cannotReplace),
      },
      fillingLayer: optionalNumber(layers, "filling", 1.7),
      innerLayer: optionalNumber(layers, "inner_layer", 2.2),
      middleLayer: optionalNumber(layers, "middle_layer", 3.2),
      outerLayer: optionalNumber(layers, "outer_layer", 4.2),
      generateCrackChance: parseChance(crack, "generate_crack_chance", 1, "geode.crack"),
      baseCrackSize: optionalNumber(crack, "base_crack_size", 2),
      crackPointOffset: optionalInt(crack, "crack_point_offset", 2),
      usePotentialPlacementsChance: parseChance(config, "use_potential_placements_chance", 0.35, "geode"),
      useAlternateLayer0Chance: parseChance(config, "use_alternate_layer0_chance", 0, "geode"),
      placementsRequireLayer0Alternate: optionalBoolean(config, "placements_require_layer0_alternate", true),
      outerWallDistance: parseIntProvider(config.outer_wall_distance ?? uniformInt(4, 5), "geode.outer_wall_distance"),
      distributionPoints: parseIntProvider(config.distribution_points ?? uniformInt(3, 4), "geode.distribution_points"),
      pointOffset: parseIntProvider(config.point_offset ?? uniformInt(1, 2), "geode.point_offset"),
      minGenOffset: optionalInt(config, "min_gen_offset", -16),
      maxGenOffset: optionalInt(config, "max_gen_offset", 16),
      noiseMultiplier: parseChance(config, "noise_multiplier", 0.05, "geode"),
      invalidBlocksThreshold: requireInt(config, "invalid_blocks_threshold", "geode"),
    };
  },
  place({ level, random, origin, config }) {
    const { blocks } = config;
    const minOffset = config.minGenOffset;
    const maxOffset = config.maxGenOffset;
    const points: Array<{ x: number; y: number; z: number; offset: number }> = [];
    const crackPoints: Array<{ x: number; y: number; z: number }> = [];
    const pointCount = config.distributionPoints.sample(random);
    const noise = geodeNoise(level.seed);
    const pointRatio = pointCount / config.outerWallDistance.maxValue;
    const fillingThreshold = 1 / Math.sqrt(config.fillingLayer);
    const innerThreshold = 1 / Math.sqrt(config.innerLayer + pointRatio);
    const middleThreshold = 1 / Math.sqrt(config.middleLayer + pointRatio);
    const outerThreshold = 1 / Math.sqrt(config.outerLayer + pointRatio);
    const crackThreshold = 1 / Math.sqrt(config.baseCrackSize + random.nextDouble() / 2 + (pointCount > 3 ? pointRatio : 0));
    const hasCrack = random.nextFloat() < config.generateCrackChance;
    let invalidBlockCount = 0;
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
      const offsetX = config.outerWallDistance.sample(random);
      const offsetY = config.outerWallDistance.sample(random);
      const offsetZ = config.outerWallDistance.sample(random);
      const x = origin.x + offsetX;
      const y = origin.y + offsetY;
      const z = origin.z + offsetZ;
      const info = level.getBlockInfo(x, y, z);
      if ((info.isAir || level.blockTags.is(info.name, GEODE_INVALID_BLOCKS_TAG)) && ++invalidBlockCount > config.invalidBlocksThreshold) {
        noteFeatureRejection("tooManyInvalidBlocks");
        return false;
      }
      points.push({ x, y, z, offset: config.pointOffset.sample(random) });
    }
    if (hasCrack) {
      const side = random.nextIntBounded(4);
      const crackDistance = pointCount * 2 + 1;
      const crackOffsets: Array<[number, number]> =
        side === 0 ? [[crackDistance, 0]] : side === 1 ? [[0, crackDistance]] : side === 2 ? [[crackDistance, crackDistance]] : [[0, 0]];
      const [crackOffsetX, crackOffsetZ] = crackOffsets[0]!;
      for (const crackY of [7, 5, 1]) crackPoints.push({ x: origin.x + crackOffsetX, y: origin.y + crackY, z: origin.z + crackOffsetZ });
    }
    const potentialPlacements: Array<{ x: number; y: number; z: number }> = [];
    const cannotReplaceTag = blocks.cannotReplaceTag;
    const safeSetBlock = (x: number, y: number, z: number, state: string): void => {
      if (!level.blockTags.is(level.getBlockInfo(x, y, z).name, cannotReplaceTag)) level.setBlock(x, y, z, state, 2);
    };
    const layersMark = startFeatureStep("feature.geode.layers", level);
    let scannedCellCount = 0;
    for (const position of betweenClosed(origin.x + minOffset, origin.y + minOffset, origin.z + minOffset, origin.x + maxOffset, origin.y + maxOffset, origin.z + maxOffset)) {
      const { x, y, z } = position;
      scannedCellCount++;
      const noiseValue = noise.getValue(x, y, z) * config.noiseMultiplier;
      let pointSum = 0;
      let crackSum = 0;
      for (const point of points) {
        const distanceSquared = (x - point.x) * (x - point.x) + (y - point.y) * (y - point.y) + (z - point.z) * (z - point.z);
        pointSum += mthInvSqrt(distanceSquared + point.offset) + noiseValue;
      }
      for (const crackPoint of crackPoints) {
        const distanceSquared = (x - crackPoint.x) * (x - crackPoint.x) + (y - crackPoint.y) * (y - crackPoint.y) + (z - crackPoint.z) * (z - crackPoint.z);
        crackSum += mthInvSqrt(distanceSquared + config.crackPointOffset) + noiseValue;
      }
      if (pointSum < outerThreshold) continue;
      if (hasCrack && crackSum >= crackThreshold && pointSum < fillingThreshold) {
        safeSetBlock(x, y, z, "minecraft:air");
        continue;
      }
      if (pointSum >= fillingThreshold) {
        safeSetBlock(x, y, z, blocks.fillingProvider.getState(random, x, y, z));
        continue;
      }
      if (pointSum >= innerThreshold) {
        const useAlternateLayer = random.nextFloat() < config.useAlternateLayer0Chance;
        if (useAlternateLayer) safeSetBlock(x, y, z, blocks.alternateInnerLayerProvider.getState(random, x, y, z));
        else safeSetBlock(x, y, z, blocks.innerLayerProvider.getState(random, x, y, z));
        if ((config.placementsRequireLayer0Alternate && !useAlternateLayer) || !(random.nextFloat() < config.usePotentialPlacementsChance)) continue;
        potentialPlacements.push({ x, y, z });
        continue;
      }
      if (pointSum >= middleThreshold) {
        safeSetBlock(x, y, z, blocks.middleLayerProvider.getState(random, x, y, z));
        continue;
      }
      safeSetBlock(x, y, z, blocks.outerLayerProvider.getState(random, x, y, z));
    }
    endFeatureStep("feature.geode.layers", level, layersMark);
    addFeatureCounter("feature.geode.scannedCells", scannedCellCount);
    addFeatureCounter("feature.geode.potentialPlacements", potentialPlacements.length);
    const buddingMark = startFeatureStep("feature.geode.budding", level);
    const catalog = level.blockStates;
    for (const placement of potentialPlacements) {
      let state = blocks.innerPlacements[random.nextIntBounded(blocks.innerPlacements.length)]!;
      for (const direction of Direction.VALUES) {
        if (catalog.hasProperty(state, "facing")) state = catalog.withProperty(state, "facing", direction.name);
        const neighborX = placement.x + direction.stepX;
        const neighborY = placement.y + direction.stepY;
        const neighborZ = placement.z + direction.stepZ;
        const neighborInfo = level.getBlockInfo(neighborX, neighborY, neighborZ);
        if (catalog.hasProperty(state, "waterlogged")) {
          const isSource = neighborInfo.fluid === "water" || neighborInfo.fluid === "lava";
          state = catalog.withProperty(state, "waterlogged", String(isSource));
        }
        if (!canClusterGrowAtState(level, neighborX, neighborY, neighborZ)) continue;
        safeSetBlock(neighborX, neighborY, neighborZ, state);
        break;
      }
    }
    endFeatureStep("feature.geode.budding", level, buddingMark);
    return true;
  },
});
