// Softens biome borders. A column picks its biome from climate sampled at a
// slightly scrambled position, so near a border the two neighboring biomes
// interleave in patches instead of meeting along a clean line.

import type { ClimateSample } from "../climate";
import { createFractalNoise } from "../noise-fields";
import type { TerrainSample } from "../terrain-types";

const BLEND_WARP_DISTANCE = 100;

export type BiomeBlender = (worldX: number, worldZ: number, sample: TerrainSample) => TerrainSample;

export function createBiomeBlender(
  seed: number,
  sampleClimate: (x: number, z: number) => ClimateSample,
): BiomeBlender {
  const warpEastWest = createFractalNoise({ seed, salt: 81, frequency: 1 / 22, octaves: 2 });
  const warpNorthSouth = createFractalNoise({ seed, salt: 82, frequency: 1 / 22, octaves: 2 });

  return (worldX, worldZ, sample) => {
    const isUnderwater = sample.waterLevel > sample.height;
    if (isUnderwater) return sample;
    const climate = sampleClimate(
      worldX + warpEastWest(worldX, worldZ) * BLEND_WARP_DISTANCE,
      worldZ + warpNorthSouth(worldX, worldZ) * BLEND_WARP_DISTANCE,
    );
    return { ...sample, climate };
  };
}
