// Mirrors IcebergFeature (minecraft:iceberg): a round or elliptical iceberg of the configured block (packed ice or
// blue ice) at sea level, optionally topped with snow blocks, smoothed and cut out by a carved channel.
// All float intermediates are rounded like the Java float math; distances are doubles.

import type { RandomSource } from "../../../random";
import { defineFeatureType } from "../../feature/feature-type";
import type { WorldGenLevel } from "../../level/world-gen-level";
import { asObject } from "../../providers/json-fields";
import { AIR_STATE, BLUE_ICE_BLOCK, ICE_BLOCK, isBlock, PACKED_ICE_BLOCK, SNOW_BLOCK, SNOW_LAYER_BLOCK, WATER_BLOCK } from "./block-names";
import { ceilFloat, clampFloat, divideInt, roundFloat } from "./java-float-math";

export interface IcebergConfig {
  readonly state: string;
}

const MINIMUM_CIRCLE_JITTER = roundFloat(0.2);
const MAXIMUM_CIRCLE_JITTER = roundFloat(0.8);
const QUARTER_TURN = 1.5707963267948966;

interface IcebergShape {
  readonly origin: { readonly x: number; readonly y: number; readonly z: number };
  readonly state: string;
  readonly angle: number;
  readonly isEllipse: boolean;
  readonly snowOnTop: boolean;
  readonly snowHeightParameter: number;
  readonly ellipseRadius: number;
}

function isIcebergState(state: string): boolean {
  return isBlock(state, PACKED_ICE_BLOCK) || isBlock(state, SNOW_BLOCK) || isBlock(state, BLUE_ICE_BLOCK);
}

function signedDistanceCircle(deltaX: number, deltaZ: number, radius: number, random: RandomSource): number {
  const jitter = roundFloat(roundFloat(10 * clampFloat(random.nextFloat(), MINIMUM_CIRCLE_JITTER, MAXIMUM_CIRCLE_JITTER)) / radius);
  return jitter + deltaX * deltaX + deltaZ * deltaZ - radius * radius;
}

function signedDistanceEllipse(deltaX: number, deltaZ: number, centerX: number, centerZ: number, radiusA: number, radiusC: number, angle: number): number {
  const offsetX = deltaX - centerX;
  const offsetZ = deltaZ - centerZ;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const rotatedA = (offsetX * cosine - offsetZ * sine) / radiusA;
  const rotatedC = (offsetX * sine + offsetZ * cosine) / radiusC;
  return rotatedA * rotatedA + rotatedC * rotatedC - 1;
}

function heightDependentRadiusRound(random: RandomSource, layer: number, height: number, width: number): number {
  const steepness = roundFloat(3.5 - random.nextFloat());
  let radius = roundFloat(roundFloat(1 - roundFloat(roundFloat(layer * layer) / roundFloat(height * steepness))) * width);
  if (height > 15 + random.nextIntBounded(5)) {
    const effectiveLayer = layer < 3 + random.nextIntBounded(6) ? divideInt(layer, 2) : layer;
    radius = roundFloat(roundFloat(1 - roundFloat(effectiveLayer / roundFloat(roundFloat(height * steepness) * roundFloat(0.4)))) * width);
  }
  return ceilFloat(roundFloat(radius / 2));
}

function heightDependentRadiusEllipse(layer: number, height: number, width: number): number {
  const radius = roundFloat(roundFloat(1 - roundFloat(roundFloat(layer * layer) / roundFloat(height * 1))) * width);
  return ceilFloat(roundFloat(radius / 2));
}

function heightDependentRadiusSteep(random: RandomSource, depth: number, height: number, width: number): number {
  const steepness = roundFloat(1 + roundFloat(random.nextFloat() / 2));
  const radius = roundFloat(roundFloat(1 - roundFloat(depth / roundFloat(height * steepness))) * width);
  return ceilFloat(roundFloat(radius / 2));
}

function ellipseRadiusC(layer: number, height: number, snowHeightParameter: number): number {
  let radius = snowHeightParameter;
  if (layer > 0 && height - layer <= 3) radius -= 4 - (height - layer);
  return radius;
}

function setIcebergBlock(
  level: WorldGenLevel,
  random: RandomSource,
  x: number,
  y: number,
  z: number,
  heightFromTop: number,
  height: number,
  isEllipse: boolean,
  snowOnTop: boolean,
  state: string,
): void {
  const current = level.getBlockState(x, y, z);
  if (!(level.blockStates.info(current).isAir || isBlock(current, SNOW_BLOCK) || isBlock(current, ICE_BLOCK) || isBlock(current, WATER_BLOCK))) return;
  const keepsSnow = !isEllipse || random.nextDouble() > 0.05;
  const divisor = isEllipse ? 3 : 2;
  if (snowOnTop && !isBlock(current, WATER_BLOCK) && heightFromTop <= random.nextIntBounded(Math.max(1, divideInt(height, divisor))) + height * 0.6 && keepsSnow) {
    level.setBlock(x, y, z, SNOW_BLOCK, 3);
  } else {
    level.setBlock(x, y, z, state, 3);
  }
}

function generateIcebergBlock(
  level: WorldGenLevel,
  random: RandomSource,
  shape: IcebergShape,
  height: number,
  deltaX: number,
  deltaY: number,
  deltaZ: number,
  radius: number,
  ellipseRadiusA: number,
): void {
  const distance = shape.isEllipse
    ? signedDistanceEllipse(deltaX, deltaZ, 0, 0, ellipseRadiusA, ellipseRadiusC(deltaY, height, shape.snowHeightParameter), shape.angle)
    : signedDistanceCircle(deltaX, deltaZ, radius, random);
  if (!(distance < 0)) return;
  const skipThreshold = shape.isEllipse ? -0.5 : -6 - random.nextIntBounded(3);
  if (distance > skipThreshold && random.nextDouble() > 0.9) return;
  setIcebergBlock(level, random, shape.origin.x + deltaX, shape.origin.y + deltaY, shape.origin.z + deltaZ, height - deltaY, height, shape.isEllipse, shape.snowOnTop, shape.state);
}

function removeFloatingSnowLayer(level: WorldGenLevel, x: number, y: number, z: number): void {
  if (isBlock(level.getBlockState(x, y + 1, z), SNOW_LAYER_BLOCK)) level.setBlock(x, y + 1, z, AIR_STATE, 3);
}

function carve(
  level: WorldGenLevel,
  shape: IcebergShape,
  radius: number,
  layerY: number,
  isWaterCarve: boolean,
  angle: number,
  centerX: number,
  centerZ: number,
): void {
  const reach = radius + 1 + divideInt(shape.ellipseRadius, 3);
  const radiusC = Math.min(radius - 3, 3) + divideInt(shape.snowHeightParameter, 2) - 1;
  for (let deltaX = -reach; deltaX < reach; deltaX++) {
    for (let deltaZ = -reach; deltaZ < reach; deltaZ++) {
      const distance = signedDistanceEllipse(deltaX, deltaZ, centerX, centerZ, reach, radiusC, angle);
      if (!(distance < 0)) continue;
      const x = shape.origin.x + deltaX;
      const y = shape.origin.y + layerY;
      const z = shape.origin.z + deltaZ;
      const current = level.getBlockState(x, y, z);
      if (!(isIcebergState(current) || isBlock(current, SNOW_BLOCK))) continue;
      if (isWaterCarve) {
        level.setBlock(x, y, z, WATER_BLOCK, 3);
      } else {
        level.setBlock(x, y, z, AIR_STATE, 3);
        removeFloatingSnowLayer(level, x, y, z);
      }
    }
  }
}

function generateCutOut(level: WorldGenLevel, random: RandomSource, shape: IcebergShape, width: number, height: number): void {
  const signX = random.nextBoolean() ? -1 : 1;
  const signZ = random.nextBoolean() ? -1 : 1;
  const halfWidth = divideInt(width, 2);
  let centerOffsetX = random.nextIntBounded(Math.max(halfWidth - 2, 1));
  if (random.nextBoolean()) centerOffsetX = halfWidth + 1 - random.nextIntBounded(Math.max(width - halfWidth - 1, 1));
  let centerOffsetZ = random.nextIntBounded(Math.max(halfWidth - 2, 1));
  if (random.nextBoolean()) centerOffsetZ = halfWidth + 1 - random.nextIntBounded(Math.max(width - halfWidth - 1, 1));
  if (shape.isEllipse) {
    centerOffsetX = random.nextIntBounded(Math.max(shape.ellipseRadius - 5, 1));
    centerOffsetZ = centerOffsetX;
  }
  const centerX = signX * centerOffsetX;
  const centerZ = signZ * centerOffsetZ;
  const angle = shape.isEllipse ? shape.angle + QUARTER_TURN : random.nextDouble() * 2 * Math.PI;
  for (let layer = 0; layer < height - 3; layer++) {
    const radius = heightDependentRadiusRound(random, layer, height, width);
    carve(level, shape, radius, layer, false, angle, centerX, centerZ);
  }
  for (let layer = -1; layer > -height + random.nextIntBounded(5); layer--) {
    const radius = heightDependentRadiusSteep(random, -layer, height, width);
    carve(level, shape, radius, layer, true, angle, centerX, centerZ);
  }
}

function smooth(level: WorldGenLevel, shape: IcebergShape, width: number, height: number): void {
  const reach = shape.isEllipse ? shape.ellipseRadius : divideInt(width, 2);
  const { x: originX, y: originY, z: originZ } = shape.origin;
  for (let deltaX = -reach; deltaX <= reach; deltaX++) {
    for (let deltaZ = -reach; deltaZ <= reach; deltaZ++) {
      for (let deltaY = 0; deltaY <= height; deltaY++) {
        const x = originX + deltaX;
        const y = originY + deltaY;
        const z = originZ + deltaZ;
        const state = level.getBlockState(x, y, z);
        if (!isIcebergState(state) && !isBlock(state, SNOW_LAYER_BLOCK)) continue;
        if (level.blockStates.info(level.getBlockState(x, y - 1, z)).isAir) {
          level.setBlock(x, y, z, AIR_STATE, 3);
          level.setBlock(x, y + 1, z, AIR_STATE, 3);
          continue;
        }
        if (!isIcebergState(state)) continue;
        let nonIcebergNeighbors = 0;
        for (const [neighborX, neighborZ] of [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]] as const) {
          if (!isIcebergState(level.getBlockState(neighborX, y, neighborZ))) nonIcebergNeighbors++;
        }
        if (nonIcebergNeighbors >= 3) level.setBlock(x, y, z, AIR_STATE, 3);
      }
    }
  }
}

export const icebergFeature = defineFeatureType<IcebergConfig>({
  id: "minecraft:iceberg",
  parseConfig(json, parser) {
    const config = asObject(json, "iceberg config");
    return { state: parser.blockState(config.state, "iceberg.state") };
  },
  place({ level, generator, random, origin, config }) {
    const snowOnTop = random.nextDouble() > 0.7;
    const angle = random.nextDouble() * 2 * Math.PI;
    const ellipseRadius = 11 - random.nextIntBounded(5);
    const snowHeightParameter = 3 + random.nextIntBounded(3);
    const isEllipse = random.nextDouble() > 0.7;
    let height = isEllipse ? random.nextIntBounded(6) + 6 : random.nextIntBounded(15) + 3;
    if (!isEllipse && random.nextDouble() > 0.9) height += random.nextIntBounded(19) + 7;
    const depth = Math.min(height + random.nextIntBounded(11), 18);
    const width = Math.min(height + random.nextIntBounded(7) - random.nextIntBounded(5), 11);
    const extent = isEllipse ? ellipseRadius : 11;
    const shape: IcebergShape = {
      origin: { x: origin.x, y: generator.seaLevel, z: origin.z },
      state: config.state,
      angle,
      isEllipse,
      snowOnTop,
      snowHeightParameter,
      ellipseRadius,
    };

    for (let deltaX = -extent; deltaX < extent; deltaX++) {
      for (let deltaZ = -extent; deltaZ < extent; deltaZ++) {
        for (let layer = 0; layer < height; layer++) {
          const radius = isEllipse ? heightDependentRadiusEllipse(layer, height, width) : heightDependentRadiusRound(random, layer, height, width);
          if (!isEllipse && deltaX >= radius) continue;
          generateIcebergBlock(level, random, shape, height, deltaX, layer, deltaZ, radius, extent);
        }
      }
    }
    smooth(level, shape, width, height);
    for (let deltaX = -extent; deltaX < extent; deltaX++) {
      for (let deltaZ = -extent; deltaZ < extent; deltaZ++) {
        for (let layer = -1; layer > -depth; layer--) {
          const ellipseRadiusA = isEllipse ? ceilFloat(roundFloat(extent * roundFloat(1 - roundFloat(roundFloat(layer * layer) / roundFloat(depth * 8))))) : extent;
          const radius = heightDependentRadiusSteep(random, -layer, depth, width);
          if (deltaX >= radius) continue;
          generateIcebergBlock(level, random, shape, depth, deltaX, layer, deltaZ, radius, ellipseRadiusA);
        }
      }
    }
    const shouldCutOut = isEllipse ? random.nextDouble() > 0.1 : random.nextDouble() > 0.7;
    if (shouldCutOut) generateCutOut(level, random, shape, width, height);
    return true;
  },
});
