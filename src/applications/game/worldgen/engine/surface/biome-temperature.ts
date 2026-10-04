// Mirrors Biome.getTemperature / coldEnoughToSnow / shouldMeltFrozenOceanIcebergSlightly, including the
// FROZEN temperature modifier and the height-adjustment noise (all of them float math in Java).

import { PerlinSimplexNoise } from "../noise";
import { LegacyRandomSource } from "../random";
import type { JsonObject } from "../registry/datapack-loader";
import type { BiomeClimate, BiomeClimateLookup } from "./surface-types";

const SNOW_TEMPERATURE_THRESHOLD = Math.fround(0.15);
const ICEBERG_MELT_TEMPERATURE_THRESHOLD = Math.fround(0.1);
const HEIGHT_ADJUSTMENT_START_Y = 80;

export function createBiomeClimateLookup(biomeRegistry: Record<string, JsonObject>): BiomeClimateLookup {
  const climateByBiomeId = new Map<string, BiomeClimate>();
  return (biomeId) => {
    const cached = climateByBiomeId.get(biomeId);
    if (cached) return cached;
    const biomeJson = biomeRegistry[biomeId];
    if (!biomeJson) throw new Error(`Unknown biome ${biomeId} in biome registry`);
    const climate: BiomeClimate = {
      temperature: Math.fround(Number(biomeJson.temperature)),
      temperatureModifier: biomeJson.temperature_modifier === "frozen" ? "frozen" : "none",
    };
    climateByBiomeId.set(biomeId, climate);
    return climate;
  };
}

export class BiomeTemperatureSampler {
  private heightNoise: PerlinSimplexNoise | undefined;
  private frozenNoise: PerlinSimplexNoise | undefined;
  private biomeInfoNoise: PerlinSimplexNoise | undefined;

  constructor(private readonly lookupClimate: BiomeClimateLookup | undefined) {}

  private climateOf(biomeId: string): BiomeClimate {
    if (!this.lookupClimate) {
      throw new Error("A biomeClimate lookup is required: the surface rules evaluate Biome.getTemperature");
    }
    return this.lookupClimate(biomeId);
  }

  private modifiedTemperature(climate: BiomeClimate, blockX: number, blockZ: number): number {
    if (climate.temperatureModifier !== "frozen") return climate.temperature;
    this.frozenNoise ??= new PerlinSimplexNoise(new LegacyRandomSource(BigInt(3456)), [-2, -1, 0]);
    this.biomeInfoNoise ??= new PerlinSimplexNoise(new LegacyRandomSource(BigInt(2345)), [0]);
    const frozenValue = this.frozenNoise.getValue(blockX * 0.05, blockZ * 0.05, false) * 7;
    const infoValue = this.biomeInfoNoise.getValue(blockX * 0.2, blockZ * 0.2, false);
    if (frozenValue + infoValue < 0.3) {
      const smallInfoValue = this.biomeInfoNoise.getValue(blockX * 0.09, blockZ * 0.09, false);
      if (smallInfoValue < 0.8) return Math.fround(0.2);
    }
    return climate.temperature;
  }

  getTemperature(biomeId: string, blockX: number, blockY: number, blockZ: number): number {
    const modified = this.modifiedTemperature(this.climateOf(biomeId), blockX, blockZ);
    if (blockY <= HEIGHT_ADJUSTMENT_START_Y) return modified;
    this.heightNoise ??= new PerlinSimplexNoise(new LegacyRandomSource(BigInt(1234)), [0]);
    const noiseValue = Math.fround(
      this.heightNoise.getValue(Math.fround(Math.fround(blockX) / 8), Math.fround(Math.fround(blockZ) / 8), false) * 8,
    );
    const aboveStart = Math.fround(Math.fround(noiseValue + Math.fround(blockY)) - HEIGHT_ADJUSTMENT_START_Y);
    const heightPenalty = Math.fround(Math.fround(aboveStart * Math.fround(0.05)) / 40);
    return Math.fround(modified - heightPenalty);
  }

  isColdEnoughToSnow(biomeId: string, blockX: number, blockY: number, blockZ: number): boolean {
    return !(this.getTemperature(biomeId, blockX, blockY, blockZ) >= SNOW_TEMPERATURE_THRESHOLD);
  }

  shouldMeltFrozenOceanIcebergSlightly(biomeId: string, blockX: number, blockY: number, blockZ: number): boolean {
    return this.getTemperature(biomeId, blockX, blockY, blockZ) > ICEBERG_MELT_TEMPERATURE_THRESHOLD;
  }
}
