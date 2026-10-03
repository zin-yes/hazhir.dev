// Finds dry, gentle ground near the origin for the player to start on.

import { SEA_LEVEL } from "./constants";
import { getTerrainModel } from "./column-grid";

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
}

const SEARCH_STEP = 16;
const MAX_SEARCH_RING = 400;
const SPAWN_CLEARANCE = 2;

export function findSpawnPoint(seed: number): SpawnPoint {
  const terrain = getTerrainModel(seed);
  for (let ring = 0; ring <= MAX_SEARCH_RING; ring++) {
    for (let offsetX = -ring; offsetX <= ring; offsetX++) {
      for (let offsetZ = -ring; offsetZ <= ring; offsetZ++) {
        if (Math.max(Math.abs(offsetX), Math.abs(offsetZ)) !== ring) continue;
        const x = offsetX * SEARCH_STEP;
        const z = offsetZ * SEARCH_STEP;
        const sample = terrain.sample(x, z);
        const isDryGentleLand =
          sample.height > SEA_LEVEL + 3 &&
          sample.height < SEA_LEVEL + 45 &&
          sample.waterLevel <= sample.height &&
          sample.riverValleyWeight < 0.1 &&
          sample.volcanoWeight === 0 &&
          sample.canyonWeight === 0 &&
          sample.mountainMask < 0.3;
        if (isDryGentleLand) return { x, y: Math.ceil(sample.height) + SPAWN_CLEARANCE, z };
      }
    }
  }
  return { x: 0, y: SEA_LEVEL + 40, z: 0 };
}
