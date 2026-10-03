import { describe, expect, test } from "bun:test";
import { createTerrainModel } from "../terrain-model";
import { BiomeId } from "./biome-types";
import { describeBiomeContext, selectBiome } from "./biome-selection";

const SAMPLE_COUNT = 30000;
const SAMPLE_SPAN = 40000;

function sampleBiomes(seed: number) {
  const model = createTerrainModel(seed);
  let state = 99;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const columns = [];
  for (let index = 0; index < SAMPLE_COUNT; index++) {
    const x = Math.floor((next() - 0.5) * SAMPLE_SPAN);
    const z = Math.floor((next() - 0.5) * SAMPLE_SPAN);
    const sample = model.sample(x, z);
    const slope = Math.max(
      Math.abs(sample.height - model.sample(x + 1, z).height),
      Math.abs(sample.height - model.sample(x, z + 1).height),
    );
    columns.push({ sample, biome: selectBiome(sample, slope) });
  }
  return columns;
}

describe("biome selection", () => {
  const columns = sampleBiomes(7);
  const meanTemperature = (biomes: BiomeId[]) => {
    const matching = columns.filter((column) => biomes.includes(column.biome));
    expect(matching.length).toBeGreaterThan(50);
    return (
      matching.reduce((total, column) => total + describeBiomeContext(column.sample).temperature, 0) /
      matching.length
    );
  };

  test("a world spans most of the biome roster", () => {
    const distinctBiomes = new Set(columns.map((column) => column.biome));
    expect(distinctBiomes.size).toBeGreaterThanOrEqual(30);
  });

  test("cold biomes are colder than hot ones", () => {
    const polar = meanTemperature([BiomeId.SnowyTaiga, BiomeId.SnowyPlains, BiomeId.Tundra]);
    const tropical = meanTemperature([BiomeId.Jungle, BiomeId.Rainforest, BiomeId.Savanna]);
    expect(polar).toBeLessThan(-0.3);
    expect(tropical).toBeGreaterThan(0.3);
  });

  test("deserts are drier than forests", () => {
    const humidityOf = (biomes: BiomeId[]) => {
      const matching = columns.filter((column) => biomes.includes(column.biome));
      expect(matching.length).toBeGreaterThan(50);
      return matching.reduce((total, column) => total + column.sample.climate.humidity, 0) / matching.length;
    };
    expect(humidityOf([BiomeId.Desert, BiomeId.RedDesert])).toBeLessThan(
      humidityOf([BiomeId.Forest, BiomeId.OldGrowthForest, BiomeId.BirchForest]) - 0.4,
    );
  });

  test("columns holding water are oceans, rivers or wetlands, never dry land biomes", () => {
    const waterBiomes = new Set([
      BiomeId.DeepOcean, BiomeId.Ocean, BiomeId.WarmOcean, BiomeId.FrozenOcean,
      BiomeId.River, BiomeId.FrozenRiver, BiomeId.MangroveSwamp,
    ]);
    const submerged = columns.filter((column) => column.sample.waterLevel > column.sample.height + 1);
    expect(submerged.length).toBeGreaterThan(1000);
    for (const column of submerged) expect(waterBiomes.has(column.biome)).toBe(true);
  });
});
