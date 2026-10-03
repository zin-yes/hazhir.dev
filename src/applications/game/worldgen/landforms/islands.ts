// Ocean islands: coral atolls and sandy cays in warm water, wooded temperate
// islets, and bare rocky skerries in polar water. Each island belongs to one
// jittered grid cell and only exists over deep ocean.

import { SEA_LEVEL } from "../constants";
import { hashToUnit, lerp, smoothstep } from "../math";
import { createFractalNoise } from "../noise-fields";
import type { IslandKind } from "../terrain-types";

export interface IslandResult {
  height: number;
  kind: IslandKind;
}

const CELL_SIZE = 520;
const ISLAND_PROBABILITY = 0.5;

export function createIslandField(seed: number) {
  const shapeNoise = createFractalNoise({ seed, salt: 51, frequency: 1 / 34, octaves: 3 });
  const hillNoise = createFractalNoise({ seed, salt: 52, frequency: 1 / 20, octaves: 2 });

  return (x: number, z: number, oceanFloorHeight: number, continentalness: number, temperature: number): IslandResult => {
    const unchanged: IslandResult = { height: oceanFloorHeight, kind: "none" };
    if (continentalness > -0.28) return unchanged;

    const cellX = Math.floor(x / CELL_SIZE);
    const cellZ = Math.floor(z / CELL_SIZE);
    if (hashToUnit(cellX, cellZ, seed + 501) > ISLAND_PROBABILITY) return unchanged;

    const centerX = (cellX + 0.3 + 0.4 * hashToUnit(cellX, cellZ, seed + 502)) * CELL_SIZE;
    const centerZ = (cellZ + 0.3 + 0.4 * hashToUnit(cellX, cellZ, seed + 503)) * CELL_SIZE;
    const radius = lerp(32, 92, hashToUnit(cellX, cellZ, seed + 504));
    const kindRoll = hashToUnit(cellX, cellZ, seed + 505);

    const distance = Math.hypot(x - centerX, z - centerZ) / (radius * (1 + shapeNoise(x, z) * 0.55));
    if (distance > 1.35) return unchanged;

    if (temperature > 0.25) {
      return kindRoll < 0.5
        ? shapeAtoll(oceanFloorHeight, distance)
        : shapeCay(oceanFloorHeight, distance, hillNoise(x, z));
    }
    const isPolar = temperature < -0.4;
    const peakHeight = lerp(7, 22, hashToUnit(cellX, cellZ, seed + 506));
    const profile = Math.pow(Math.max(0, 1 - distance), 0.8);
    const islandHeight = SEA_LEVEL - 4 + (peakHeight + 4) * profile + hillNoise(x, z) * 3 * profile;
    return islandHeight > oceanFloorHeight
      ? { height: islandHeight, kind: isPolar ? "polar" : "temperate" }
      : unchanged;
  };
}

function shapeCay(oceanFloorHeight: number, distance: number, detail: number): IslandResult {
  const profile = Math.pow(Math.max(0, 1 - distance), 0.9);
  const cayHeight = SEA_LEVEL - 3 + 7 * profile + detail * 1.2 * profile;
  return cayHeight > oceanFloorHeight ? { height: cayHeight, kind: "cay" } : { height: oceanFloorHeight, kind: "none" };
}

function shapeAtoll(oceanFloorHeight: number, distance: number): IslandResult {
  const ringOffset = (distance - 0.85) / 0.11;
  const ringHeight = SEA_LEVEL + 1.8 - ringOffset * ringOffset * 6;
  const lagoonFloor = SEA_LEVEL - 5 + smoothstep(0.55, 0.78, distance) * 4.4;
  const reefHeight = distance < 0.78 ? lagoonFloor : ringHeight;
  return reefHeight > oceanFloorHeight
    ? { height: reefHeight, kind: "atoll" }
    : { height: oceanFloorHeight, kind: "none" };
}
