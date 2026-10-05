import { describe, expect, test } from "bun:test";
import { CloudCarves } from "./cloud-carves";
import {
  cellAtWorld,
  cellCenterWorld,
  cloudBodyOf,
  cloudCellFilled,
  cloudDepthAt,
  pcg3d,
  roundedBoxDistance,
  type CloudFieldInputs,
} from "./cloud-field";
import { CLOUD_BASE_Y, CLOUD_CELL_HEIGHT, CLOUD_CELL_WIDTH, CLOUD_LAYER_COUNT } from "./sky-constants";

const humidInputs = (overrides: Partial<CloudFieldInputs> = {}): CloudFieldInputs => ({
  elapsedSeconds: 120,
  weatherShift: 0,
  humidityAt: () => 0.7,
  carves: [],
  ...overrides,
});

function fillRatio(inputs: CloudFieldInputs, layer: number): number {
  let filled = 0;
  const side = 60;
  for (let x = -side; x < side; x++) for (let z = -side; z < side; z++) if (cloudCellFilled({ x, y: layer, z }, inputs)) filled++;
  return filled / (side * side * 4);
}

function findFilledCell(inputs: CloudFieldInputs) {
  for (let x = -40; x < 40; x++) {
    for (let z = -40; z < 40; z++) {
      const cell = { x, y: 1, z };
      if (cloudCellFilled(cell, inputs)) return cell;
    }
  }
  throw new Error("no cloud cell in a humid sky");
}

describe("cloud field", () => {
  test("the integer hash is well spread and deterministic, including for negative lattice points", () => {
    expect(pcg3d(-5, 9, -123456)).toEqual(pcg3d(-5, 9, -123456));
    const unitValues: number[] = [];
    for (let index = -500; index < 500; index++) unitValues.push(pcg3d(index, index * 3, -index)[0] / 4294967296);
    const mean = unitValues.reduce((sum, value) => sum + value, 0) / unitValues.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    expect(Math.min(...unitValues)).toBeLessThan(0.05);
    expect(Math.max(...unitValues)).toBeGreaterThan(0.95);
  });

  test("humid air clouds over far more of the sky than dry air", () => {
    const dry = fillRatio(humidInputs({ humidityAt: () => 0.05 }), 1);
    const humid = fillRatio(humidInputs({ humidityAt: () => 0.9 }), 1);
    expect(humid).toBeGreaterThan(dry + 0.3);
    expect(humid).toBeLessThan(1);
  });

  test("a pressure front thickens the layer and the middle layer fills before the outer ones", () => {
    const calm = humidInputs({ weatherShift: -0.2, humidityAt: () => 0.4 });
    const stormy = humidInputs({ weatherShift: 0.2, humidityAt: () => 0.4 });
    expect(fillRatio(stormy, 1)).toBeGreaterThan(fillRatio(calm, 1) + 0.2);
    expect(fillRatio(calm, 1)).toBeGreaterThan(fillRatio(calm, 0));
  });

  test("cells outside the slab are never cloud", () => {
    const inputs = humidInputs({ humidityAt: () => 1, weatherShift: 0.22 });
    expect(cloudCellFilled({ x: 3, y: -1, z: 3 }, inputs)).toBe(false);
    expect(cloudCellFilled({ x: 3, y: CLOUD_LAYER_COUNT, z: 3 }, inputs)).toBe(false);
  });

  test("a body stays inside its own cell, so a ray walking cells never misses a protruding body", () => {
    for (let x = -30; x < 30; x++) {
      for (let y = 0; y < CLOUD_LAYER_COUNT; y++) {
        const { offset, halfExtents } = cloudBodyOf({ x, y, z: x * 7 });
        expect(Math.abs(offset[0]) + halfExtents[0]).toBeLessThanOrEqual(CLOUD_CELL_WIDTH / 2 + 1e-9);
        expect(Math.abs(offset[1]) + halfExtents[1]).toBeLessThanOrEqual(CLOUD_CELL_HEIGHT / 2 + 1e-9);
        expect(Math.abs(offset[2]) + halfExtents[2]).toBeLessThanOrEqual(CLOUD_CELL_WIDTH / 2 + 1e-9);
      }
    }
  });

  test("the rounded box distance is negative inside, positive outside and rounds the corner away", () => {
    const halfExtents: [number, number, number] = [10, 4, 10];
    expect(roundedBoxDistance(0, 0, 0, halfExtents, 3)).toBeLessThan(0);
    expect(roundedBoxDistance(20, 0, 0, halfExtents, 3)).toBeCloseTo(10, 5);
    expect(roundedBoxDistance(10 - 0.1, 4 - 0.1, 10 - 0.1, halfExtents, 3)).toBeGreaterThan(0);
  });

  test("the viewer is inside a cloud at a body's centre and not far outside the slab", () => {
    const inputs = humidInputs({ humidityAt: () => 0.9 });
    const cell = findFilledCell(inputs);
    const center = cellCenterWorld(cell, inputs.elapsedSeconds);
    const body = cloudBodyOf(cell);
    expect(cellAtWorld(center.x, center.y, center.z, inputs.elapsedSeconds)).toEqual(cell);
    expect(cloudDepthAt(center.x + body.offset[0], center.y + body.offset[1], center.z + body.offset[2], inputs)).toBeGreaterThan(1);
    expect(cloudDepthAt(center.x, CLOUD_BASE_Y - 200, center.z, inputs)).toBe(0);
  });

  test("a carve opens a hole in a cloud that closes again as it shrinks away", () => {
    const base = humidInputs({ humidityAt: () => 0.9 });
    const cell = findFilledCell(base);
    const center = cellCenterWorld(cell, base.elapsedSeconds);
    const carves = new CloudCarves();
    carves.carve(center.x + 8, center.y, center.z);
    expect(cloudCellFilled(cell, { ...base, carves: carves.list() })).toBe(false);
    carves.advance(15);
    expect(cloudCellFilled(cell, { ...base, carves: carves.list() })).toBe(false);
    carves.advance(10);
    expect(cloudCellFilled(cell, { ...base, carves: carves.list() })).toBe(true);
    carves.advance(10);
    expect(carves.list()).toHaveLength(0);
  });

  test("carves are rate limited by spacing and capped, dropping the oldest", () => {
    const carves = new CloudCarves();
    carves.carve(0, 0, 0);
    carves.carve(1, 0, 0);
    expect(carves.list()).toHaveLength(1);
    for (let index = 1; index <= 40; index++) carves.carve(index * 100, 0, 0);
    expect(carves.list().length).toBe(16);
    expect(carves.list()[0]!.x).toBeGreaterThan(2000);
  });
});
