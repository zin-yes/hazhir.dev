// Badlands buttes with terraced strata, and canyons cut into arid plateaus
// with stepped walls like the layered rock of the Colorado Plateau.

import { SEA_LEVEL } from "../constants";
import { lerp, smoothstep } from "../math";
import { createFractalNoise } from "../noise-fields";
import type { ClimateSample } from "../climate";

export interface AridLandformResult {
  height: number;
  mesaWeight: number;
  canyonWeight: number;
}

const MESA_STRATUM_HEIGHT = 6;
const CANYON_TERRACE_COUNT = 7;
const CANYON_MAX_DEPTH = 62;
const CANYON_FLOOR_OFFSET = 3;
const PLATEAU_LIFT = 26;

export function computeAridity(climate: ClimateSample): number {
  return smoothstep(0.05, 0.45, climate.temperature) * smoothstep(0.0, -0.4, climate.humidity);
}

function terraceFraction(position: number, stepCount: number): number {
  const scaled = position * stepCount;
  const stepIndex = Math.floor(scaled);
  const withinStep = scaled - stepIndex;
  return (stepIndex + smoothstep(0.55, 1, withinStep)) / stepCount;
}

export function createAridLandforms(seed: number) {
  const butteNoise = createFractalNoise({ seed, salt: 31, frequency: 1 / 130, octaves: 3 });
  const canyonLine = createFractalNoise({ seed, salt: 32, frequency: 1 / 520, octaves: 3 });
  const canyonWarpX = createFractalNoise({ seed, salt: 33, frequency: 1 / 200, octaves: 2 });
  const canyonWarpZ = createFractalNoise({ seed, salt: 34, frequency: 1 / 200, octaves: 2 });
  const canyonDepthVariation = createFractalNoise({ seed, salt: 35, frequency: 1 / 300, octaves: 2 });

  return (x: number, z: number, climate: ClimateSample, height: number): AridLandformResult => {
    const aridity = computeAridity(climate);
    const plateau =
      smoothstep(0.1, 0.4, climate.continentalness) * smoothstep(-0.3, 0.2, climate.erosion);
    const aridPlateau = aridity * plateau;
    if (aridPlateau < 0.02) return { height, mesaWeight: 0, canyonWeight: 0 };

    const badlandsRegion = smoothstep(0.1, 0.45, climate.weirdness);
    const mesaWeight = aridPlateau * badlandsRegion;
    const canyonRegion = aridPlateau * (1 - badlandsRegion * 0.7);

    let shapedHeight = height + canyonRegion * PLATEAU_LIFT;

    if (mesaWeight > 0.02) {
      const butteLift = smoothstep(0.02, 0.2, butteNoise(x, z)) * 38 * mesaWeight;
      const liftedHeight = shapedHeight + butteLift;
      const strataPosition = (liftedHeight - SEA_LEVEL) / MESA_STRATUM_HEIGHT;
      const strataIndex = Math.floor(strataPosition);
      const terracedHeight =
        SEA_LEVEL +
        (strataIndex + smoothstep(0.55, 1, strataPosition - strataIndex)) * MESA_STRATUM_HEIGHT;
      shapedHeight = lerp(liftedHeight, terracedHeight, mesaWeight * 0.95);
    }

    let canyonWeight = 0;
    if (canyonRegion > 0.05) {
      const warpedX = x + canyonWarpX(x, z) * 90;
      const warpedZ = z + canyonWarpZ(x, z) * 90;
      const lineDistance = Math.abs(canyonLine(warpedX, warpedZ));
      const wallPosition = 1 - smoothstep(0.09, 0.17, lineDistance);
      canyonWeight = wallPosition * canyonRegion;
      if (canyonWeight > 0.01) {
        const depthVariation = 0.7 + 0.3 * (canyonDepthVariation(x, z) + 0.5);
        const floorHeight = SEA_LEVEL + CANYON_FLOOR_OFFSET;
        const availableDepth = Math.max(0, shapedHeight - floorHeight);
        const depth = Math.min(CANYON_MAX_DEPTH * depthVariation, availableDepth);
        const stepped = terraceFraction(wallPosition, CANYON_TERRACE_COUNT);
        shapedHeight -= depth * stepped * smoothstep(0.05, 0.4, canyonRegion);
      }
    }

    return { height: shapedHeight, mesaWeight, canyonWeight };
  };
}
