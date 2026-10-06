// CPU twin of the cloud density in the sky shader: one continuous volume inside the cloud deck, shaped by tileable
// noise, thickened by humidity and weather, thinned by carved holes. The CPU needs it to know how deep inside a cloud
// the viewer is (mist) and to carve holes the shader also honours.

import { profiler } from "../profiler";
import { sampleCloudNoise } from "./cloud-noise";
import {
  CLOUD_BASE_COVERAGE,
  CLOUD_BASE_Y,
  CLOUD_DETAIL_TILE_BLOCKS,
  CLOUD_EVOLUTION_PER_SECOND,
  CLOUD_HUMIDITY_GAIN,
  CLOUD_SHAPE_TILE_BLOCKS,
  CLOUD_SHAPE_VERTICAL_TILE_BLOCKS,
  CLOUD_THICKNESS,
  CLOUD_WIND_BLOCKS_PER_SECOND,
} from "./sky-constants";

export interface CloudCarve {
  x: number;
  y: number;
  z: number;
  radius: number;
}

export interface CloudFieldInputs {
  noise: Uint8Array;
  elapsedSeconds: number;
  weatherShift: number;
  humidityAt(worldX: number, worldZ: number): number;
  carves: readonly CloudCarve[];
}

/** Density thresholds: the shape must beat this (falling as coverage rises) to become cloud. */
export const SHAPE_THRESHOLD_CLEAR = 0.85;
export const SHAPE_THRESHOLD_OVERCAST = 0.2;
export const SHAPE_SOFTNESS = 0.16;

function smoothstep(edgeStart: number, edgeEnd: number, value: number): number {
  const fraction = Math.min(1, Math.max(0, (value - edgeStart) / (edgeEnd - edgeStart)));
  return fraction * fraction * (3 - 2 * fraction);
}

/** 0 at the deck's floor and ceiling, a flat floor and billowy top in between. */
export function verticalProfile(heightFraction: number): number {
  if (heightFraction <= 0 || heightFraction >= 1) return 0;
  return smoothstep(0, 0.12, heightFraction) * (1 - smoothstep(0.55, 1, heightFraction));
}

export function carveFactor(x: number, y: number, z: number, carves: readonly CloudCarve[]): number {
  let factor = 1;
  for (const carve of carves) {
    if (carve.radius <= 0) continue;
    const distance = Math.hypot(x - carve.x, y - carve.y, z - carve.z);
    factor = Math.min(factor, smoothstep(carve.radius * 0.6, carve.radius, distance));
  }
  return factor;
}

export function windOffsetAt(elapsedSeconds: number): { x: number; z: number } {
  return {
    x: CLOUD_WIND_BLOCKS_PER_SECOND.x * elapsedSeconds,
    z: CLOUD_WIND_BLOCKS_PER_SECOND.z * elapsedSeconds,
  };
}

/** Cloud density 0..1 at a world position (0 outside the deck). */
export function cloudDensityAt(worldX: number, worldY: number, worldZ: number, inputs: CloudFieldInputs): number {
  profiler.addCounter("game.sky.cloudDensity.evaluations");
  const heightFraction = (worldY - CLOUD_BASE_Y) / CLOUD_THICKNESS;
  const profile = verticalProfile(heightFraction);
  if (profile <= 0) {
    profiler.addCounter("game.sky.cloudDensity.outsideDeck");
    return 0;
  }

  const wind = windOffsetAt(inputs.elapsedSeconds);
  const driftedX = worldX - wind.x;
  const driftedZ = worldZ - wind.z;
  const evolve = inputs.elapsedSeconds * CLOUD_EVOLUTION_PER_SECOND;
  const baseShape = sampleCloudNoise(
    inputs.noise,
    driftedX / CLOUD_SHAPE_TILE_BLOCKS,
    worldY / CLOUD_SHAPE_VERTICAL_TILE_BLOCKS + evolve,
    driftedZ / CLOUD_SHAPE_TILE_BLOCKS,
    0,
  );
  const coverage = Math.min(
    1,
    Math.max(0, CLOUD_BASE_COVERAGE + inputs.humidityAt(worldX, worldZ) * CLOUD_HUMIDITY_GAIN + inputs.weatherShift),
  );
  const threshold = SHAPE_THRESHOLD_CLEAR + (SHAPE_THRESHOLD_OVERCAST - SHAPE_THRESHOLD_CLEAR) * coverage;
  let density = smoothstep(threshold, threshold + SHAPE_SOFTNESS, baseShape * profile);
  profiler.addCounter("game.sky.cloudDensity.noiseSamples");
  if (density <= 0) {
    profiler.addCounter("game.sky.cloudDensity.belowShapeThreshold");
    return 0;
  }

  const detail = sampleCloudNoise(
    inputs.noise,
    driftedX / CLOUD_DETAIL_TILE_BLOCKS,
    worldY / CLOUD_DETAIL_TILE_BLOCKS,
    driftedZ / CLOUD_DETAIL_TILE_BLOCKS,
    1,
  );
  density = Math.min(1, Math.max(0, density * 1.25 - (1 - detail) * 0.35));
  profiler.addCounter("game.sky.cloudDensity.noiseSamples");
  profiler.addCounter("game.sky.cloudDensity.insideCloud");
  profiler.addCounter("game.sky.cloudDensity.carveChecks", inputs.carves.length);
  return density * carveFactor(worldX, worldY, worldZ, inputs.carves);
}
