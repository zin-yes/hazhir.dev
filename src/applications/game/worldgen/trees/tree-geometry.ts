/**
 * Shared voxel shape helpers for the tree builders: leaf blobs, discs, droops, ground patches,
 * logs and Bresenham branches. Rough edges only ever remove cells, so the radii passed in are
 * hard horizontal and vertical bounds of what a shape writes.
 */
import { BlockType } from "@/applications/game/blocks";
import type { TreeBlockWriter, TreeBuildOptions } from "./tree-types";

export interface LeafPaint {
  naturalLeaf: BlockType;
  accentLeaf: BlockType;
  accentShare: number;
  patchSalt: number;
}

const ACCENT_SHARE_WITH_VARIANT = 0.8;

export function createLeafPaint(naturalLeaf: BlockType, options: TreeBuildOptions): LeafPaint {
  if (options.leafVariant === undefined || options.leafVariant === naturalLeaf) {
    return { naturalLeaf, accentLeaf: naturalLeaf, accentShare: 0, patchSalt: 0 };
  }
  return {
    naturalLeaf,
    accentLeaf: options.leafVariant,
    accentShare: ACCENT_SHARE_WITH_VARIANT,
    patchSalt: Math.floor(options.random() * 1_000_000),
  };
}

export function createSolidLeafPaint(leafBlock: BlockType): LeafPaint {
  return { naturalLeaf: leafBlock, accentLeaf: leafBlock, accentShare: 0, patchSalt: 0 };
}

function hashToUnitInterval(patchX: number, patchY: number, patchZ: number, salt: number): number {
  let hashed = Math.imul(patchX, 73856093) ^ Math.imul(patchY, 19349663) ^ Math.imul(patchZ, 83492791) ^ salt;
  hashed = Math.imul(hashed ^ (hashed >>> 13), 1274126177);
  return ((hashed ^ (hashed >>> 16)) >>> 0) / 4294967296;
}

export function selectLeafBlock(paint: LeafPaint, dx: number, dy: number, dz: number): BlockType {
  if (paint.accentShare === 0) return paint.naturalLeaf;
  const patchValue = hashToUnitInterval(dx >> 1, dy >> 1, dz >> 1, paint.patchSalt);
  return patchValue < paint.accentShare ? paint.accentLeaf : paint.naturalLeaf;
}

export function placeLeafAt(writer: TreeBlockWriter, paint: LeafPaint, dx: number, dy: number, dz: number): void {
  writer.placeLeaf(dx, dy, dz, selectLeafBlock(paint, dx, dy, dz));
}

/** Canopy width factor: 1 at heightScale 1, about 0.71 at 0.35 and 1.135 at 1.3. */
export function canopyScaleFor(heightScale: number): number {
  return 0.55 + 0.45 * heightScale;
}

export function randomIntegerInclusive(random: () => number, minimum: number, maximum: number): number {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

export function randomBetween(random: () => number, minimum: number, maximum: number): number {
  return minimum + random() * (maximum - minimum);
}

/** Rolls an integer in [minimum, maximum], multiplies by heightScale and rounds, never going below smallestAllowed. */
export function rollScaledHeight(
  options: TreeBuildOptions,
  minimum: number,
  maximum: number,
  smallestAllowed: number,
): number {
  const rolled = randomIntegerInclusive(options.random, minimum, maximum);
  return Math.max(smallestAllowed, Math.round(rolled * options.heightScale));
}

export function scaledRadius(baseRadius: number, heightScale: number): number {
  return baseRadius * canopyScaleFor(heightScale);
}

export function placeLogColumn(
  writer: TreeBlockWriter,
  block: BlockType,
  dx: number,
  dz: number,
  startY: number,
  endY: number,
): void {
  for (let dy = startY; dy <= endY; dy++) writer.placeLog(dx, dy, dz, block);
}

export function placeLogRectangle(
  writer: TreeBlockWriter,
  block: BlockType,
  minX: number,
  minZ: number,
  widthX: number,
  widthZ: number,
  startY: number,
  endY: number,
): void {
  for (let dy = startY; dy <= endY; dy++) {
    for (let dx = minX; dx < minX + widthX; dx++) {
      for (let dz = minZ; dz < minZ + widthZ; dz++) writer.placeLog(dx, dy, dz, block);
    }
  }
}

export function placeLogPlus(
  writer: TreeBlockWriter,
  block: BlockType,
  centerX: number,
  centerZ: number,
  startY: number,
  endY: number,
): void {
  for (let dy = startY; dy <= endY; dy++) {
    writer.placeLog(centerX, dy, centerZ, block);
    writer.placeLog(centerX + 1, dy, centerZ, block);
    writer.placeLog(centerX - 1, dy, centerZ, block);
    writer.placeLog(centerX, dy, centerZ + 1, block);
    writer.placeLog(centerX, dy, centerZ - 1, block);
  }
}

/** Bresenham style 3D line; consecutive cells always touch (26 neighbourhood). Thickness 2 adds one sideways cell. */
export function placeLogLine(
  writer: TreeBlockWriter,
  block: BlockType,
  fromX: number,
  fromY: number,
  fromZ: number,
  toX: number,
  toY: number,
  toZ: number,
  thickness: 1 | 2 = 1,
): void {
  const deltaX = toX - fromX;
  const deltaY = toY - fromY;
  const deltaZ = toZ - fromZ;
  const stepCount = Math.max(Math.abs(deltaX), Math.abs(deltaY), Math.abs(deltaZ));
  const sidewaysAlongX = Math.abs(deltaX) < Math.abs(deltaZ);
  for (let step = 0; step <= stepCount; step++) {
    const progress = stepCount === 0 ? 0 : step / stepCount;
    const cellX = Math.round(fromX + deltaX * progress);
    const cellY = Math.round(fromY + deltaY * progress);
    const cellZ = Math.round(fromZ + deltaZ * progress);
    writer.placeLog(cellX, cellY, cellZ, block);
    if (thickness === 2) {
      writer.placeLog(sidewaysAlongX ? cellX + 1 : cellX, cellY, sidewaysAlongX ? cellZ : cellZ + 1, block);
    }
  }
}

/** Filled ellipsoid of leaves. Cells in the outer shell are dropped with probability roughness, which breaks the silhouette. */
export function fillLeafEllipsoid(
  writer: TreeBlockWriter,
  paint: LeafPaint,
  centerX: number,
  centerY: number,
  centerZ: number,
  radiusX: number,
  radiusY: number,
  radiusZ: number,
  random: () => number,
  roughness = 0.2,
): void {
  const maxY = Math.floor(centerY + radiusY);
  const maxX = Math.floor(centerX + radiusX);
  const maxZ = Math.floor(centerZ + radiusZ);
  for (let dy = Math.ceil(centerY - radiusY); dy <= maxY; dy++) {
    const normalizedY = (dy - centerY) / radiusY;
    for (let dx = Math.ceil(centerX - radiusX); dx <= maxX; dx++) {
      const normalizedX = (dx - centerX) / radiusX;
      for (let dz = Math.ceil(centerZ - radiusZ); dz <= maxZ; dz++) {
        const normalizedZ = (dz - centerZ) / radiusZ;
        const squaredDistance = normalizedX * normalizedX + normalizedY * normalizedY + normalizedZ * normalizedZ;
        if (squaredDistance > 1) continue;
        if (squaredDistance > 0.6 && random() < roughness) continue;
        placeLeafAt(writer, paint, dx, dy, dz);
      }
    }
  }
}

/** One flat elliptical layer of leaves at height y. */
export function placeLeafDisc(
  writer: TreeBlockWriter,
  paint: LeafPaint,
  centerX: number,
  dy: number,
  centerZ: number,
  radiusX: number,
  radiusZ: number,
  random: () => number,
  roughness = 0.2,
): void {
  const maxX = Math.floor(centerX + radiusX);
  const maxZ = Math.floor(centerZ + radiusZ);
  for (let dx = Math.ceil(centerX - radiusX); dx <= maxX; dx++) {
    const normalizedX = (dx - centerX) / radiusX;
    for (let dz = Math.ceil(centerZ - radiusZ); dz <= maxZ; dz++) {
      const normalizedZ = (dz - centerZ) / radiusZ;
      const squaredDistance = normalizedX * normalizedX + normalizedZ * normalizedZ;
      if (squaredDistance > 1) continue;
      if (squaredDistance > 0.55 && random() < roughness) continue;
      placeLeafAt(writer, paint, dx, dy, dz);
    }
  }
}

/** Leaves hanging one layer below the rim of an elliptical disc, each rim cell kept with probability chance. */
export function placeLeafRimDroop(
  writer: TreeBlockWriter,
  paint: LeafPaint,
  centerX: number,
  discDy: number,
  centerZ: number,
  radiusX: number,
  radiusZ: number,
  random: () => number,
  chance: number,
): void {
  const maxX = Math.floor(centerX + radiusX);
  const maxZ = Math.floor(centerZ + radiusZ);
  for (let dx = Math.ceil(centerX - radiusX); dx <= maxX; dx++) {
    const normalizedX = (dx - centerX) / radiusX;
    for (let dz = Math.ceil(centerZ - radiusZ); dz <= maxZ; dz++) {
      const normalizedZ = (dz - centerZ) / radiusZ;
      const squaredDistance = normalizedX * normalizedX + normalizedZ * normalizedZ;
      if (squaredDistance > 1 || squaredDistance < 0.5) continue;
      if (random() < chance) placeLeafAt(writer, paint, dx, discDy - 1, dz);
    }
  }
}

/** A strand of leaves hanging straight down from (dx, startDy). */
export function placeLeafStrand(
  writer: TreeBlockWriter,
  paint: LeafPaint,
  dx: number,
  startDy: number,
  dz: number,
  length: number,
): void {
  for (let step = 0; step < length; step++) placeLeafAt(writer, paint, dx, startDy - step, dz);
}

/** Ragged disc of ground cover (podzol, moss, coarse dirt) centred under the trunk. */
export function placeGroundPatch(
  writer: TreeBlockWriter,
  block: BlockType,
  centerX: number,
  centerZ: number,
  radius: number,
  random: () => number,
): void {
  const maxX = Math.floor(centerX + radius);
  const maxZ = Math.floor(centerZ + radius);
  const squaredRadius = radius * radius;
  for (let dx = Math.ceil(centerX - radius); dx <= maxX; dx++) {
    for (let dz = Math.ceil(centerZ - radius); dz <= maxZ; dz++) {
      const squaredDistance = (dx - centerX) * (dx - centerX) + (dz - centerZ) * (dz - centerZ);
      if (squaredDistance > squaredRadius) continue;
      if (squaredDistance > squaredRadius * 0.4 && random() < 0.4) continue;
      writer.placeGround(dx, dz, block);
    }
  }
}

export const COMPASS_STEP_X = [1, 1, 0, -1, -1, -1, 0, 1];
export const COMPASS_STEP_Z = [0, 1, 1, 1, 0, -1, -1, -1];

/**
 * Stacked leaf discs forming a cone from topDy (single tip cell) down to bottomDy.
 * Every third layer from the top is pulled in by one block, which gives conifers their tiers.
 */
export function placeLeafCone(
  writer: TreeBlockWriter,
  paint: LeafPaint,
  centerX: number,
  centerZ: number,
  topDy: number,
  bottomDy: number,
  maxRadius: number,
  aspectZ: number,
  random: () => number,
  roughness: number,
): void {
  const coneDepth = Math.max(1, topDy - bottomDy);
  for (let dy = topDy; dy >= bottomDy; dy--) {
    const depth = topDy - dy;
    const progress = depth / coneDepth;
    let radius = 0.4 + maxRadius * progress + (random() - 0.5) * 0.7;
    if (depth % 3 === 2) radius -= 0.9;
    if (radius < 0.5) radius = 0.5;
    if (radius > maxRadius) radius = maxRadius;
    placeLeafDisc(writer, paint, centerX, dy, centerZ, radius, radius * aspectZ, random, roughness);
  }
}
