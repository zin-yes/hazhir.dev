import { describe, expect, test } from "bun:test";
import { castVoxelRay } from "./voxel-ray";
import { counterTotal, gaugeMax, withEnabledProfiler } from "./world/profiler-readings.test-helper";

const solidAt =
  (...blocks: Array<[number, number, number]>) =>
  (x: number, y: number, z: number) =>
    blocks.some(([bx, by, bz]) => bx === x && by === y && bz === z);

describe("castVoxelRay", () => {
  test("hits the first solid block and reports the face it entered through", () => {
    const hit = castVoxelRay(
      [0, 0, 0],
      [1, 0, 0],
      solidAt([3, 0, 0], [5, 0, 0]),
      5,
    );
    expect(hit?.cell).toEqual([3, 0, 0]);
    expect(hit?.faceNormal).toEqual([-1, 0, 0]);
    expect(hit?.point[0]).toBeCloseTo(2.5);
  });

  test("looking down at a floor reports the top face", () => {
    const hit = castVoxelRay([0.2, 3, 0.1], [0, -1, 0], solidAt([0, 0, 0]), 5);
    expect(hit?.cell).toEqual([0, 0, 0]);
    expect(hit?.faceNormal).toEqual([0, 1, 0]);
    expect(hit?.point[1]).toBeCloseTo(0.5);
  });

  test("a diagonal ray finds the block whose face it actually crosses", () => {
    const direction = [1, 0, 0.4].map(
      (component) => component / Math.hypot(1, 0, 0.4),
    ) as [number, number, number];
    const hit = castVoxelRay([0, 0, 0], direction, solidAt([3, 0, 1]), 6);
    expect(hit?.cell).toEqual([3, 0, 1]);
    expect(hit?.faceNormal[0]).toBe(-1);
  });

  test("misses beyond the reach and returns null", () => {
    expect(
      castVoxelRay([0, 0, 0], [1, 0, 0], solidAt([8, 0, 0]), 5),
    ).toBeNull();
  });

  test("starting inside a block reports a face instead of a zero normal", () => {
    const hit = castVoxelRay([0, 0, 0], [0, 0, -1], solidAt([0, 0, 0]), 5);
    expect(hit?.cell).toEqual([0, 0, 0]);
    expect(hit?.faceNormal).toEqual([0, 0, 1]);
  });
});

describe("castVoxelRay profiling", () => {
  test("counts the cells walked, the axis of every step and the outcome of each cast", () => {
    withEnabledProfiler(() => {
      castVoxelRay([0, 0, 0], [1, 0, 0], solidAt([3, 0, 0]), 5);
      castVoxelRay([0, 0, 0], [1, 0, 0], solidAt([8, 0, 0]), 5);
      castVoxelRay([0, 0, 0], [0, 1, 0], solidAt([0, 0, 0]), 5);
      expect(counterTotal("game.ray.casts")).toBe(3);
      expect(counterTotal("game.ray.hits")).toBe(1);
      expect(counterTotal("game.ray.misses")).toBe(1);
      expect(counterTotal("game.ray.startedInsideBlock")).toBe(1);
      expect(counterTotal("game.ray.cellsExamined")).toBe(4 + 6 + 1);
      expect(counterTotal("game.ray.stepsAlongX")).toBe(3 + 6);
      expect(counterTotal("game.ray.stepsAlongY")).toBe(0);
      expect(gaugeMax("game.ray.cellsPerCast")).toBe(6);
    });
  });
});
