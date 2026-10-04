// The tiles currently in the LOD scene and their cross-fades. When the render set changes, entering tiles fade in
// while leaving ones fade out over the same interval with complementary dither thresholds, so every pixel is drawn by
// one of them throughout and a level change dissolves instead of popping. A leaving tile is removed from the scene
// when its fade ends (its mesh stays cached).

import type * as THREE from "three";
import { tileKeyOf, type TileAddress } from "../core/tile-address";
import type { LodTileMesh } from "../rendering/lod-tile-mesh";

interface DisplayedTile {
  address: TileAddress;
  tileMesh: LodTileMesh;
  isEntering: boolean;
  /** 0..1 progress of the current fade (1 = finished). */
  progress: number;
}

export class TileDisplay {
  private readonly displayed = new Map<number, DisplayedTile>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly fadeMilliseconds: number,
  ) {}

  get keys(): IterableIterator<number> {
    return this.displayed.keys();
  }

  get size(): number {
    return this.displayed.size;
  }

  isDisplayed(key: number): boolean {
    return this.displayed.has(key);
  }

  displayedAddresses(): TileAddress[] {
    return [...this.displayed.values()].map((tile) => tile.address);
  }

  private applyFade(tile: DisplayedTile): void {
    tile.tileMesh.fade = tile.isEntering ? tile.progress : -1 - tile.progress;
  }

  /**
   * Makes the scene show `wanted` (tiles with ready meshes). `meshOf` returns the cached mesh of a wanted tile.
   * `instant` skips the fade (first fill, or fades disabled).
   */
  reconcile(wanted: readonly TileAddress[], meshOf: (address: TileAddress) => LodTileMesh, instant: boolean): void {
    const wantedKeys = new Set<number>();
    for (const address of wanted) {
      const key = tileKeyOf(address.level, address.tileX, address.tileZ);
      wantedKeys.add(key);
      const existing = this.displayed.get(key);
      if (existing === undefined) {
        const tile: DisplayedTile = { address, tileMesh: meshOf(address), isEntering: true, progress: instant ? 1 : 0 };
        this.applyFade(tile);
        this.scene.add(tile.tileMesh.mesh);
        this.displayed.set(key, tile);
      } else if (!existing.isEntering) {
        existing.isEntering = true;
        existing.progress = instant ? 1 : 1 - existing.progress;
        this.applyFade(existing);
      }
    }
    for (const [key, tile] of this.displayed) {
      if (wantedKeys.has(key) || !tile.isEntering) continue;
      tile.isEntering = false;
      tile.progress = instant ? 1 : 1 - Math.min(1, tile.progress);
      this.applyFade(tile);
    }
  }

  /** Advances fades and removes tiles whose fade-out finished. */
  advance(elapsedMilliseconds: number): void {
    const step = this.fadeMilliseconds <= 0 ? 1 : elapsedMilliseconds / this.fadeMilliseconds;
    for (const [key, tile] of this.displayed) {
      if (tile.progress < 1) tile.progress = Math.min(1, tile.progress + step);
      if (!tile.isEntering && tile.progress >= 1) {
        this.scene.remove(tile.tileMesh.mesh);
        this.displayed.delete(key);
        continue;
      }
      this.applyFade(tile);
    }
  }

  /** Swaps the mesh of a displayed tile in place (a rebuilt tile), keeping its fade state. */
  replaceMesh(address: TileAddress, tileMesh: LodTileMesh): void {
    const tile = this.displayed.get(tileKeyOf(address.level, address.tileX, address.tileZ));
    if (tile === undefined || tile.tileMesh === tileMesh) return;
    this.scene.remove(tile.tileMesh.mesh);
    tile.tileMesh = tileMesh;
    this.applyFade(tile);
    this.scene.add(tileMesh.mesh);
  }

  /** Removes a tile immediately (its mesh is being released). */
  remove(address: TileAddress, tileMesh: LodTileMesh): void {
    const key = tileKeyOf(address.level, address.tileX, address.tileZ);
    const tile = this.displayed.get(key);
    if (tile === undefined || tile.tileMesh !== tileMesh) return;
    this.scene.remove(tile.tileMesh.mesh);
    this.displayed.delete(key);
  }

  clear(): void {
    for (const tile of this.displayed.values()) this.scene.remove(tile.tileMesh.mesh);
    this.displayed.clear();
  }
}
