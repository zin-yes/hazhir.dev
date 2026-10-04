// Finds dry, gentle ground near the origin for the player to start on.
// Candidate columns are pre-filtered by biome (microseconds) so only a few full columns get generated.

import { GAME_Y_OFFSET, SEA_LEVEL } from "./constants";
import { getTerrainHeightSampler, getTerrainOnlyGenerator } from "./overworld-world";

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
}

const SEARCH_STEP = 16;
const MAX_SEARCH_RING = 200;
const MAX_COLUMN_CHECKS = 16;
const SPAWN_CLEARANCE = 2;
const MIN_HEIGHT_ABOVE_SEA = 3;
const MAX_HEIGHT_ABOVE_SEA = 45;
const MAX_SLOPE_PROBE_DIFFERENCE = 4;
const SLOPE_PROBE_DISTANCE = 4;
const WET_BIOME_PATTERN = /ocean|river|beach|shore|swamp|mangrove|lake|lagoon|reef|bog|marsh/;

export function findSpawnPoint(seed: number): SpawnPoint {
  const generator = getTerrainOnlyGenerator(seed);
  const probeBiomeY = generator.settings.seaLevel + MIN_HEIGHT_ABOVE_SEA;
  const heights = getTerrainHeightSampler(seed);
  const groundTopGameY = (x: number, z: number) =>
    (heights === null ? generator.surfaceHeight(x, z, "OCEAN_FLOOR_WG") : heights.oceanFloorHeight(x, z)) - 1 + GAME_Y_OFFSET;
  const waterTopGameY = (x: number, z: number) =>
    (heights === null ? generator.surfaceHeight(x, z, "WORLD_SURFACE_WG") : heights.worldSurfaceHeight(x, z)) - 1 + GAME_Y_OFFSET;

  let columnChecks = 0;
  for (let ring = 0; ring <= MAX_SEARCH_RING; ring++) {
    for (let offsetX = -ring; offsetX <= ring; offsetX++) {
      for (let offsetZ = -ring; offsetZ <= ring; offsetZ++) {
        if (Math.max(Math.abs(offsetX), Math.abs(offsetZ)) !== ring) continue;
        const x = offsetX * SEARCH_STEP + SEARCH_STEP / 2;
        const z = offsetZ * SEARCH_STEP + SEARCH_STEP / 2;
        if (WET_BIOME_PATTERN.test(generator.biomeAt(x, probeBiomeY, z))) continue;
        if (columnChecks++ >= MAX_COLUMN_CHECKS) return { x: 0, y: SEA_LEVEL + 40, z: 0 };

        const groundY = groundTopGameY(x, z);
        const isDry = waterTopGameY(x, z) === groundY;
        const isGentleHeight = groundY > SEA_LEVEL + MIN_HEIGHT_ABOVE_SEA && groundY < SEA_LEVEL + MAX_HEIGHT_ABOVE_SEA;
        if (!isDry || !isGentleHeight) continue;
        const isGentleSlope = [
          [SLOPE_PROBE_DISTANCE, 0],
          [-SLOPE_PROBE_DISTANCE, 0],
          [0, SLOPE_PROBE_DISTANCE],
          [0, -SLOPE_PROBE_DISTANCE],
        ].every(([probeX, probeZ]) => Math.abs(groundTopGameY(x + probeX!, z + probeZ!) - groundY) <= MAX_SLOPE_PROBE_DIFFERENCE);
        if (isGentleSlope) return { x, y: groundY + SPAWN_CLEARANCE, z };
      }
    }
  }
  return { x: 0, y: SEA_LEVEL + 40, z: 0 };
}
