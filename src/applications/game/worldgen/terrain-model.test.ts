import { describe, expect, test } from "bun:test";
import { SEA_LEVEL } from "./constants";
import { createTerrainModel } from "./terrain-model";

const SEED = 2024;
const SAMPLE_COUNT = 20000;
const SAMPLE_SPAN = 24000;

function pseudoRandomPoints(count: number, span: number) {
  let state = 12345;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return Array.from({ length: count }, () => ({
    x: Math.floor((next() - 0.5) * span),
    z: Math.floor((next() - 0.5) * span),
  }));
}

describe("terrain model", () => {
  const model = createTerrainModel(SEED);
  const samples = pseudoRandomPoints(SAMPLE_COUNT, SAMPLE_SPAN).map(({ x, z }) => model.sample(x, z));

  test("produces the same column for the same seed and position", () => {
    const first = createTerrainModel(SEED).sample(1234, -987);
    const second = createTerrainModel(SEED).sample(1234, -987);
    expect(second.height).toBe(first.height);
    expect(second.waterLevel).toBe(first.waterLevel);
  });

  test("different seeds shape different worlds", () => {
    const otherModel = createTerrainModel(SEED + 1);
    const differingColumns = pseudoRandomPoints(200, 8000).filter(
      ({ x, z }) => Math.abs(model.sample(x, z).height - otherModel.sample(x, z).height) > 3,
    );
    expect(differingColumns.length).toBeGreaterThan(100);
  });

  test("a world holds deep ocean, dry lowlands and high mountains", () => {
    const heights = samples.map((sample) => sample.height);
    expect(Math.min(...heights)).toBeLessThan(SEA_LEVEL - 35);
    expect(Math.max(...heights)).toBeGreaterThan(SEA_LEVEL + 90);
    const dryLandShare = samples.filter((sample) => sample.height > SEA_LEVEL + 2).length / samples.length;
    expect(dryLandShare).toBeGreaterThan(0.25);
    expect(dryLandShare).toBeLessThan(0.75);
  });

  test("every column below sea level is flooded up to the sea", () => {
    const drownedColumns = samples.filter((sample) => sample.height < SEA_LEVEL);
    expect(drownedColumns.length).toBeGreaterThan(1000);
    for (const sample of drownedColumns) {
      expect(sample.waterLevel).toBeGreaterThanOrEqual(SEA_LEVEL);
    }
  });

  test("rivers, lakes, canyons and volcanoes all occur", () => {
    expect(samples.some((sample) => sample.riverChannelWeight > 0.8)).toBe(true);
    expect(samples.some((sample) => sample.lakeWeight === 1 && sample.waterLevel > sample.height)).toBe(true);
    expect(samples.some((sample) => sample.canyonWeight > 0.5)).toBe(true);
    expect(samples.some((sample) => sample.volcanoWeight > 0.5)).toBe(true);
  });

  test("inland water sits above sea level only where terrain holds it back", () => {
    const risenWater = samples.filter((sample) => sample.waterLevel > SEA_LEVEL && sample.waterLevel > sample.height);
    expect(risenWater.length).toBeGreaterThan(20);
    for (const sample of risenWater) {
      expect(sample.riverValleyWeight > 0.02 || sample.lakeWeight > 0).toBe(true);
    }
  });
});
