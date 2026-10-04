// Port of CaveWorldCarver (Minecraft 1.20.6): rooms and winding tunnels, with Java float arithmetic.

import { LegacyRandomSource, type RandomSource } from "../random";
import type { CaveCarverConfig } from "./carver-config";
import type { CarvingContext } from "./carving-context";
import { FLOAT_HALF_PI, FLOAT_PI, FLOAT_TWO_PI, mthCos, mthSin } from "./float-math";
import { canReach, CARVER_RANGE_IN_CHUNKS, carveEllipsoid, type CarveSkipChecker } from "./world-carver";

const fround = Math.fround;
const CAVE_BOUND = 15;
const Y_SCALE = 1;
const SKIP_STAGGER_CHANCE = 4;
const THICK_TUNNEL_CHANCE = 10;
const STEEP_TUNNEL_CHANCE = 6;

/** RandomSource.create(random.nextLong()) without a BigInt. */
export function forkLegacyRandomFromNextLong(random: LegacyRandomSource): LegacyRandomSource {
  const halves = { high: 0, low: 0 };
  random.nextLongInto(halves);
  return new LegacyRandomSource(halves.high, halves.low);
}

function shouldSkipCaveBlock(relativeX: number, relativeY: number, relativeZ: number, floorLevel: number): boolean {
  if (relativeY <= floorLevel) return true;
  return relativeX * relativeX + relativeY * relativeY + relativeZ * relativeZ >= 1;
}

function getThickness(random: RandomSource): number {
  let thickness = fround(fround(random.nextFloat() * 2) + random.nextFloat());
  if (random.nextIntBounded(THICK_TUNNEL_CHANCE) === 0) {
    const first = random.nextFloat();
    const second = random.nextFloat();
    thickness = fround(thickness * fround(fround(fround(first * second) * 3) + 1));
  }
  return thickness;
}

/** CaveWorldCarver.carve for one start chunk; the chunk being carved is in `context`. */
export function carveCaves(context: CarvingContext, config: CaveCarverConfig, random: LegacyRandomSource, sourceChunkX: number, sourceChunkZ: number): boolean {
  const maxDistance = (CARVER_RANGE_IN_CHUNKS * 2 - 1) << 4;
  const caveCount = random.nextIntBounded(random.nextIntBounded(random.nextIntBounded(CAVE_BOUND) + 1) + 1);
  const sourceMinBlockX = sourceChunkX * 16;
  const sourceMinBlockZ = sourceChunkZ * 16;
  for (let caveIndex = 0; caveIndex < caveCount; caveIndex++) {
    const x = sourceMinBlockX + random.nextIntBounded(16);
    const y = config.y.sample(random, context);
    const z = sourceMinBlockZ + random.nextIntBounded(16);
    const horizontalMultiplier = config.horizontalRadiusMultiplier.sample(random);
    const verticalMultiplier = config.verticalRadiusMultiplier.sample(random);
    const floorLevel = config.floorLevel.sample(random);
    const shouldSkip: CarveSkipChecker = (relativeX, relativeY, relativeZ) => shouldSkipCaveBlock(relativeX, relativeY, relativeZ, floorLevel);
    let tunnelCount = 1;
    if (random.nextIntBounded(4) === 0) {
      const yScale = config.yScale.sample(random);
      const roomThickness = fround(1 + fround(random.nextFloat() * 6));
      createRoom(context, config, x, y, z, roomThickness, yScale, shouldSkip);
      tunnelCount += random.nextIntBounded(4);
    }
    for (let tunnelIndex = 0; tunnelIndex < tunnelCount; tunnelIndex++) {
      const yaw = fround(random.nextFloat() * FLOAT_TWO_PI);
      const pitch = fround(fround(random.nextFloat() - 0.5) / 4);
      const thickness = getThickness(random);
      const maxSteps = maxDistance - random.nextIntBounded(Math.trunc(maxDistance / 4));
      createTunnel(
        context, config, forkLegacyRandomFromNextLong(random), x, y, z, horizontalMultiplier, verticalMultiplier,
        thickness, yaw, pitch, 0, maxSteps, Y_SCALE, shouldSkip,
      );
    }
  }
  return true;
}

function createRoom(
  context: CarvingContext,
  config: CaveCarverConfig,
  x: number,
  y: number,
  z: number,
  roomThickness: number,
  yScale: number,
  shouldSkip: CarveSkipChecker,
): void {
  const horizontalRadius = 1.5 + fround(mthSin(FLOAT_HALF_PI) * roomThickness);
  const verticalRadius = horizontalRadius * yScale;
  carveEllipsoid(context, config, x + 1, y, z, horizontalRadius, verticalRadius, shouldSkip);
}

function createTunnel(
  context: CarvingContext,
  config: CaveCarverConfig,
  tunnelRandom: LegacyRandomSource,
  startX: number,
  startY: number,
  startZ: number,
  horizontalMultiplier: number,
  verticalMultiplier: number,
  thickness: number,
  startYaw: number,
  startPitch: number,
  startStep: number,
  maxSteps: number,
  yScale: number,
  shouldSkip: CarveSkipChecker,
): void {
  let x = startX;
  let y = startY;
  let z = startZ;
  let yaw = startYaw;
  let pitch = startPitch;
  const branchStep = tunnelRandom.nextIntBounded(Math.trunc(maxSteps / 2)) + Math.trunc(maxSteps / 4);
  const steepTunnel = tunnelRandom.nextIntBounded(STEEP_TUNNEL_CHANCE) === 0;
  let yawChange = 0;
  let pitchChange = 0;
  for (let step = startStep; step < maxSteps; step++) {
    const horizontalRadius = 1.5 + fround(mthSin(fround(fround(FLOAT_PI * step) / maxSteps)) * thickness);
    const verticalRadius = horizontalRadius * yScale;
    const cosinePitch = mthCos(pitch);
    x += fround(mthCos(yaw) * cosinePitch);
    y += mthSin(pitch);
    z += fround(mthSin(yaw) * cosinePitch);
    pitch = fround(pitch * (steepTunnel ? fround(0.92) : fround(0.7)));
    pitch = fround(pitch + fround(pitchChange * fround(0.1)));
    yaw = fround(yaw + fround(yawChange * fround(0.1)));
    pitchChange = fround(pitchChange * fround(0.9));
    yawChange = fround(yawChange * fround(0.75));
    pitchChange = fround(pitchChange + fround(fround(fround(tunnelRandom.nextFloat() - tunnelRandom.nextFloat()) * tunnelRandom.nextFloat()) * 2));
    yawChange = fround(yawChange + fround(fround(fround(tunnelRandom.nextFloat() - tunnelRandom.nextFloat()) * tunnelRandom.nextFloat()) * 4));
    if (step === branchStep && thickness > 1) {
      const leftSeed = forkLegacyRandomFromNextLong(tunnelRandom);
      const leftThickness = fround(fround(tunnelRandom.nextFloat() * fround(0.5)) + fround(0.5));
      createTunnel(
        context, config, leftSeed, x, y, z, horizontalMultiplier, verticalMultiplier,
        leftThickness, fround(yaw - FLOAT_HALF_PI), fround(pitch / 3), step, maxSteps, 1, shouldSkip,
      );
      const rightSeed = forkLegacyRandomFromNextLong(tunnelRandom);
      const rightThickness = fround(fround(tunnelRandom.nextFloat() * fround(0.5)) + fround(0.5));
      createTunnel(
        context, config, rightSeed, x, y, z, horizontalMultiplier, verticalMultiplier,
        rightThickness, fround(yaw + FLOAT_HALF_PI), fround(pitch / 3), step, maxSteps, 1, shouldSkip,
      );
      return;
    }
    if (tunnelRandom.nextIntBounded(SKIP_STAGGER_CHANCE) === 0) continue;
    if (!canReach(context.chunkMinBlockX, context.chunkMinBlockZ, x, z, step, maxSteps, thickness)) return;
    carveEllipsoid(context, config, x, y, z, horizontalRadius * horizontalMultiplier, verticalRadius * verticalMultiplier, shouldSkip);
  }
}
