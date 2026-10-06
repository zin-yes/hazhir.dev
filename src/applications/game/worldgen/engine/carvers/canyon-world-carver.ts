// Port of CanyonWorldCarver (Minecraft 1.20.6): one long ravine whose width varies per y layer.

import type { LegacyRandomSource } from "../random";
import type { CanyonCarverConfig } from "./carver-config";
import type { CarvingContext } from "./carving-context";
import { forkLegacyRandomFromNextLong } from "./cave-world-carver";
import { FLOAT_PI, FLOAT_TWO_PI, mthCos, mthSin } from "./float-math";
import { canReach, CARVER_RANGE_IN_CHUNKS, carveEllipsoid, type CarveSkipChecker } from "./world-carver";

const fround = Math.fround;

/** CanyonWorldCarver.carve for one start chunk; the chunk being carved is in `context`. */
export function carveCanyon(context: CarvingContext, config: CanyonCarverConfig, random: LegacyRandomSource, sourceChunkX: number, sourceChunkZ: number): boolean {
  const maxLength = (CARVER_RANGE_IN_CHUNKS * 2 - 1) * 16;
  const x = sourceChunkX * 16 + random.nextIntBounded(16);
  const y = config.y.sample(random, context);
  const z = sourceChunkZ * 16 + random.nextIntBounded(16);
  const yaw = fround(random.nextFloat() * FLOAT_TWO_PI);
  const pitch = config.verticalRotation.sample(random);
  const yScale = config.yScale.sample(random);
  const thickness = config.shape.thickness.sample(random);
  const length = Math.trunc(fround(maxLength * config.shape.distanceFactor.sample(random)));
  context.canyonsStarted++;
  doCarve(context, config, forkLegacyRandomFromNextLong(random), x, y, z, thickness, yaw, pitch, 0, length, yScale);
  return true;
}

function initWidthFactors(context: CarvingContext, config: CanyonCarverConfig, random: LegacyRandomSource): Float32Array {
  const factors = new Float32Array(context.genDepth);
  let width = 1;
  for (let layer = 0; layer < context.genDepth; layer++) {
    if (layer === 0 || random.nextIntBounded(config.shape.widthSmoothness) === 0) {
      width = fround(1 + fround(random.nextFloat() * random.nextFloat()));
    }
    factors[layer] = fround(width * width);
  }
  return factors;
}

function updateVerticalRadius(config: CanyonCarverConfig, random: LegacyRandomSource, radius: number, length: number, step: number): number {
  const centerWeight = fround(1 - fround(Math.abs(fround(0.5 - fround(step / length))) * 2));
  const factor = fround(config.shape.verticalRadiusDefaultFactor + fround(config.shape.verticalRadiusCenterFactor * centerWeight));
  const jitter = fround(fround(random.nextFloat() * fround(fround(1) - fround(0.75))) + fround(0.75));
  return factor * radius * jitter;
}

function doCarve(
  context: CarvingContext,
  config: CanyonCarverConfig,
  random: LegacyRandomSource,
  startX: number,
  startY: number,
  startZ: number,
  thickness: number,
  startYaw: number,
  startPitch: number,
  startStep: number,
  length: number,
  yScale: number,
): void {
  const widthFactors = initWidthFactors(context, config, random);
  const shouldSkip: CarveSkipChecker = (relativeX, relativeY, relativeZ, blockY) => {
    const layer = blockY - context.minGenY;
    return (relativeX * relativeX + relativeZ * relativeZ) * widthFactors[layer - 1]! + (relativeY * relativeY) / 6 >= 1;
  };
  let x = startX;
  let y = startY;
  let z = startZ;
  let yaw = startYaw;
  let pitch = startPitch;
  let yawChange = 0;
  let pitchChange = 0;
  for (let step = startStep; step < length; step++) {
    context.canyonSteps++;
    let horizontalRadius = 1.5 + fround(mthSin(fround(fround(fround(step) * FLOAT_PI) / length)) * thickness);
    let verticalRadius = horizontalRadius * yScale;
    horizontalRadius *= config.shape.horizontalRadiusFactor.sample(random);
    verticalRadius = updateVerticalRadius(config, random, verticalRadius, length, step);
    const cosinePitch = mthCos(pitch);
    const sinePitch = mthSin(pitch);
    x += fround(mthCos(yaw) * cosinePitch);
    y += sinePitch;
    z += fround(mthSin(yaw) * cosinePitch);
    pitch = fround(pitch * fround(0.7));
    pitch = fround(pitch + fround(pitchChange * fround(0.05)));
    yaw = fround(yaw + fround(yawChange * fround(0.05)));
    pitchChange = fround(pitchChange * fround(0.8));
    yawChange = fround(yawChange * fround(0.5));
    pitchChange = fround(pitchChange + fround(fround(fround(random.nextFloat() - random.nextFloat()) * random.nextFloat()) * 2));
    yawChange = fround(yawChange + fround(fround(fround(random.nextFloat() - random.nextFloat()) * random.nextFloat()) * 4));
    if (random.nextIntBounded(4) === 0) {
      context.tunnelStepsStaggered++;
      continue;
    }
    if (!canReach(context.chunkMinBlockX, context.chunkMinBlockZ, x, z, step, length, thickness)) {
      context.tunnelsEndedOutOfReach++;
      return;
    }
    carveEllipsoid(context, config, x, y, z, horizontalRadius, verticalRadius, shouldSkip);
  }
}
