import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { childAddressesOf, tileKeyOf, type TileAddress } from "../core/tile-address";
import type { LodTileMesh } from "../rendering/lod-tile-mesh";
import { TileDisplay } from "./tile-display";

function fakeTileMesh(name: string): LodTileMesh {
  const mesh = new THREE.Mesh();
  mesh.name = name;
  return { mesh, geometryBytes: 0, fade: 1, dispose() {} };
}

/** Fraction of pixels a tile draws: entering t keeps dither < t, leaving -1 - p keeps dither >= p. */
function visibleFraction(fade: number): number {
  return fade >= 0 ? fade : 2 + fade;
}

describe("tile display cross-fades", () => {
  test("a parent and the children replacing it fade complementarily, so every pixel stays covered", () => {
    const scene = new THREE.Scene();
    const display = new TileDisplay(scene, 300);
    const parent: TileAddress = { level: 3, tileX: 1, tileZ: 1 };
    const children = childAddressesOf(parent);
    const meshes = new Map<number, LodTileMesh>();
    const meshOf = (address: TileAddress) => {
      const key = tileKeyOf(address.level, address.tileX, address.tileZ);
      if (!meshes.has(key)) meshes.set(key, fakeTileMesh(`${address.level}/${address.tileX}/${address.tileZ}`));
      return meshes.get(key)!;
    };
    display.reconcile([parent], meshOf, true);
    expect(meshOf(parent).fade).toBe(1);

    display.reconcile(children, meshOf, false);
    let steps = 0;
    while (scene.children.length > 4) {
      for (const child of children) {
        expect(visibleFraction(meshOf(child).fade) + visibleFraction(meshOf(parent).fade)).toBeCloseTo(1, 10);
      }
      display.advance(40);
      display.reconcile(children, meshOf, false);
      steps++;
      expect(steps).toBeLessThan(20);
    }
    expect(steps).toBeGreaterThanOrEqual(7);
    expect(scene.children.map((object) => object.name).sort()).toEqual(children.map((child) => `${child.level}/${child.tileX}/${child.tileZ}`).sort());
    for (const child of children) expect(meshOf(child).fade).toBe(1);
  });

  test("reversing a transition half way continues from the current visibility instead of popping", () => {
    const scene = new THREE.Scene();
    const display = new TileDisplay(scene, 400);
    const first: TileAddress = { level: 2, tileX: 0, tileZ: 0 };
    const second: TileAddress = { level: 1, tileX: 0, tileZ: 0 };
    const meshes = new Map([[0, fakeTileMesh("first")], [1, fakeTileMesh("second")]]);
    const meshOf = (address: TileAddress) => meshes.get(address === first ? 0 : 1)!;
    display.reconcile([first], meshOf, true);
    display.reconcile([second], meshOf, false);
    display.advance(100);
    const firstVisibleBefore = visibleFraction(meshes.get(0)!.fade);
    display.reconcile([first], meshOf, false);
    expect(visibleFraction(meshes.get(0)!.fade)).toBeCloseTo(firstVisibleBefore, 10);
    expect(firstVisibleBefore).toBeCloseTo(0.75, 10);
  });
});
