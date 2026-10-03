// Rare stratovolcano cones with a summit crater. A cone is added on top of
// whatever terrain (or seabed) lies beneath it, so volcanoes also form
// islands when they rise from the ocean floor.

import { hashToUnit, lerp, smoothstep } from "../math";
import { createFractalNoise } from "../noise-fields";

export interface VolcanoResult {
  heightLift: number;
  coneWeight: number;
  craterWeight: number;
}

const NO_VOLCANO: VolcanoResult = { heightLift: 0, coneWeight: 0, craterWeight: 0 };
const CELL_SIZE = 1700;
const VOLCANO_PROBABILITY = 0.12;
const CRATER_RADIUS_RATIO = 0.11;
const CRATER_DEPTH = 36;

export function createVolcanoField(seed: number): (x: number, z: number) => VolcanoResult {
  const flankGullyNoise = createFractalNoise({ seed, salt: 41, frequency: 1 / 38, octaves: 2 });
  const flankShapeNoise = createFractalNoise({ seed, salt: 42, frequency: 1 / 400, octaves: 2 });

  return (x, z) => {
    const cellX = Math.floor(x / CELL_SIZE);
    const cellZ = Math.floor(z / CELL_SIZE);
    if (hashToUnit(cellX, cellZ, seed + 401) > VOLCANO_PROBABILITY) return NO_VOLCANO;

    const centerX = (cellX + 0.3 + 0.4 * hashToUnit(cellX, cellZ, seed + 402)) * CELL_SIZE;
    const centerZ = (cellZ + 0.3 + 0.4 * hashToUnit(cellX, cellZ, seed + 403)) * CELL_SIZE;
    const baseRadius = lerp(190, 300, hashToUnit(cellX, cellZ, seed + 404));
    const peakLift = lerp(95, 150, hashToUnit(cellX, cellZ, seed + 405));

    const offsetX = x - centerX;
    const offsetZ = z - centerZ;
    const radiusScale = 1 + flankShapeNoise(x, z) * 0.5;
    const distanceRatio = Math.hypot(offsetX, offsetZ) / (baseRadius * radiusScale);
    if (distanceRatio >= 1) return NO_VOLCANO;

    const coneProfile = (ratio: number) => Math.pow(1 - ratio, 1.55);
    const gullies = flankGullyNoise(x, z) * 6 * smoothstep(0.05, 0.4, distanceRatio);
    let heightLift = peakLift * coneProfile(Math.max(distanceRatio, CRATER_RADIUS_RATIO)) + gullies;

    let craterWeight = 0;
    if (distanceRatio < CRATER_RADIUS_RATIO) {
      const craterPosition = distanceRatio / CRATER_RADIUS_RATIO;
      craterWeight = 1 - craterPosition * craterPosition;
      heightLift -= CRATER_DEPTH * craterWeight;
    }

    return { heightLift, coneWeight: smoothstep(0.9, 0.0, distanceRatio), craterWeight };
  };
}
