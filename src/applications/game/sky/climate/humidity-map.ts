import * as THREE from "three";
import { profiler } from "../../profiler";

export const CELL_SIZE_BLOCKS = 64;
export const GRID_CELLS = 48;

const RECENTER_DISTANCE_CELLS = 12;
const NEUTRAL_HUMIDITY_BYTE = 128;
const RETRY_COOLDOWN_MS = 5000;

export type HumidityGridExec = (method: string, params: unknown[]) => Promise<unknown>;

export interface HumidityUniforms {
  humidityOrigin: { value: THREE.Vector2 };
  humidityCellSize: { value: number };
  humidityGridCells: { value: number };
}

export class HumidityMap {
  readonly texture: THREE.DataTexture;
  readonly uniforms: HumidityUniforms;

  private readonly humidityBytes: Uint8Array;
  private readonly execGridSampling: HumidityGridExec;
  private seed: number;
  private seedVersion = 0;
  private isRequestInFlight = false;
  private hasLoadedGrid = false;
  private isDisposed = false;
  private hasLoggedFailure = false;
  private lastFailureAtMs = Number.NEGATIVE_INFINITY;

  constructor(execGridSampling: HumidityGridExec, seed: number) {
    this.execGridSampling = execGridSampling;
    this.seed = seed;
    this.humidityBytes = new Uint8Array(GRID_CELLS * GRID_CELLS).fill(NEUTRAL_HUMIDITY_BYTE);
    this.texture = new THREE.DataTexture(
      this.humidityBytes,
      GRID_CELLS,
      GRID_CELLS,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.unpackAlignment = 1;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    const initialOrigin = this.originForCenterCell(0);
    this.uniforms = {
      humidityOrigin: { value: new THREE.Vector2(initialOrigin, initialOrigin) },
      humidityCellSize: { value: CELL_SIZE_BLOCKS },
      humidityGridCells: { value: GRID_CELLS },
    };
  }

  /** A new world: forgets the old grid (clouds fall back to neutral humidity) and samples the new seed on the next update. */
  setSeed(seed: number): void {
    if (seed === this.seed) return;
    profiler.addCounter("game.sky.humidity.seedChanges");
    this.seed = seed;
    this.seedVersion++;
    this.hasLoadedGrid = false;
    this.lastFailureAtMs = Number.NEGATIVE_INFINITY;
    this.humidityBytes.fill(NEUTRAL_HUMIDITY_BYTE);
    this.texture.needsUpdate = true;
  }

  update(cameraX: number, cameraZ: number): void {
    if (this.isDisposed) return;
    if (this.isRequestInFlight) {
      profiler.addCounter("game.sky.humidity.update.skippedRequestInFlight");
      return;
    }
    if (performance.now() - this.lastFailureAtMs < RETRY_COOLDOWN_MS) {
      profiler.addCounter("game.sky.humidity.update.skippedRetryCooldown");
      return;
    }
    if (this.hasLoadedGrid && !this.isCameraFarFromGridCenter(cameraX, cameraZ)) {
      profiler.addCounter("game.sky.humidity.update.skippedGridStillCentered");
      return;
    }
    const originBlockX = this.originForCenterCell(Math.round(cameraX / CELL_SIZE_BLOCKS));
    const originBlockZ = this.originForCenterCell(Math.round(cameraZ / CELL_SIZE_BLOCKS));
    profiler.addCounter(this.hasLoadedGrid ? "game.sky.humidity.gridRecenterRequests" : "game.sky.humidity.gridFirstLoadRequests");
    void this.requestGrid(originBlockX, originBlockZ);
  }

  /** Bilinear humidity 0..1 at a world position, clamped to the edge outside the grid. */
  humidityAt(worldX: number, worldZ: number): number {
    profiler.addCounter("game.sky.humidity.lookups");
    const cellX = this.clampCellCoordinate((worldX - this.uniforms.humidityOrigin.value.x) / CELL_SIZE_BLOCKS);
    const cellZ = this.clampCellCoordinate((worldZ - this.uniforms.humidityOrigin.value.y) / CELL_SIZE_BLOCKS);
    const lowCellX = Math.min(Math.floor(cellX), GRID_CELLS - 2);
    const lowCellZ = Math.min(Math.floor(cellZ), GRID_CELLS - 2);
    const fractionX = cellX - lowCellX;
    const fractionZ = cellZ - lowCellZ;
    const rowStart = lowCellZ * GRID_CELLS + lowCellX;
    const nextRowStart = rowStart + GRID_CELLS;
    const northBlend =
      this.humidityBytes[rowStart]! * (1 - fractionX) + this.humidityBytes[rowStart + 1]! * fractionX;
    const southBlend =
      this.humidityBytes[nextRowStart]! * (1 - fractionX) + this.humidityBytes[nextRowStart + 1]! * fractionX;
    return (northBlend * (1 - fractionZ) + southBlend * fractionZ) / 255;
  }

  dispose(): void {
    this.isDisposed = true;
    this.texture.dispose();
  }

  private originForCenterCell(centerCell: number): number {
    return (centerCell - GRID_CELLS / 2) * CELL_SIZE_BLOCKS;
  }

  private clampCellCoordinate(cellCoordinate: number): number {
    return Math.min(GRID_CELLS - 1, Math.max(0, cellCoordinate));
  }

  private isCameraFarFromGridCenter(cameraX: number, cameraZ: number): boolean {
    const { x: originX, y: originZ } = this.uniforms.humidityOrigin.value;
    const gridCenterX = originX + (GRID_CELLS / 2) * CELL_SIZE_BLOCKS;
    const gridCenterZ = originZ + (GRID_CELLS / 2) * CELL_SIZE_BLOCKS;
    const distanceLimitBlocks = RECENTER_DISTANCE_CELLS * CELL_SIZE_BLOCKS;
    return Math.abs(cameraX - gridCenterX) > distanceLimitBlocks || Math.abs(cameraZ - gridCenterZ) > distanceLimitBlocks;
  }

  private async requestGrid(originBlockX: number, originBlockZ: number): Promise<void> {
    this.isRequestInFlight = true;
    const requestedSeedVersion = this.seedVersion;
    const requestStartedAtMs = profiler.enabled ? profiler.now() : 0;
    try {
      const result = await this.execGridSampling("sampleHumidityGrid", [
        this.seed,
        originBlockX,
        originBlockZ,
        CELL_SIZE_BLOCKS,
        GRID_CELLS,
      ]);
      if (profiler.enabled) {
        profiler.recordTimer("latency.sky.humidityGrid", profiler.now() - requestStartedAtMs, "latency");
      }
      if (this.isDisposed || requestedSeedVersion !== this.seedVersion) {
        profiler.addCounter("game.sky.humidity.gridsDiscardedStale");
        return;
      }
      if (!(result instanceof Uint8Array) || result.length !== this.humidityBytes.length) {
        throw new Error("Humidity grid result has an unexpected shape");
      }
      const applyToken = profiler.begin("main.sky.climate.applyGrid");
      try {
        this.humidityBytes.set(result);
        this.uniforms.humidityOrigin.value.set(originBlockX, originBlockZ);
        this.texture.needsUpdate = true;
        this.hasLoadedGrid = true;
      } finally {
        profiler.end(applyToken);
      }
      profiler.addCounter("game.sky.humidity.gridsApplied");
      profiler.recordBytes("bytes.sky.humidityGridApplied", result.byteLength);
    } catch (error) {
      profiler.addCounter("game.sky.humidity.gridRequestsFailed");
      this.lastFailureAtMs = performance.now();
      if (!this.hasLoggedFailure) {
        this.hasLoggedFailure = true;
        console.warn("Humidity grid sampling failed, keeping the previous grid", error);
      }
    } finally {
      this.isRequestInFlight = false;
    }
  }
}
