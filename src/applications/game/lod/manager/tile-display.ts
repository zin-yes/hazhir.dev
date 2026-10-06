// The tiles currently in the LOD scene and their cross-fades. When the render set changes, entering tiles fade in
// while leaving ones fade out over the same interval with complementary dither thresholds, so every pixel is drawn by
// one of them throughout and a level change dissolves instead of popping. A leaving tile is removed from the scene
// when its fade ends (its mesh stays cached).

import type * as THREE from "three";
import { profiler } from "../../profiler";
import { MAX_LOD_LEVEL } from "../core/lod-constants";
import { metricNameOfLevel, perLevelMetricNames } from "../core/lod-level-keys";
import { tileKeyOf, type TileAddress } from "../core/tile-address";
import type { LodTileMesh } from "../rendering/lod-tile-mesh";

const LEVEL_COUNT = MAX_LOD_LEVEL + 1;
const INDICES_PER_TRIANGLE = 3;
const ADDED_PER_LEVEL = perLevelMetricNames("game.lod.display.added.");
const FADE_OUT_STARTED_PER_LEVEL = perLevelMetricNames("game.lod.display.fadeOutStarted.");
const REMOVED_PER_LEVEL = perLevelMetricNames("game.lod.display.removed.");
const TILES_PER_LEVEL = perLevelMetricNames("game.lod.display.tiles.");
const TRIANGLES_PER_LEVEL = perLevelMetricNames("game.lod.display.triangles.");

function levelSlot(level: number): number {
  return level < LEVEL_COUNT ? level : LEVEL_COUNT - 1;
}

function triangleCountOf(tileMesh: LodTileMesh): number {
  let indexCount = 0;
  for (const group of tileMesh.mesh.geometry.groups) indexCount += group.count;
  return indexCount / INDICES_PER_TRIANGLE;
}

interface DisplayedTile {
  address: TileAddress;
  tileMesh: LodTileMesh;
  isEntering: boolean;
  /** 0..1 progress of the current fade (1 = finished). */
  progress: number;
}

export class TileDisplay {
  private readonly displayed = new Map<number, DisplayedTile>();
  private readonly addedByLevel = new Int32Array(LEVEL_COUNT);
  private readonly fadeOutStartedByLevel = new Int32Array(LEVEL_COUNT);
  private readonly tilesByLevel = new Int32Array(LEVEL_COUNT);
  private readonly trianglesByLevel = new Float64Array(LEVEL_COUNT);

  constructor(
    private readonly scene: THREE.Object3D,
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
    const token = profiler.begin("main.lod.display.reconcile");
    try {
      const wantedKeys = new Set<number>();
      let added = 0;
      let reEntered = 0;
      let kept = 0;
      let fadeOutStarted = 0;
      for (const address of wanted) {
        const key = tileKeyOf(address.level, address.tileX, address.tileZ);
        wantedKeys.add(key);
        const existing = this.displayed.get(key);
        if (existing === undefined) {
          const tile: DisplayedTile = { address, tileMesh: meshOf(address), isEntering: true, progress: instant ? 1 : 0 };
          this.applyFade(tile);
          this.scene.add(tile.tileMesh.mesh);
          this.displayed.set(key, tile);
          added++;
          this.addedByLevel[levelSlot(address.level)]!++;
        } else if (!existing.isEntering) {
          existing.isEntering = true;
          existing.progress = instant ? 1 : 1 - existing.progress;
          this.applyFade(existing);
          reEntered++;
        } else {
          kept++;
        }
      }
      for (const [key, tile] of this.displayed) {
        if (wantedKeys.has(key) || !tile.isEntering) continue;
        tile.isEntering = false;
        tile.progress = instant ? 1 : 1 - Math.min(1, tile.progress);
        this.applyFade(tile);
        fadeOutStarted++;
        this.fadeOutStartedByLevel[levelSlot(tile.address.level)]!++;
      }
      this.reportReconcile(wanted.length, added, reEntered, kept, fadeOutStarted);
    } finally {
      profiler.end(token);
    }
  }

  private reportReconcile(wantedCount: number, added: number, reEntered: number, kept: number, fadeOutStarted: number): void {
    if (profiler.enabled) {
      profiler.addCounter("game.lod.display.reconciles");
      profiler.addCounter("game.lod.display.added", added);
      profiler.addCounter("game.lod.display.reEntered", reEntered);
      profiler.addCounter("game.lod.display.kept", kept);
      profiler.addCounter("game.lod.display.fadeOutStarted", fadeOutStarted);
      profiler.sampleGauge("game.lod.display.wanted", wantedCount);
      for (let level = 0; level < LEVEL_COUNT; level++) {
        if (this.addedByLevel[level]! > 0) profiler.addCounter(metricNameOfLevel(ADDED_PER_LEVEL, level), this.addedByLevel[level]!);
        if (this.fadeOutStartedByLevel[level]! > 0) {
          profiler.addCounter(metricNameOfLevel(FADE_OUT_STARTED_PER_LEVEL, level), this.fadeOutStartedByLevel[level]!);
        }
      }
    }
    this.addedByLevel.fill(0);
    this.fadeOutStartedByLevel.fill(0);
  }

  /** Advances fades and removes tiles whose fade-out finished. */
  advance(elapsedMilliseconds: number): void {
    const token = profiler.begin("main.lod.display.advance");
    try {
      const step = this.fadeMilliseconds <= 0 ? 1 : elapsedMilliseconds / this.fadeMilliseconds;
      let removed = 0;
      let fading = 0;
      for (const [key, tile] of this.displayed) {
        if (tile.progress < 1) {
          tile.progress = Math.min(1, tile.progress + step);
          if (tile.progress < 1) fading++;
        }
        if (!tile.isEntering && tile.progress >= 1) {
          this.scene.remove(tile.tileMesh.mesh);
          this.displayed.delete(key);
          removed++;
          if (profiler.enabled) profiler.addCounter(metricNameOfLevel(REMOVED_PER_LEVEL, tile.address.level));
          continue;
        }
        this.applyFade(tile);
      }
      if (profiler.enabled) {
        profiler.addCounter("game.lod.display.removed", removed);
        profiler.sampleGauge("game.lod.display.fading", fading);
      }
    } finally {
      profiler.end(token);
    }
  }

  /** Samples what is in the scene per level (tiles and triangles drawn). Call once per frame; a no-op while the profiler is off. */
  reportDrawnToProfiler(): void {
    if (!profiler.enabled) return;
    this.tilesByLevel.fill(0);
    this.trianglesByLevel.fill(0);
    let leaving = 0;
    let totalTriangles = 0;
    for (const tile of this.displayed.values()) {
      const slot = levelSlot(tile.address.level);
      const triangles = triangleCountOf(tile.tileMesh);
      this.tilesByLevel[slot]!++;
      this.trianglesByLevel[slot]! += triangles;
      totalTriangles += triangles;
      if (!tile.isEntering) leaving++;
    }
    for (let level = 0; level < LEVEL_COUNT; level++) {
      if (this.tilesByLevel[level]! === 0 && this.trianglesByLevel[level]! === 0) continue;
      profiler.sampleGauge(metricNameOfLevel(TILES_PER_LEVEL, level), this.tilesByLevel[level]!);
      profiler.sampleGauge(metricNameOfLevel(TRIANGLES_PER_LEVEL, level), this.trianglesByLevel[level]!);
    }
    profiler.sampleGauge("game.lod.display.tiles", this.displayed.size);
    profiler.sampleGauge("game.lod.display.leaving", leaving);
    profiler.sampleGauge("game.lod.display.triangles", totalTriangles);
  }

  /** Swaps the mesh of a displayed tile in place (a rebuilt tile), keeping its fade state. */
  replaceMesh(address: TileAddress, tileMesh: LodTileMesh): void {
    const tile = this.displayed.get(tileKeyOf(address.level, address.tileX, address.tileZ));
    if (tile === undefined || tile.tileMesh === tileMesh) return;
    this.scene.remove(tile.tileMesh.mesh);
    tile.tileMesh = tileMesh;
    this.applyFade(tile);
    this.scene.add(tileMesh.mesh);
    profiler.addCounter("game.lod.display.meshReplaced");
  }

  /** Removes a tile immediately (its mesh is being released). */
  remove(address: TileAddress, tileMesh: LodTileMesh): void {
    const key = tileKeyOf(address.level, address.tileX, address.tileZ);
    const tile = this.displayed.get(key);
    if (tile === undefined || tile.tileMesh !== tileMesh) return;
    this.scene.remove(tile.tileMesh.mesh);
    this.displayed.delete(key);
    profiler.addCounter("game.lod.display.removedForRelease");
  }

  clear(): void {
    profiler.addCounter("game.lod.display.cleared", this.displayed.size);
    for (const tile of this.displayed.values()) this.scene.remove(tile.tileMesh.mesh);
    this.displayed.clear();
  }
}
