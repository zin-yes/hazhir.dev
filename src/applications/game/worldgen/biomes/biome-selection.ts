// Picks a biome for a column from its climate, altitude, slope and landforms.
// Water bodies and special landforms are decided first, then mountains,
// then the climate grid of temperature against humidity.

import { SEA_LEVEL, TEMPERATURE_DROP_PER_BLOCK, TEMPERATURE_DROP_START_HEIGHT } from "../constants";
import { smoothstep } from "../math";
import type { TerrainSample } from "../terrain-types";
import { BiomeId } from "./biome-types";

const COASTAL_HEIGHT_ABOVE_SEA = 3.5;
const STEEP_SHORE_SLOPE = 1.3;
const FREEZING_TEMPERATURE = -0.55;

export interface BiomeContext {
  /** Temperature after altitude cooling. */
  temperature: number;
  humidity: number;
  heightAboveSea: number;
}

export function describeBiomeContext(sample: TerrainSample): BiomeContext {
  const heightAboveSea = sample.height - SEA_LEVEL;
  const { climate } = sample;
  const coastalMoisture = (1 - smoothstep(-0.1, 0.2, climate.continentalness)) * 0.15;
  return {
    temperature:
      climate.temperature -
      Math.max(0, heightAboveSea - TEMPERATURE_DROP_START_HEIGHT) * TEMPERATURE_DROP_PER_BLOCK,
    humidity: Math.min(1, climate.humidity + coastalMoisture),
    heightAboveSea,
  };
}

export function selectBiome(sample: TerrainSample, slope: number): BiomeId {
  const context = describeBiomeContext(sample);
  const { climate } = sample;

  if (sample.waterLevel > sample.height) return selectWaterBiome(sample, context);

  if (sample.volcanoWeight > 0.12) {
    return sample.craterWeight > 0.05 ? BiomeId.VolcanicCrater : BiomeId.VolcanicSlopes;
  }

  const isCoastal =
    context.heightAboveSea < COASTAL_HEIGHT_ABOVE_SEA &&
    (climate.continentalness < 0 || sample.islandKind !== "none");
  if (isCoastal) {
    if (slope > STEEP_SHORE_SLOPE) return BiomeId.RockyShore;
    if (context.temperature > 0.3 && context.humidity > 0.1 && climate.erosion > -0.2) {
      return BiomeId.MangroveSwamp;
    }
    return context.temperature < -0.5 ? BiomeId.ColdBeach : BiomeId.Beach;
  }

  if (isWetland(sample, context)) {
    return context.temperature > -0.1 ? BiomeId.Swamp : BiomeId.Bog;
  }

  if (sample.canyonWeight > 0.15) return BiomeId.Canyon;
  if (sample.mesaWeight > 0.2) return BiomeId.Badlands;

  if (context.heightAboveSea > 38 && sample.mountainMask > 0.2) {
    return selectMountainBiome(sample, context, slope);
  }
  if (
    context.heightAboveSea > 28 &&
    climate.weirdness > 0.2 &&
    context.temperature > -0.35 &&
    context.temperature < 0.25 &&
    context.humidity > -0.2
  ) {
    return BiomeId.HighlandMoor;
  }

  return selectClimateBiome(sample, context);
}

function isWetland(sample: TerrainSample, context: BiomeContext): boolean {
  const isLowAndFlat = context.heightAboveSea < 5 && sample.climate.erosion > 0.2;
  const isFloodplain = sample.riverValleyWeight > 0.2 && context.heightAboveSea < 6;
  return (
    (isLowAndFlat || isFloodplain) &&
    context.humidity > 0.25 &&
    context.temperature > -0.5 &&
    context.temperature < 0.6 &&
    (context.temperature > -0.1 || context.humidity > 0.3)
  );
}

function selectWaterBiome(sample: TerrainSample, context: BiomeContext): BiomeId {
  const { climate } = sample;
  const isFreshwater =
    sample.lakeWeight > 0 ||
    (sample.riverValleyWeight > 0.05 && sample.waterLevel > SEA_LEVEL) ||
    (sample.riverChannelWeight > 0.15 && climate.continentalness > -0.15);
  const isCold = context.temperature < FREEZING_TEMPERATURE;
  if (isFreshwater) return isCold ? BiomeId.FrozenRiver : BiomeId.River;

  const depth = SEA_LEVEL - sample.height;
  const isShallowTropicalCoast =
    depth <= 3 && context.temperature > 0.3 && context.humidity > 0.15 && climate.continentalness > -0.3;
  if (isShallowTropicalCoast) return BiomeId.MangroveSwamp;
  if (isCold) return BiomeId.FrozenOcean;
  if (context.temperature > 0.38) return BiomeId.WarmOcean;
  return depth > 26 ? BiomeId.DeepOcean : BiomeId.Ocean;
}

function selectMountainBiome(sample: TerrainSample, context: BiomeContext, slope: number): BiomeId {
  const { temperature, humidity, heightAboveSea } = context;
  if (temperature < -0.55) return BiomeId.SnowyPeaks;
  if (heightAboveSea > 70 && temperature < -0.2) return BiomeId.RockyPeaks;
  if (slope < 0.8 && temperature < 0.1 && humidity > -0.3 && heightAboveSea <= 70) {
    return BiomeId.AlpineMeadow;
  }
  if (temperature > -0.4 && humidity > -0.4) return BiomeId.SubalpineForest;
  return BiomeId.RockyPeaks;
}

function selectClimateBiome(sample: TerrainSample, context: BiomeContext): BiomeId {
  const { temperature, humidity } = context;
  const { weirdness, erosion } = sample.climate;

  if (temperature < -0.74) return BiomeId.Glacier;
  if (temperature < -0.55) return humidity > 0 ? BiomeId.SnowyTaiga : BiomeId.SnowyPlains;
  if (temperature < -0.3) return humidity > 0.1 ? BiomeId.Taiga : BiomeId.Tundra;

  if (temperature < 0.4) {
    if (humidity < -0.35) return weirdness > 0 ? BiomeId.Shrubland : BiomeId.Steppe;
    if (humidity < 0) {
      if (weirdness < -0.5) return BiomeId.Shrubland;
      return weirdness > 0.4 ? BiomeId.Meadow : BiomeId.Plains;
    }
    if (humidity < 0.62) {
      if (weirdness < -0.4) return BiomeId.BirchForest;
      if (weirdness > 0.55 && temperature < 0.25) return BiomeId.CherryGrove;
      if (weirdness > 0.15 && temperature < 0.15) return BiomeId.AutumnForest;
      return BiomeId.Forest;
    }
    return temperature > 0.05 && weirdness > 0 ? BiomeId.RedwoodForest : BiomeId.OldGrowthForest;
  }

  const isHot = temperature >= 0.62;
  if (humidity < (isHot ? -0.2 : -0.4)) {
    if (humidity < -0.75 && erosion > 0.5 && context.heightAboveSea < 14) return BiomeId.SaltFlat;
    return weirdness > 0.1 ? BiomeId.RedDesert : BiomeId.Desert;
  }
  if (isHot) {
    if (humidity < 0.1) return BiomeId.Savanna;
    return humidity < 0.6 ? BiomeId.Jungle : BiomeId.Rainforest;
  }
  if (humidity < -0.1) return temperature < 0.5 ? BiomeId.Steppe : BiomeId.Savanna;
  if (humidity < 0.25) return weirdness > 0.2 ? BiomeId.SavannaWoodland : BiomeId.Savanna;
  return BiomeId.Jungle;
}
