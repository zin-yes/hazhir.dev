// Mirrors SnowAndFreezeFeature (minecraft:freeze_top_layer): for each of the 16x16 columns of the chunk, ice over
// the water under the MOTION_BLOCKING surface and a snow layer on top, wherever Biome.getTemperature at that
// position is below 0.15 (Biome.shouldFreeze / shouldSnow, block light is always 0 in unlit protochunks).

import { isFluidWater } from "../../../block-state";
import { defineFeatureType, type FeatureChunkGenerator } from "../../feature/feature-type";
import type { WorldGenLevel } from "../../level/world-gen-level";
import { ICE_BLOCK, isBlock, SNOW_LAYER_BLOCK, WATER_BLOCK } from "./block-names";

const WARM_ENOUGH_TO_RAIN_TEMPERATURE = Math.fround(0.15);
const SNOW_LAYERS_FULL = "8";
const SNOWY_PROPERTY = "snowy";

type TemperatureLookup = NonNullable<FeatureChunkGenerator["biomeTemperature"]>;

/** Biome.warmEnoughToRain(pos). */
function isWarmEnoughToRain(temperatureAt: TemperatureLookup, biomeId: string, x: number, y: number, z: number): boolean {
  return temperatureAt(biomeId, x, y, z) >= WARM_ENOUGH_TO_RAIN_TEMPERATURE;
}

/** Biome.shouldFreeze(level, pos, mustBeSurrounded = false): a water source LiquidBlock in a cold enough place. */
function shouldFreeze(level: WorldGenLevel, temperatureAt: TemperatureLookup, biomeId: string, x: number, y: number, z: number): boolean {
  if (isWarmEnoughToRain(temperatureAt, biomeId, x, y, z)) return false;
  if (y < level.minY || y >= level.minY + level.height) return false;
  const info = level.getBlockInfo(x, y, z);
  return isFluidWater(info.fluid) && info.name === WATER_BLOCK;
}

/** SnowLayerBlock.canSurvive plus the layers == 8 snow-on-snow case the generic survival table cannot see. */
function snowLayerCanSurvive(level: WorldGenLevel, x: number, y: number, z: number): boolean {
  const below = level.getBlockState(x, y - 1, z);
  if (isBlock(below, SNOW_LAYER_BLOCK) && level.blockStates.propertiesOf(below).layers === SNOW_LAYERS_FULL) return true;
  return level.survival.canSurvive(level.blockStates.defaultState(SNOW_LAYER_BLOCK), level, x, y, z);
}

/** Biome.shouldSnow. */
function shouldSnow(level: WorldGenLevel, temperatureAt: TemperatureLookup, biomeId: string, x: number, y: number, z: number): boolean {
  if (isWarmEnoughToRain(temperatureAt, biomeId, x, y, z)) return false;
  if (y < level.minY || y >= level.minY + level.height) return false;
  const current = level.getBlockState(x, y, z);
  if (!level.blockStates.info(current).isAir && !isBlock(current, SNOW_LAYER_BLOCK)) return false;
  return snowLayerCanSurvive(level, x, y, z);
}

export const freezeTopLayerFeature = defineFeatureType<undefined>({
  id: "minecraft:freeze_top_layer",
  parseConfig: () => undefined,
  place({ level, generator, origin }) {
    const temperatureAt = generator.biomeTemperature;
    if (!temperatureAt) throw new Error("freeze_top_layer needs generator.biomeTemperature (Biome.getTemperature)");
    const temperature: TemperatureLookup = (biomeId, x, y, z) => temperatureAt.call(generator, biomeId, x, y, z);
    for (let offsetX = 0; offsetX < 16; offsetX++) {
      for (let offsetZ = 0; offsetZ < 16; offsetZ++) {
        const x = origin.x + offsetX;
        const z = origin.z + offsetZ;
        const topY = level.getHeight("MOTION_BLOCKING", x, z);
        const belowY = topY - 1;
        const biomeId = level.getBiome(x, topY, z);
        if (shouldFreeze(level, temperature, biomeId, x, belowY, z)) level.setBlock(x, belowY, z, ICE_BLOCK, 2);
        if (!shouldSnow(level, temperature, biomeId, x, topY, z)) continue;
        level.setBlock(x, topY, z, level.blockStates.defaultState(SNOW_LAYER_BLOCK), 2);
        const below = level.getBlockState(x, belowY, z);
        if (level.blockStates.hasProperty(below, SNOWY_PROPERTY)) level.setBlock(x, belowY, z, level.blockStates.withProperty(below, SNOWY_PROPERTY, "true"), 2);
      }
    }
    return true;
  },
});
