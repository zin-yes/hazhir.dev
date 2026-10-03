// Inland lakes: glacial tarns, crater-like basins and valley ponds. Each
// lake belongs to one jittered grid cell. The water surface sits just under
// the lowest point of the surrounding rim, so a lake can never spill down a
// hillside as a wall of water.

import { SEA_LEVEL } from "../constants";
import { hashToUnit, lerp, smoothstep } from "../math";
import { createFractalNoise } from "../noise-fields";

export interface LakeBaseTerrain {
  height: number;
  riverValleyWeight: number;
  canyonWeight: number;
  volcanoWeight: number;
  humidity: number;
}

export interface LakeResult {
  height: number;
  waterLevel: number;
  weight: number;
}

interface LakeCell {
  centerX: number;
  centerZ: number;
  radius: number;
  surfaceLevel: number;
  depth: number;
}

const CELL_SIZE = 340;
const LAKE_PROBABILITY = 0.4;
const RIM_SAMPLE_COUNT = 12;
const RIM_SAMPLE_RADIUS_RATIO = 1.3;
const MAX_RIM_SPREAD = 16;
const MAX_CENTER_RISE_ABOVE_SURFACE = 24;

export function createLakeCarver(seed: number, sampleBaseTerrain: (x: number, z: number) => LakeBaseTerrain) {
  const shoreShapeNoise = createFractalNoise({ seed, salt: 61, frequency: 1 / 24, octaves: 2 });
  const cellCache = new Map<number, LakeCell | null>();

  function evaluateCell(cellX: number, cellZ: number): LakeCell | null {
    if (hashToUnit(cellX, cellZ, seed + 601) > LAKE_PROBABILITY) return null;
    const centerX = (cellX + 0.2 + 0.6 * hashToUnit(cellX, cellZ, seed + 602)) * CELL_SIZE;
    const centerZ = (cellZ + 0.2 + 0.6 * hashToUnit(cellX, cellZ, seed + 603)) * CELL_SIZE;
    const radius = 14 + 38 * Math.pow(hashToUnit(cellX, cellZ, seed + 604), 1.3);

    const center = sampleBaseTerrain(centerX, centerZ);
    const isUnsuitable =
      center.height < SEA_LEVEL + 6 ||
      center.riverValleyWeight > 0.05 ||
      center.canyonWeight > 0.02 ||
      center.volcanoWeight > 0.05 ||
      center.humidity < -0.55;
    if (isUnsuitable) return null;

    let lowestRim = Infinity;
    let highestRim = -Infinity;
    for (let sampleIndex = 0; sampleIndex < RIM_SAMPLE_COUNT; sampleIndex++) {
      const angle = (sampleIndex / RIM_SAMPLE_COUNT) * Math.PI * 2;
      const rimHeight = sampleBaseTerrain(
        centerX + Math.cos(angle) * radius * RIM_SAMPLE_RADIUS_RATIO,
        centerZ + Math.sin(angle) * radius * RIM_SAMPLE_RADIUS_RATIO,
      ).height;
      lowestRim = Math.min(lowestRim, rimHeight);
      highestRim = Math.max(highestRim, rimHeight);
    }
    const surfaceLevel = Math.floor(lowestRim) - 1;
    if (highestRim - lowestRim > MAX_RIM_SPREAD || surfaceLevel <= SEA_LEVEL + 2) return null;
    if (center.height - surfaceLevel > MAX_CENTER_RISE_ABOVE_SURFACE) return null;

    return { centerX, centerZ, radius, surfaceLevel, depth: 4 + 6 * hashToUnit(cellX, cellZ, seed + 605) };
  }

  function getCell(cellX: number, cellZ: number): LakeCell | null {
    const key = (cellX + 32768) * 65536 + (cellZ + 32768);
    if (!cellCache.has(key)) cellCache.set(key, evaluateCell(cellX, cellZ));
    return cellCache.get(key) ?? null;
  }

  return (x: number, z: number, height: number): LakeResult => {
    const ownCellX = Math.floor(x / CELL_SIZE);
    const ownCellZ = Math.floor(z / CELL_SIZE);
    for (let cellOffsetX = -1; cellOffsetX <= 1; cellOffsetX++) {
      for (let cellOffsetZ = -1; cellOffsetZ <= 1; cellOffsetZ++) {
        const cellX = ownCellX + cellOffsetX;
        const cellZ = ownCellZ + cellOffsetZ;
        if (hashToUnit(cellX, cellZ, seed + 601) > LAKE_PROBABILITY) continue;
        const approximateCenterX = (cellX + 0.5) * CELL_SIZE;
        const approximateCenterZ = (cellZ + 0.5) * CELL_SIZE;
        if (Math.hypot(x - approximateCenterX, z - approximateCenterZ) > CELL_SIZE * 0.5 + 90) continue;

        const lake = getCell(cellX, cellZ);
        if (!lake) continue;
        const shapedDistance =
          Math.hypot(x - lake.centerX, z - lake.centerZ) /
          (lake.radius * (1 + shoreShapeNoise(x, z) * 0.7));
        if (shapedDistance >= 1.35) continue;

        const shoreBed = lake.surfaceLevel - 1;
        if (shapedDistance < 1) {
          const bowl = shoreBed - lake.depth * (1 - shapedDistance * shapedDistance);
          return { height: Math.min(height, bowl), waterLevel: lake.surfaceLevel, weight: 1 };
        }
        const bankBlend = smoothstep(1, 1.35, shapedDistance);
        const bankHeight = height > shoreBed ? lerp(shoreBed, height, bankBlend) : height;
        return { height: bankHeight, waterLevel: lake.surfaceLevel, weight: 1 - bankBlend };
      }
    }
    return { height, waterLevel: 0, weight: 0 };
  };
}
