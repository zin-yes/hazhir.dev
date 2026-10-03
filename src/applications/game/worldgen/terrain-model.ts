// Combines the climate fields and landform modules into one height and water
// description per world column. Heights come from a continental profile,
// rugged mountain belts along ridge lines, arid plateaus, volcanoes, islands,
// then rivers and lakes carved last.

import { createClimateField, type ClimateSample } from "./climate";
import { createAridLandforms, computeAridity } from "./landforms/arid-landforms";
import { continentalElevation } from "./landforms/continental-profile";
import { createIslandField } from "./landforms/islands";
import { createLakeCarver } from "./landforms/lakes";
import { createRiverCarver } from "./landforms/rivers";
import { createVolcanoField } from "./landforms/volcanoes";
import { SEA_LEVEL } from "./constants";
import { lerp, smoothstep } from "./math";
import { createFractalNoise, createUniformNoise } from "./noise-fields";
import type { TerrainSample } from "./terrain-types";

export interface TerrainModel {
  sample(x: number, z: number): TerrainSample;
  sampleClimate(x: number, z: number): ClimateSample;
}

export function createTerrainModel(seed: number): TerrainModel {
  const sampleClimate = createClimateField(seed);
  const hillNoise = createFractalNoise({ seed, salt: 71, frequency: 1 / 120, octaves: 3 });
  const detailNoise = createFractalNoise({ seed, salt: 72, frequency: 1 / 28, octaves: 2 });
  const peakVariationNoise = createUniformNoise({ seed, salt: 73, frequency: 1 / 450, octaves: 2 });
  const cliffNoise = createUniformNoise({ seed, salt: 74, frequency: 1 / 700, octaves: 2 });
  const cragNoise = createFractalNoise({ seed, salt: 75, frequency: 1 / 64, octaves: 3 });
  const shapeAridLandforms = createAridLandforms(seed);
  const carveRivers = createRiverCarver(seed);
  const sampleVolcano = createVolcanoField(seed);
  const shapeIslands = createIslandField(seed);

  function sampleWithoutLakes(x: number, z: number): TerrainSample {
    const climate = sampleClimate(x, z);
    const { continentalness, erosion, ridgeness } = climate;

    const inland = smoothstep(-0.12, 0.25, continentalness);
    const ruggedness = smoothstep(0.7, -0.6, erosion);
    const cliffiness =
      smoothstep(0.2, -0.5, erosion) * smoothstep(-0.1, 0.35, cliffNoise(x, z));
    const mountainMask =
      smoothstep(0.08, 0.5, continentalness) * smoothstep(-0.2, -0.7, erosion);

    const hillAmplitude = lerp(4, 17, ruggedness) * (0.25 + 0.75 * inland);
    const regionalHeight =
      continentalElevation(continentalness, cliffiness) +
      hillNoise(x, z) * 2.4 * hillAmplitude +
      mountainMask * 20;

    const peakVariation = 0.55 + 0.45 * (peakVariationNoise(x, z) * 0.5 + 0.5);
    const crags = (1 - Math.min(1, Math.abs(cragNoise(x, z)) * 3)) * 16 * ridgeness;
    const mountainLift =
      mountainMask * (125 * Math.pow(smoothstep(0, 1, ridgeness), 1.15) * peakVariation + crags);
    const detail = detailNoise(x, z) * 2.2 * (0.4 + 0.6 * inland);
    let height = regionalHeight + mountainLift + detail;

    const island = shapeIslands(x, z, height, continentalness, climate.temperature);
    height = island.height;

    const arid = shapeAridLandforms(x, z, climate, height);
    height = arid.height;

    const volcano = sampleVolcano(x, z);
    height += volcano.heightLift;

    const river = carveRivers({
      x,
      z,
      climate,
      height,
      regionalHeight,
      mountainMask,
      aridity: computeAridity(climate),
    });
    height = river.height;

    let waterLevel = 0;
    if (river.valleyWeight > 0.02) waterLevel = river.waterLevel;
    if (height < SEA_LEVEL) waterLevel = Math.max(waterLevel, SEA_LEVEL);

    return {
      height,
      waterLevel,
      climate,
      mountainMask,
      riverValleyWeight: river.valleyWeight,
      riverChannelWeight: river.channelWeight,
      fjordWeight: river.fjordWeight,
      canyonWeight: arid.canyonWeight,
      mesaWeight: arid.mesaWeight,
      volcanoWeight: volcano.coneWeight,
      craterWeight: volcano.craterWeight,
      islandKind: island.kind,
      lakeWeight: 0,
    };
  }

  const carveLakes = createLakeCarver(seed, (x, z) => {
    const base = sampleWithoutLakes(x, z);
    return {
      height: base.height,
      riverValleyWeight: base.riverValleyWeight,
      canyonWeight: base.canyonWeight,
      volcanoWeight: base.volcanoWeight,
      humidity: base.climate.humidity,
    };
  });

  return {
    sampleClimate,
    sample(x, z) {
      const terrain = sampleWithoutLakes(x, z);
      const lake = carveLakes(x, z, terrain.height);
      if (lake.weight <= 0) return terrain;
      terrain.height = lake.height;
      terrain.lakeWeight = lake.weight;
      if (terrain.height < lake.waterLevel) {
        terrain.waterLevel = Math.max(terrain.waterLevel, lake.waterLevel);
      }
      return terrain;
    },
  };
}
