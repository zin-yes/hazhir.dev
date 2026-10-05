// CPU twin of the cloud field in the sky shader: which grid cells hold a cloud and how each cell's rounded body is
// shaped. The hash is integer arithmetic (PCG3D), so shader and CPU agree on every cell; the CPU needs the field to
// know when the viewer is inside a cloud and to carve holes the shader also honours.

import {
  CLOUD_BASE_COVERAGE,
  CLOUD_BASE_Y,
  CLOUD_CELL_HEIGHT,
  CLOUD_CELL_WIDTH,
  CLOUD_EVOLUTION_PER_SECOND,
  CLOUD_HUMIDITY_GAIN,
  CLOUD_LAYER_COUNT,
  CLOUD_WIND_BLOCKS_PER_SECOND,
} from "./sky-constants";

export interface CloudCell {
  x: number;
  y: number;
  z: number;
}

export interface CloudBody {
  /** Centre relative to the cell centre, in blocks. */
  offset: [number, number, number];
  halfExtents: [number, number, number];
  cornerRadius: number;
}

export interface CloudCarve {
  x: number;
  y: number;
  z: number;
  radius: number;
}

export interface CloudFieldInputs {
  elapsedSeconds: number;
  weatherShift: number;
  humidityAt(worldX: number, worldZ: number): number;
  carves: readonly CloudCarve[];
}

const SHAPE_SALT = 7919;
const MIN_WIDTH_SCALE = 0.62;
const MAX_WIDTH_SCALE = 0.98;
const MIN_HEIGHT_SCALE = 0.5;
const MAX_HEIGHT_SCALE = 0.95;
const CORNER_ROUNDNESS = 0.9;

function toUint32(value: number): number {
  return value >>> 0;
}

/** PCG3D: three well-mixed 32-bit unsigned values from an integer lattice point. */
export function pcg3d(x: number, y: number, z: number): [number, number, number] {
  let a = toUint32(Math.imul(x, 1664525) + 1013904223);
  let b = toUint32(Math.imul(y, 1664525) + 1013904223);
  let c = toUint32(Math.imul(z, 1664525) + 1013904223);
  a = toUint32(a + Math.imul(b, c));
  b = toUint32(b + Math.imul(c, a));
  c = toUint32(c + Math.imul(a, b));
  a = toUint32(a ^ (a >>> 16));
  b = toUint32(b ^ (b >>> 16));
  c = toUint32(c ^ (c >>> 16));
  a = toUint32(a + Math.imul(b, c));
  b = toUint32(b + Math.imul(c, a));
  c = toUint32(c + Math.imul(a, b));
  return [a, b, c];
}

const UINT32_RANGE = 4294967296;

function latticeValue(x: number, y: number, z: number): number {
  return pcg3d(x, y, z)[0] / UINT32_RANGE;
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

export function valueNoise(x: number, y: number, z: number): number {
  const baseX = Math.floor(x);
  const baseY = Math.floor(y);
  const baseZ = Math.floor(z);
  const fractionX = x - baseX;
  const fractionY = y - baseY;
  const fractionZ = z - baseZ;
  const easedX = fractionX * fractionX * (3 - 2 * fractionX);
  const easedY = fractionY * fractionY * (3 - 2 * fractionY);
  const easedZ = fractionZ * fractionZ * (3 - 2 * fractionZ);
  const corner = (offsetX: number, offsetY: number, offsetZ: number) =>
    latticeValue(baseX + offsetX, baseY + offsetY, baseZ + offsetZ);
  const lowerPlane = mix(
    mix(corner(0, 0, 0), corner(1, 0, 0), easedX),
    mix(corner(0, 1, 0), corner(1, 1, 0), easedX),
    easedY,
  );
  const upperPlane = mix(
    mix(corner(0, 0, 1), corner(1, 0, 1), easedX),
    mix(corner(0, 1, 1), corner(1, 1, 1), easedX),
    easedY,
  );
  return mix(lowerPlane, upperPlane, easedZ);
}

export function windOffsetAt(elapsedSeconds: number): { x: number; z: number } {
  return {
    x: CLOUD_WIND_BLOCKS_PER_SECOND.x * elapsedSeconds,
    z: CLOUD_WIND_BLOCKS_PER_SECOND.z * elapsedSeconds,
  };
}

/** Where a cell centre is in the world right now (the grid drifts with the wind). */
export function cellCenterWorld(cell: CloudCell, elapsedSeconds: number): { x: number; y: number; z: number } {
  const wind = windOffsetAt(elapsedSeconds);
  return {
    x: (cell.x + 0.5) * CLOUD_CELL_WIDTH + wind.x,
    y: CLOUD_BASE_Y + (cell.y + 0.5) * CLOUD_CELL_HEIGHT,
    z: (cell.z + 0.5) * CLOUD_CELL_WIDTH + wind.z,
  };
}

/** The cell of the drifting grid that holds a world position (y may fall outside the slab). */
export function cellAtWorld(worldX: number, worldY: number, worldZ: number, elapsedSeconds: number): CloudCell {
  const wind = windOffsetAt(elapsedSeconds);
  return {
    x: Math.floor((worldX - wind.x) / CLOUD_CELL_WIDTH),
    y: Math.floor((worldY - CLOUD_BASE_Y) / CLOUD_CELL_HEIGHT),
    z: Math.floor((worldZ - wind.z) / CLOUD_CELL_WIDTH),
  };
}

export function carveRemovesCell(center: { x: number; y: number; z: number }, carves: readonly CloudCarve[]): boolean {
  for (const carve of carves) {
    if (carve.radius <= 0) continue;
    const distance = Math.hypot(center.x - carve.x, center.y - carve.y, center.z - carve.z);
    if (distance < carve.radius) return true;
  }
  return false;
}

export function cloudCellFilled(cell: CloudCell, inputs: CloudFieldInputs): boolean {
  if (cell.y < 0 || cell.y >= CLOUD_LAYER_COUNT) return false;
  const center = cellCenterWorld(cell, inputs.elapsedSeconds);
  const coverage = Math.min(
    1,
    Math.max(
      0,
      CLOUD_BASE_COVERAGE + inputs.humidityAt(center.x, center.z) * CLOUD_HUMIDITY_GAIN + inputs.weatherShift,
    ),
  );
  const noiseX = cell.x * 0.085;
  const noiseY = cell.y * 1.6 * 0.085 + inputs.elapsedSeconds * CLOUD_EVOLUTION_PER_SECOND;
  const noiseZ = cell.z * 0.085;
  const shape =
    0.62 * valueNoise(noiseX, noiseY, noiseZ) + 0.38 * valueNoise(noiseX * 2.3 + 17, noiseY * 2.3 + 17, noiseZ * 2.3 + 17);
  let density = Math.min(1, Math.max(0, (shape - 0.5) * 2 + 0.5));
  density -= Math.abs(cell.y - (CLOUD_LAYER_COUNT - 1) * 0.5) * 0.12;
  if (density <= 1 - coverage) return false;
  return !carveRemovesCell(center, inputs.carves);
}

/** The rounded body drawn inside a filled cell: a pill whose size and position vary from cell to cell. */
export function cloudBodyOf(cell: CloudCell): CloudBody {
  const [widthHash, heightHash, depthHash] = pcg3d(cell.x + SHAPE_SALT, cell.y + SHAPE_SALT, cell.z + SHAPE_SALT);
  const widthScale = mix(MIN_WIDTH_SCALE, MAX_WIDTH_SCALE, widthHash / UINT32_RANGE);
  const heightScale = mix(MIN_HEIGHT_SCALE, MAX_HEIGHT_SCALE, heightHash / UINT32_RANGE);
  const depthScale = mix(MIN_WIDTH_SCALE, MAX_WIDTH_SCALE, depthHash / UINT32_RANGE);
  const halfExtents: [number, number, number] = [
    (CLOUD_CELL_WIDTH * widthScale) / 2,
    (CLOUD_CELL_HEIGHT * heightScale) / 2,
    (CLOUD_CELL_WIDTH * depthScale) / 2,
  ];
  const [offsetXHash, offsetYHash, offsetZHash] = pcg3d(cell.x - SHAPE_SALT, cell.y - SHAPE_SALT, cell.z - SHAPE_SALT);
  const offset: [number, number, number] = [
    (offsetXHash / UINT32_RANGE - 0.5) * (CLOUD_CELL_WIDTH - halfExtents[0] * 2),
    (offsetYHash / UINT32_RANGE - 0.5) * (CLOUD_CELL_HEIGHT - halfExtents[1] * 2),
    (offsetZHash / UINT32_RANGE - 0.5) * (CLOUD_CELL_WIDTH - halfExtents[2] * 2),
  ];
  return { offset, halfExtents, cornerRadius: Math.min(...halfExtents) * CORNER_ROUNDNESS };
}

/** Negative inside the rounded box, positive outside; relative to the body centre. */
export function roundedBoxDistance(
  pointX: number,
  pointY: number,
  pointZ: number,
  halfExtents: readonly [number, number, number],
  cornerRadius: number,
): number {
  const insetX = Math.abs(pointX) - halfExtents[0] + cornerRadius;
  const insetY = Math.abs(pointY) - halfExtents[1] + cornerRadius;
  const insetZ = Math.abs(pointZ) - halfExtents[2] + cornerRadius;
  const outside = Math.hypot(Math.max(insetX, 0), Math.max(insetY, 0), Math.max(insetZ, 0));
  const inside = Math.min(Math.max(insetX, insetY, insetZ), 0);
  return outside + inside - cornerRadius;
}

/**
 * How deep inside a cloud body a world position is, in blocks (0 when outside every cloud). The neighbouring cells
 * are checked too, because a body never leaves its own cell but the position may sit at a cell edge.
 */
export function cloudDepthAt(worldX: number, worldY: number, worldZ: number, inputs: CloudFieldInputs): number {
  const cell = cellAtWorld(worldX, worldY, worldZ, inputs.elapsedSeconds);
  if (!cloudCellFilled(cell, inputs)) return 0;
  const center = cellCenterWorld(cell, inputs.elapsedSeconds);
  const body = cloudBodyOf(cell);
  const distance = roundedBoxDistance(
    worldX - center.x - body.offset[0],
    worldY - center.y - body.offset[1],
    worldZ - center.z - body.offset[2],
    body.halfExtents,
    body.cornerRadius,
  );
  return Math.max(0, -distance);
}
