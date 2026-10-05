import { describe, expect, test } from "bun:test";
import { CELL_SIZE_BLOCKS, GRID_CELLS, HumidityMap } from "./humidity-map";

interface RecordedRequest {
  originBlockX: number;
  originBlockZ: number;
  resolveWith: (humidityBytes: Uint8Array) => void;
}

function createControlledExec() {
  const requests: RecordedRequest[] = [];
  const exec = (_method: string, params: unknown[]) =>
    new Promise<unknown>((resolve) => {
      requests.push({
        originBlockX: params[1] as number,
        originBlockZ: params[2] as number,
        resolveWith: resolve,
      });
    });
  return { exec, requests };
}

/** Horizontal ramp (cellX * 3) plus a row offset (cellZ * 2), so every neighbor pair differs. */
function createRampGrid(): Uint8Array {
  const humidityBytes = new Uint8Array(GRID_CELLS * GRID_CELLS);
  for (let cellZ = 0; cellZ < GRID_CELLS; cellZ++) {
    for (let cellX = 0; cellX < GRID_CELLS; cellX++) {
      humidityBytes[cellZ * GRID_CELLS + cellX] = cellX * 3 + cellZ * 2;
    }
  }
  return humidityBytes;
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function createLoadedMap() {
  const { exec, requests } = createControlledExec();
  const humidityMap = new HumidityMap(exec, 1);
  humidityMap.update(0, 0);
  requests[0]!.resolveWith(createRampGrid());
  await flushPromises();
  return { humidityMap, requests };
}

describe("HumidityMap", () => {
  test("starts neutral so clouds work before the first sample", () => {
    const humidityMap = new HumidityMap(createControlledExec().exec, 1);
    expect(humidityMap.humidityAt(123, -456)).toBeCloseTo(128 / 255, 5);
  });

  test("requests a grid centered on the camera snapped to the cell size and applies it", async () => {
    const { exec, requests } = createControlledExec();
    const humidityMap = new HumidityMap(exec, 1);
    humidityMap.update(1000, -2000);
    const expectedOriginX = (Math.round(1000 / CELL_SIZE_BLOCKS) - GRID_CELLS / 2) * CELL_SIZE_BLOCKS;
    const expectedOriginZ = (Math.round(-2000 / CELL_SIZE_BLOCKS) - GRID_CELLS / 2) * CELL_SIZE_BLOCKS;
    expect(requests[0]!.originBlockX).toBe(expectedOriginX);
    expect(requests[0]!.originBlockZ).toBe(expectedOriginZ);
    requests[0]!.resolveWith(createRampGrid());
    await flushPromises();
    expect(humidityMap.uniforms.humidityOrigin.value.x).toBe(expectedOriginX);
    expect(humidityMap.uniforms.humidityOrigin.value.y).toBe(expectedOriginZ);
    expect((humidityMap.texture.image.data as Uint8Array)[3]).toBe(9);
  });

  test("interpolates bilinearly between texels", async () => {
    const { humidityMap } = await createLoadedMap();
    const originX = humidityMap.uniforms.humidityOrigin.value.x;
    const originZ = humidityMap.uniforms.humidityOrigin.value.y;
    const texelValue = (cellX: number, cellZ: number) => (cellX * 3 + cellZ * 2) / 255;

    expect(humidityMap.humidityAt(originX + 4 * CELL_SIZE_BLOCKS, originZ + 6 * CELL_SIZE_BLOCKS)).toBeCloseTo(
      texelValue(4, 6),
      6,
    );
    const quarterAcrossX = humidityMap.humidityAt(originX + 4.25 * CELL_SIZE_BLOCKS, originZ + 6 * CELL_SIZE_BLOCKS);
    expect(quarterAcrossX).toBeCloseTo(texelValue(4, 6) + 0.25 * (texelValue(5, 6) - texelValue(4, 6)), 6);
    const centerOfQuad = humidityMap.humidityAt(originX + 4.5 * CELL_SIZE_BLOCKS, originZ + 6.5 * CELL_SIZE_BLOCKS);
    const averageOfCorners =
      (texelValue(4, 6) + texelValue(5, 6) + texelValue(4, 7) + texelValue(5, 7)) / 4;
    expect(centerOfQuad).toBeCloseTo(averageOfCorners, 6);
  });

  test("clamps to the edge texels outside the grid", async () => {
    const { humidityMap } = await createLoadedMap();
    const originX = humidityMap.uniforms.humidityOrigin.value.x;
    const originZ = humidityMap.uniforms.humidityOrigin.value.y;
    const lastCell = GRID_CELLS - 1;
    const farOutside = 1_000_000;

    expect(humidityMap.humidityAt(originX - farOutside, originZ - farOutside)).toBeCloseTo(0, 6);
    expect(humidityMap.humidityAt(originX + farOutside, originZ + farOutside)).toBeCloseTo(
      (lastCell * 3 + lastCell * 2) / 255,
      6,
    );
    expect(humidityMap.humidityAt(originX + farOutside, originZ)).toBeCloseTo((lastCell * 3) / 255, 6);
  });

  test("requests a new grid only after moving far, with one request in flight", async () => {
    const { humidityMap, requests } = await createLoadedMap();
    expect(requests.length).toBe(1);

    humidityMap.update(5 * CELL_SIZE_BLOCKS, 5 * CELL_SIZE_BLOCKS);
    humidityMap.update(12 * CELL_SIZE_BLOCKS, -12 * CELL_SIZE_BLOCKS);
    expect(requests.length).toBe(1);

    humidityMap.update(13 * CELL_SIZE_BLOCKS, 0);
    humidityMap.update(40 * CELL_SIZE_BLOCKS, 0);
    humidityMap.update(41 * CELL_SIZE_BLOCKS, 0);
    expect(requests.length).toBe(2);
    expect(requests[1]!.originBlockX).toBe((13 - GRID_CELLS / 2) * CELL_SIZE_BLOCKS);

    requests[1]!.resolveWith(createRampGrid());
    await flushPromises();
    expect(humidityMap.uniforms.humidityOrigin.value.x).toBe((13 - GRID_CELLS / 2) * CELL_SIZE_BLOCKS);

    humidityMap.update(14 * CELL_SIZE_BLOCKS, 0);
    expect(requests.length).toBe(2);
    humidityMap.update(30 * CELL_SIZE_BLOCKS, 0);
    expect(requests.length).toBe(3);
  });

  test("ignores a result that arrives after dispose", async () => {
    const { exec, requests } = createControlledExec();
    const humidityMap = new HumidityMap(exec, 1);
    humidityMap.update(0, 0);
    const originBeforeResult = humidityMap.uniforms.humidityOrigin.value.x;
    humidityMap.dispose();
    requests[0]!.resolveWith(createRampGrid());
    await flushPromises();
    expect(humidityMap.uniforms.humidityOrigin.value.x).toBe(originBeforeResult);
    expect(humidityMap.humidityAt(0, 0)).toBeCloseTo(128 / 255, 5);
  });

  test("keeps the old grid when the worker fails", async () => {
    let requestCount = 0;
    const failingMap = new HumidityMap(() => {
      requestCount++;
      return Promise.reject(new Error("worker crashed"));
    }, 1);
    failingMap.update(0, 0);
    await flushPromises();
    failingMap.update(0, 0);
    expect(requestCount).toBe(1);
    expect(failingMap.humidityAt(0, 0)).toBeCloseTo(128 / 255, 5);
  });
});
