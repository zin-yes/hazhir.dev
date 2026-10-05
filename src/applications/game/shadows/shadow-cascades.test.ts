import { describe, expect, test } from "bun:test";
import { SNAP_TEXELS, cascadeEndDistances, fitCascadeBox, frustumSliceSphere, lightPlaneAxes, type FrustumSlice, type Vector3Tuple } from "./shadow-cascades";

const slice: FrustumSlice = {
  cameraPosition: [1234.3, 90.7, -560.1],
  cameraForward: [0, 0, -1],
  verticalFieldOfViewRadians: (85 * Math.PI) / 180,
  aspect: 16 / 9,
  nearDistance: 0.1,
  farDistance: 72,
};

function distance(first: Vector3Tuple, second: Vector3Tuple): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
}

describe("cascadeEndDistances", () => {
  test("ends at the shadow distance and grows with every cascade", () => {
    const ends = cascadeEndDistances(24, 192, 3);
    expect(ends[0]).toBeCloseTo(24);
    expect(ends[2]).toBeCloseTo(192);
    expect(ends[1]!).toBeGreaterThan(ends[0]!);
    expect(ends[1]!).toBeLessThan(ends[2]!);
  });
});

describe("frustumSliceSphere", () => {
  test("reaches every corner of the slice", () => {
    const sphere = frustumSliceSphere(slice);
    const tangentY = Math.tan(slice.verticalFieldOfViewRadians / 2);
    const tangentX = tangentY * slice.aspect;
    for (const depth of [slice.nearDistance, slice.farDistance]) {
      for (const [signX, signY] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const corner: Vector3Tuple = [
          slice.cameraPosition[0] + signX * tangentX * depth,
          slice.cameraPosition[1] + signY * tangentY * depth,
          slice.cameraPosition[2] - depth,
        ];
        expect(distance(corner, sphere.center)).toBeLessThanOrEqual(sphere.radius + 1e-6);
      }
    }
  });
});

describe("fitCascadeBox", () => {
  const sunDirection: Vector3Tuple = [0.5, 0.7, 0.51];
  const length = Math.hypot(...sunDirection);
  const lightDirection: Vector3Tuple = [sunDirection[0] / length, sunDirection[1] / length, sunDirection[2] / length];

  test("the box origin sits on a grid of whole texels, so creeping the camera rarely moves it", () => {
    const first = fitCascadeBox(slice, lightDirection, 2048);
    const moved = fitCascadeBox({ ...slice, cameraPosition: [slice.cameraPosition[0] + first.texelWorldSize, slice.cameraPosition[1], slice.cameraPosition[2]] }, lightDirection, 2048);
    const { right } = lightPlaneAxes(lightDirection);
    const gridCellsAlongRight = (first.center[0] * right[0] + first.center[1] * right[1] + first.center[2] * right[2]) / (first.texelWorldSize * SNAP_TEXELS);
    expect(Math.abs(gridCellsAlongRight - Math.round(gridCellsAlongRight))).toBeLessThan(1e-6);
    expect(distance(moved.center, first.center)).toBeLessThanOrEqual(first.texelWorldSize * SNAP_TEXELS * 1.0001);
    const redrawsWhileCreeping = Array.from({ length: 16 }, (_, step) =>
      fitCascadeBox({ ...slice, cameraPosition: [slice.cameraPosition[0] + step * first.texelWorldSize, slice.cameraPosition[1], slice.cameraPosition[2]] }, lightDirection, 2048).center.join(),
    );
    expect(new Set(redrawsWhileCreeping).size).toBeLessThanOrEqual(2);
    expect(moved.halfExtent).toBe(first.halfExtent);
  });

  test("the padded box still covers the whole slice when the snapped centre lags the camera", () => {
    const box = fitCascadeBox(slice, lightDirection, 2048);
    const sphere = frustumSliceSphere(slice);
    const { right, up } = lightPlaneAxes(lightDirection);
    const offset: Vector3Tuple = [sphere.center[0] - box.center[0], sphere.center[1] - box.center[1], sphere.center[2] - box.center[2]];
    const along = (axis: Vector3Tuple) => Math.abs(offset[0] * axis[0] + offset[1] * axis[1] + offset[2] * axis[2]);
    expect(along(right) + sphere.radius).toBeLessThanOrEqual(box.halfExtent);
    expect(along(up) + sphere.radius).toBeLessThanOrEqual(box.halfExtent);
  });

  test("the box size does not change when the camera turns", () => {
    const turned = fitCascadeBox({ ...slice, cameraForward: [1, 0, 0] }, lightDirection, 2048);
    expect(turned.halfExtent).toBe(fitCascadeBox(slice, lightDirection, 2048).halfExtent);
  });
});
