// Rivers follow the zero line of a warped noise field, so they form
// continuous winding networks. They widen and deepen toward the coast, flatten
// a floodplain around themselves, and hold water at a level that rises with
// the surrounding land. In cold coastal mountains the same machinery carves
// deep, steep-walled fjords.

import { SEA_LEVEL } from "../constants";
import { lerp, smoothstep } from "../math";
import { createFractalNoise } from "../noise-fields";
import type { ClimateSample } from "../climate";

export interface RiverInput {
  x: number;
  z: number;
  climate: ClimateSample;
  height: number;
  regionalHeight: number;
  mountainMask: number;
  aridity: number;
}

export interface RiverResult {
  height: number;
  waterLevel: number;
  valleyWeight: number;
  channelWeight: number;
  fjordWeight: number;
}

const NO_RIVER: Omit<RiverResult, "height"> = {
  waterLevel: 0,
  valleyWeight: 0,
  channelWeight: 0,
  fjordWeight: 0,
};

const HIGH_RIVER_SURFACE_OFFSET = 14;
const HIGH_RIVER_SURFACE_RISE_RATIO = 0.6;
const FJORD_SEABED_DEPTH = 30;

export function riverSurfaceLevel(regionalHeight: number): number {
  const excess = regionalHeight - SEA_LEVEL - HIGH_RIVER_SURFACE_OFFSET;
  return excess <= 0 ? SEA_LEVEL : Math.round(SEA_LEVEL + excess * HIGH_RIVER_SURFACE_RISE_RATIO);
}

export function createRiverCarver(seed: number): (input: RiverInput) => RiverResult {
  const riverLine = createFractalNoise({ seed, salt: 21, frequency: 1 / 1000, octaves: 3 });
  const meanderWarpX = createFractalNoise({ seed, salt: 22, frequency: 1 / 260, octaves: 2 });
  const meanderWarpZ = createFractalNoise({ seed, salt: 23, frequency: 1 / 260, octaves: 2 });
  const fjordLine = createFractalNoise({ seed, salt: 24, frequency: 1 / 800, octaves: 3 });

  return ({ x, z, climate, height, regionalHeight, mountainMask, aridity }) => {
    const { continentalness, temperature, erosion } = climate;

    const fjordWeight =
      smoothstep(-0.12, -0.04, continentalness) *
      (1 - smoothstep(0.1, 0.35, continentalness)) *
      smoothstep(-0.2, -0.55, temperature) *
      smoothstep(0.25, -0.2, erosion);
    let carvedHeight = height;
    if (fjordWeight > 0.02) {
      const fjordDistance = Math.abs(fjordLine(x, z));
      const fjordChannel = 1 - smoothstep(0.055, 0.085, fjordDistance);
      const fjordFloor = SEA_LEVEL - FJORD_SEABED_DEPTH + fjordDistance * 120;
      carvedHeight = lerp(carvedHeight, fjordFloor, fjordChannel * fjordWeight);
    }

    const landFactor = smoothstep(-0.2, -0.06, continentalness);
    const strength =
      landFactor *
      (1 - mountainMask * 0.9) *
      (1 - aridity * 0.5) *
      smoothstep(SEA_LEVEL + 75, SEA_LEVEL + 30, regionalHeight);
    if (strength < 0.01) return { ...NO_RIVER, height: carvedHeight, fjordWeight };

    const warpedX = x + meanderWarpX(x, z) * 70;
    const warpedZ = z + meanderWarpZ(x, z) * 70;
    const lineDistance = Math.abs(riverLine(warpedX, warpedZ));
    const downstream = 1 - smoothstep(-0.1, 0.55, continentalness);
    const channelHalfWidth = 0.008 + 0.014 * downstream;
    const valleyHalfWidth = channelHalfWidth * 3.2 + 0.03 * downstream;

    const valleyWeight =
      (1 - smoothstep(channelHalfWidth * 0.8, valleyHalfWidth, lineDistance)) * strength;
    if (valleyWeight < 0.005) return { ...NO_RIVER, height: carvedHeight, fjordWeight };

    const surface = riverSurfaceLevel(regionalHeight);
    const floodplain = surface + 1.6;
    const floodplainTarget =
      carvedHeight > floodplain ? floodplain + (carvedHeight - floodplain) * 0.2 : carvedHeight;
    carvedHeight = lerp(carvedHeight, floodplainTarget, Math.sqrt(valleyWeight));

    const channelLinear = 1 - smoothstep(channelHalfWidth * 0.55, channelHalfWidth, lineDistance);
    const channelWeight = channelLinear * channelLinear * (3 - 2 * channelLinear) * strength;
    const riverBed = surface - (3.2 + 2 * downstream);
    carvedHeight = lerp(carvedHeight, Math.min(carvedHeight, riverBed), channelWeight);

    return {
      height: carvedHeight,
      waterLevel: surface,
      valleyWeight,
      channelWeight,
      fjordWeight,
    };
  };
}
