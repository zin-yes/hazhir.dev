import { describe, expect, test } from "bun:test";
import { chunkKeyX, chunkKeyY, chunkKeyZ, packChunkKey } from "./chunk-key";
import { ChunkStore } from "./chunk-store";
import { ChunkStreamPlanner } from "./streaming-plan";

interface Label {
  chunkX: number;
  chunkY: number;
  chunkZ: number;
}

function labelAt(chunkX: number, chunkY: number, chunkZ: number): Label {
  return { chunkX, chunkY, chunkZ };
}

describe("ChunkStore", () => {
  test("stores and retrieves by coordinates including negatives, distinct from each other", () => {
    const store = new ChunkStore<Label>();
    const coordinates: [number, number, number][] = [
      [0, 0, 0],
      [-1, 0, 0],
      [0, -1, 0],
      [0, 0, -1],
      [1, 0, 0],
      [-100000, -2, 99999],
    ];
    for (const [chunkX, chunkY, chunkZ] of coordinates) store.set(chunkX, chunkY, chunkZ, labelAt(chunkX, chunkY, chunkZ));
    expect(store.size).toBe(coordinates.length);
    for (const [chunkX, chunkY, chunkZ] of coordinates) {
      expect(store.get(chunkX, chunkY, chunkZ)).toEqual(labelAt(chunkX, chunkY, chunkZ));
      expect(store.getByKey(packChunkKey(chunkX, chunkY, chunkZ))).toBe(store.get(chunkX, chunkY, chunkZ));
      expect(store.has(chunkX, chunkY, chunkZ)).toBe(true);
    }
    expect(store.get(2, 0, 0)).toBeUndefined();
    expect(store.has(2, 0, 0)).toBe(false);
  });

  test("delete removes only the addressed chunk and reports whether it existed", () => {
    const store = new ChunkStore<Label>();
    store.set(1, 2, 3, labelAt(1, 2, 3)).set(3, 2, 1, labelAt(3, 2, 1));
    expect(store.delete(1, 2, 3)).toBe(true);
    expect(store.delete(1, 2, 3)).toBe(false);
    expect(store.deleteByKey(packChunkKey(3, 2, 1))).toBe(true);
    expect(store.size).toBe(0);
  });

  test("iteration yields keys that unpack to the stored coordinates", () => {
    const store = new ChunkStore<Label>();
    for (let chunkX = -3; chunkX <= 3; chunkX++) {
      for (let chunkY = -2; chunkY <= 2; chunkY++) store.set(chunkX, chunkY, chunkX * 2 - 1, labelAt(chunkX, chunkY, chunkX * 2 - 1));
    }
    let visited = 0;
    for (const [chunkKey, label] of store.entries()) {
      expect([chunkKeyX(chunkKey), chunkKeyY(chunkKey), chunkKeyZ(chunkKey)]).toEqual([label.chunkX, label.chunkY, label.chunkZ]);
      visited++;
    }
    store.forEach((label, chunkKey) => {
      expect(chunkKeyX(chunkKey)).toBe(label.chunkX);
      visited++;
    });
    expect(visited).toBe(2 * 7 * 5);
    expect([...store.keys()].length).toBe(35);
    expect([...store.values()].length).toBe(35);
  });

  test("neighborsOf returns the six faces in +x -x +y -y +z -z order and undefined for gaps", () => {
    const store = new ChunkStore<Label>();
    store.set(0, 0, 0, labelAt(0, 0, 0));
    store.set(1, 0, 0, labelAt(1, 0, 0));
    store.set(0, -1, 0, labelAt(0, -1, 0));
    store.set(0, 0, 1, labelAt(0, 0, 1));
    store.set(1, 1, 1, labelAt(1, 1, 1));
    store.set(-1, -1, -1, labelAt(-1, -1, -1));
    const neighbors = store.neighborsOf(0, 0, 0);
    expect(neighbors.length).toBe(6);
    expect(neighbors[0]).toEqual(labelAt(1, 0, 0));
    expect(neighbors[1]).toBeUndefined();
    expect(neighbors[2]).toBeUndefined();
    expect(neighbors[3]).toEqual(labelAt(0, -1, 0));
    expect(neighbors[4]).toEqual(labelAt(0, 0, 1));
    expect(neighbors[5]).toBeUndefined();
  });

  test("neighbors work across sign boundaries and the scratch array is reused and refreshed", () => {
    const store = new ChunkStore<Label>();
    store.set(-1, 0, -1, labelAt(-1, 0, -1));
    store.set(0, 0, -1, labelAt(0, 0, -1));
    store.set(-1, 0, 0, labelAt(-1, 0, 0));
    const first = store.neighborsOf(-1, 0, -1);
    expect(first[0]).toEqual(labelAt(0, 0, -1));
    expect(first[4]).toEqual(labelAt(-1, 0, 0));
    const firstArray = first;
    const second = store.neighborsOf(5, 5, 5);
    expect(second).toBe(firstArray);
    expect(second.every((neighbor) => neighbor === undefined)).toBe(true);
    expect(store.neighborsOfKey(packChunkKey(-1, 0, -1))[0]).toEqual(labelAt(0, 0, -1));
  });

  test("acts as the planner's known set: planned loads become known and the next plan asks for nothing", () => {
    const store = new ChunkStore<Label>();
    const planner = new ChunkStreamPlanner({ horizontalRadius: 4, verticalUp: 1, verticalDown: 1 });
    const player = { chunkX: -3, chunkY: 0, chunkZ: 2 };
    const firstPlan = planner.update(player, { x: 0, y: 0, z: 1 }, store.asKnownChunkKeys());
    expect(firstPlan.toLoad.length).toBeGreaterThan(50);
    for (const chunkKey of firstPlan.toLoad) {
      store.setByKey(chunkKey, labelAt(chunkKeyX(chunkKey), chunkKeyY(chunkKey), chunkKeyZ(chunkKey)));
    }
    planner.invalidate();
    const secondPlan = planner.update(player, { x: 0, y: 0, z: 1 }, store.asKnownChunkKeys());
    expect(secondPlan.toLoad).toEqual([]);
    expect(secondPlan.toUnload).toEqual([]);
    const movedPlan = planner.update({ ...player, chunkX: -2 }, { x: 0, y: 0, z: 1 }, store.asKnownChunkKeys());
    expect(movedPlan.toLoad.length).toBeGreaterThan(0);
  });
});
