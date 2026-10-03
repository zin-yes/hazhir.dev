// Large-scale fields that decide where continents, mountain belts and
// climate zones sit. Every field is roughly uniform in [-1, 1].

import { clamp } from "./math";
import { createFractalNoise, createUniformNoise } from "./noise-fields";

export interface ClimateSample {
  /** -1 deep ocean ... 1 continental interior. */
  continentalness: number;
  /** -1 young, rugged relief ... 1 old, worn-down plains. */
  erosion: number;
  /** 0 valley floor ... 1 sharp mountain crest line. */
  ridgeness: number;
  /** -1 polar ... 1 tropical, before altitude cooling. */
  temperature: number;
  /** -1 arid ... 1 saturated. */
  humidity: number;
  /** Selects between alternative biome variants. */
  weirdness: number;
}

const CONTINENT_WARP_STRENGTH = 130;
const RIDGE_HALF_WIDTH = 0.3;
const TEMPERATURE_SPREAD = 0.85;
const TEMPERATURE_BIAS = 0.2;

export function createClimateField(seed: number): (x: number, z: number) => ClimateSample {
  const warpEastWest = createFractalNoise({ seed, salt: 1, frequency: 1 / 520, octaves: 2 });
  const warpNorthSouth = createFractalNoise({ seed, salt: 2, frequency: 1 / 520, octaves: 2 });
  const continentalness = createUniformNoise({ seed, salt: 3, frequency: 1 / 2600, octaves: 5, gain: 0.45 });
  const erosion = createUniformNoise({ seed, salt: 4, frequency: 1 / 1500, octaves: 3 });
  const ridgeRaw = createFractalNoise({ seed, salt: 5, frequency: 1 / 620, octaves: 3 });
  const temperature = createUniformNoise({ seed, salt: 6, frequency: 1 / 2300, octaves: 3 });
  const humidity = createUniformNoise({ seed, salt: 7, frequency: 1 / 1900, octaves: 3 });
  const weirdness = createUniformNoise({ seed, salt: 8, frequency: 1 / 1300, octaves: 2 });
  const temperatureEdgeJitter = createFractalNoise({ seed, salt: 9, frequency: 1 / 90, octaves: 2 });
  const humidityEdgeJitter = createFractalNoise({ seed, salt: 10, frequency: 1 / 90, octaves: 2 });

  return (x, z) => {
    const warpedX = x + warpEastWest(x, z) * CONTINENT_WARP_STRENGTH;
    const warpedZ = z + warpNorthSouth(x, z) * CONTINENT_WARP_STRENGTH;
    const ridgeDistance = Math.abs(ridgeRaw(warpedX, warpedZ));
    const ridgeness = clamp(1 - ridgeDistance / RIDGE_HALF_WIDTH, 0, 1);
    return {
      continentalness: continentalness(warpedX, warpedZ),
      erosion: erosion(x, z),
      ridgeness,
      temperature: clamp(temperature(x, z) * TEMPERATURE_SPREAD + TEMPERATURE_BIAS + temperatureEdgeJitter(x, z) * 0.05, -1, 1),
      humidity: clamp(humidity(x, z) + humidityEdgeJitter(x, z) * 0.05, -1, 1),
      weirdness: weirdness(x, z),
    };
  };
}
