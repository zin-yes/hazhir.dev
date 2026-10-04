// The 1.20.6 placement modifier types (net.minecraft.world.level.levelgen.placement.*Placement / *Filter).

import { PerlinSimplexNoise } from "../../noise";
import { LegacyRandomSource } from "../../random";
import { BlockPos } from "../core/block-pos";
import { Direction } from "../core/direction";
import { parseHeightmapType } from "../core/heightmap";
import { requireNumber, requireString } from "../providers/json-fields";
import { parseHeightProvider, parseIntProvider } from "../providers/value-providers";
import { TRUE_PREDICATE } from "../providers/block-predicates";
import {
  definePlacementModifierType,
  filterModifier,
  type PlacementContext,
  type PlacementModifierType,
  repeatingModifier,
} from "./placement-modifier";

let biomeInfoNoise: PerlinSimplexNoise | undefined;

/** Biome.BIOME_INFO_NOISE = new PerlinSimplexNoise(new WorldgenRandom(new LegacyRandomSource(2345L)), [0]). */
export function getBiomeInfoNoise(): PerlinSimplexNoise {
  biomeInfoNoise ??= new PerlinSimplexNoise(new LegacyRandomSource(BigInt(2345)), [0]);
  return biomeInfoNoise;
}

export const countPlacement = definePlacementModifierType({
  id: "minecraft:count",
  parse(json) {
    const count = parseIntProvider(json.count, "count.count");
    return repeatingModifier(this.id, (random) => count.sample(random));
  },
});

export const noiseBasedCountPlacement = definePlacementModifierType({
  id: "minecraft:noise_based_count",
  parse(json) {
    const noiseToCountRatio = requireNumber(json, "noise_to_count_ratio", this.id);
    const noiseFactor = requireNumber(json, "noise_factor", this.id);
    const noiseOffset = typeof json.noise_offset === "number" ? json.noise_offset : 0;
    return repeatingModifier(this.id, (_random, origin) => {
      const noiseValue = getBiomeInfoNoise().getValue(origin.x / noiseFactor, origin.z / noiseFactor, false);
      return Math.ceil((noiseValue + noiseOffset) * noiseToCountRatio) | 0;
    });
  },
});

export const noiseThresholdCountPlacement = definePlacementModifierType({
  id: "minecraft:noise_threshold_count",
  parse(json) {
    const noiseLevel = requireNumber(json, "noise_level", this.id);
    const belowNoise = requireNumber(json, "below_noise", this.id);
    const aboveNoise = requireNumber(json, "above_noise", this.id);
    return repeatingModifier(this.id, (_random, origin) => {
      const noiseValue = getBiomeInfoNoise().getValue(origin.x / 200, origin.z / 200, false);
      return noiseValue < noiseLevel ? belowNoise : aboveNoise;
    });
  },
});

function isEmptyForLayerCount(context: PlacementContext, x: number, y: number, z: number): boolean {
  const info = context.level.getBlockInfo(x, y, z);
  return info.isAir || info.name === "minecraft:water" || info.name === "minecraft:lava";
}

/** CountOnEveryLayerPlacement.findOnGroundYPosition. */
function findOnGroundY(context: PlacementContext, x: number, startY: number, z: number, targetLayer: number): number {
  let layersSeen = 0;
  let aboveIsEmpty = isEmptyForLayerCount(context, x, startY, z);
  for (let y = startY; y >= context.minBuildHeight + 1; y--) {
    const belowY = y - 1;
    const belowIsEmpty = isEmptyForLayerCount(context, x, belowY, z);
    if (!belowIsEmpty && aboveIsEmpty && context.level.getBlockInfo(x, belowY, z).name !== "minecraft:bedrock") {
      if (layersSeen === targetLayer) return belowY + 1;
      layersSeen++;
    }
    aboveIsEmpty = belowIsEmpty;
  }
  return 2147483647;
}

export const countOnEveryLayerPlacement = definePlacementModifierType({
  id: "minecraft:count_on_every_layer",
  parse(json) {
    const count = parseIntProvider(json.count, "count_on_every_layer.count");
    return {
      type: this.id,
      getPositions(context, random, origin) {
        const positions: BlockPos[] = [];
        let layer = 0;
        let foundAny: boolean;
        do {
          foundAny = false;
          // The loop bound re-samples the count every iteration, as the Java for-loop condition does.
          for (let attempt = 0; attempt < count.sample(random); attempt++) {
            const x = (random.nextIntBounded(16) + origin.x) | 0;
            const z = (random.nextIntBounded(16) + origin.z) | 0;
            const surfaceY = context.getHeight("MOTION_BLOCKING", x, z);
            const y = findOnGroundY(context, x, surfaceY, z, layer);
            if (y === 2147483647) continue;
            positions.push(new BlockPos(x, y, z));
            foundAny = true;
          }
          layer++;
        } while (foundAny);
        return positions;
      },
    };
  },
});

export const inSquarePlacement = definePlacementModifierType({
  id: "minecraft:in_square",
  parse() {
    return {
      type: this.id,
      getPositions(_context, random, origin) {
        const x = (random.nextIntBounded(16) + origin.x) | 0;
        const z = (random.nextIntBounded(16) + origin.z) | 0;
        return [new BlockPos(x, origin.y, z)];
      },
    };
  },
});

export const heightmapPlacement = definePlacementModifierType({
  id: "minecraft:heightmap",
  parse(json) {
    const heightmap = parseHeightmapType(requireString(json, "heightmap", this.id));
    return {
      type: this.id,
      getPositions(context, _random, origin) {
        const y = context.getHeight(heightmap, origin.x, origin.z);
        return y > context.minBuildHeight ? [new BlockPos(origin.x, y, origin.z)] : [];
      },
    };
  },
});

export const heightRangePlacement = definePlacementModifierType({
  id: "minecraft:height_range",
  parse(json) {
    const height = parseHeightProvider(json.height, "height_range.height");
    return { type: this.id, getPositions: (context, random, origin) => [origin.atY(height.sample(random, context))] };
  },
});

export const randomOffsetPlacement = definePlacementModifierType({
  id: "minecraft:random_offset",
  parse(json) {
    const xzSpread = parseIntProvider(json.xz_spread, "random_offset.xz_spread");
    const ySpread = parseIntProvider(json.y_spread, "random_offset.y_spread");
    return {
      type: this.id,
      getPositions(_context, random, origin) {
        const x = (origin.x + xzSpread.sample(random)) | 0;
        const y = (origin.y + ySpread.sample(random)) | 0;
        const z = (origin.z + xzSpread.sample(random)) | 0;
        return [new BlockPos(x, y, z)];
      },
    };
  },
});

export const environmentScanPlacement = definePlacementModifierType({
  id: "minecraft:environment_scan",
  parse(json, parser) {
    const direction = Direction.fromName(requireString(json, "direction_of_search", this.id));
    if (direction.axis !== "y") throw new Error("environment_scan direction_of_search must be up or down");
    const targetCondition = parser.blockPredicate(json.target_condition, "environment_scan.target_condition");
    const allowedSearchCondition = json.allowed_search_condition === undefined ? TRUE_PREDICATE : parser.blockPredicate(json.allowed_search_condition, "environment_scan.allowed_search_condition");
    const maxSteps = requireNumber(json, "max_steps", this.id);
    return {
      type: this.id,
      getPositions(context, _random, origin) {
        const level = context.level;
        const { x, z } = origin;
        let y = origin.y;
        if (!allowedSearchCondition.test(level, x, y, z)) return [];
        for (let step = 0; step < maxSteps; step++) {
          if (targetCondition.test(level, x, y, z)) return [new BlockPos(x, y, z)];
          y += direction.stepY;
          if (level.isOutsideBuildHeight(y)) return [];
          if (!allowedSearchCondition.test(level, x, y, z)) break;
        }
        return targetCondition.test(level, x, y, z) ? [new BlockPos(x, y, z)] : [];
      },
    };
  },
});

export const carvingMaskPlacement = definePlacementModifierType({
  id: "minecraft:carving_mask",
  parse(json) {
    const step = requireString(json, "step", this.id);
    if (step !== "air" && step !== "liquid") throw new Error(`carving_mask step must be air or liquid, got ${step}`);
    return {
      type: this.id,
      getPositions(context, _random, origin) {
        const chunkX = origin.x >> 4;
        const chunkZ = origin.z >> 4;
        return context.getCarvingMask(chunkX, chunkZ, step).positions(chunkX, chunkZ).map((position) => new BlockPos(position.x, position.y, position.z));
      },
    };
  },
});

export const biomeFilter = definePlacementModifierType({
  id: "minecraft:biome",
  parse() {
    return filterModifier(this.id, (context, _random, origin) => {
      const topFeature = context.topFeature;
      if (!topFeature) throw new Error("Tried to biome check an unregistered feature, or a feature that should not restrict the biome");
      return context.generator.biomeHasFeature(context.level.getBiome(origin.x, origin.y, origin.z), topFeature);
    });
  },
});

export const blockPredicateFilter = definePlacementModifierType({
  id: "minecraft:block_predicate_filter",
  parse(json, parser) {
    const predicate = parser.blockPredicate(json.predicate, "block_predicate_filter.predicate");
    return filterModifier(this.id, (context, _random, origin) => predicate.test(context.level, origin.x, origin.y, origin.z));
  },
});

export const rarityFilter = definePlacementModifierType({
  id: "minecraft:rarity_filter",
  parse(json) {
    const chance = requireNumber(json, "chance", this.id);
    const threshold = Math.fround(1 / Math.fround(chance));
    return filterModifier(this.id, (_context, random) => random.nextFloat() < threshold);
  },
});

export const surfaceWaterDepthFilter = definePlacementModifierType({
  id: "minecraft:surface_water_depth_filter",
  parse(json) {
    const maxWaterDepth = requireNumber(json, "max_water_depth", this.id);
    return filterModifier(this.id, (context, _random, origin) => {
      const oceanFloor = context.getHeight("OCEAN_FLOOR", origin.x, origin.z);
      const worldSurface = context.getHeight("WORLD_SURFACE", origin.x, origin.z);
      return worldSurface - oceanFloor <= maxWaterDepth;
    });
  },
});

export const surfaceRelativeThresholdFilter = definePlacementModifierType({
  id: "minecraft:surface_relative_threshold_filter",
  parse(json) {
    const heightmap = parseHeightmapType(requireString(json, "heightmap", this.id));
    const minInclusive = typeof json.min_inclusive === "number" ? json.min_inclusive : -2147483648;
    const maxInclusive = typeof json.max_inclusive === "number" ? json.max_inclusive : 2147483647;
    return filterModifier(this.id, (context, _random, origin) => {
      const surface = context.getHeight(heightmap, origin.x, origin.z);
      return surface + minInclusive <= origin.y && origin.y <= surface + maxInclusive;
    });
  },
});

export const VANILLA_PLACEMENT_MODIFIER_TYPES: readonly PlacementModifierType[] = [
  countPlacement,
  noiseBasedCountPlacement,
  noiseThresholdCountPlacement,
  countOnEveryLayerPlacement,
  inSquarePlacement,
  heightmapPlacement,
  heightRangePlacement,
  randomOffsetPlacement,
  environmentScanPlacement,
  carvingMaskPlacement,
  biomeFilter,
  blockPredicateFilter,
  rarityFilter,
  surfaceWaterDepthFilter,
  surfaceRelativeThresholdFilter,
];
