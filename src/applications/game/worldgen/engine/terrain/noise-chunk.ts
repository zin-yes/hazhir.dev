// Mirrors net.minecraft.world.level.levelgen.NoiseChunk: wires a NoiseRouter into per-chunk caches and drives the
// cell interpolation loop (slices of cell-corner samples along x, cells selected top-down, blocks updated y/x/z).
// The NoiseChunk object is itself the FunctionContext and ContextProvider, exactly like Java, because the caches
// only cache when they are evaluated with the chunk as context.

import {
  type ContextProvider,
  type DensityNode,
  DensityVisitor,
  type FunctionContext,
} from "../density/density-function";
import { MarkerNode } from "../density/nodes/structural-nodes";
import type { NoiseRouter } from "../density/router-wiring";
import { CacheAllInCell, Cache2D, CacheOnce, FlatCache, NoiseInterpolator } from "./noise-chunk-caches";
import { cornerColumnSamplerFor } from "./corner-column-sampler";
import { getNoiseChunkTemplate, type NoiseChunkTemplate } from "./noise-chunk-template";

export interface NoiseChunkSettings {
  /** Number of cells along x and z (16 / cellWidth for a full chunk). */
  cellCountXZ: number;
  firstBlockX: number;
  firstBlockZ: number;
  minY: number;
  height: number;
  /** size_horizontal * 4 and size_vertical * 4 from the noise settings (4 and 4 for the overworld). */
  cellWidth?: number;
  cellHeight?: number;
  /** Router functions to wire (Java wires all of them; unwired ones cost nothing). Default: all. */
  wiredRouterFields?: readonly (keyof NoiseRouter)[];
}

/** The per-chunk visitor: replaces each template Marker with its cache; marker-free subtrees are shared as-is. */
class NoiseChunkWiringVisitor extends DensityVisitor {
  constructor(
    private readonly chunk: NoiseChunk,
    private readonly template: NoiseChunkTemplate,
  ) {
    super();
  }

  map(node: DensityNode): DensityNode {
    if (!this.template.containsMarker(node)) return node;
    const mapped = super.map(node);
    if (node instanceof MarkerNode && node.type === "interpolated" && mapped instanceof NoiseInterpolator) {
      mapped.templateWrapped ??= node.wrapped;
    }
    return mapped;
  }

  apply(node: DensityNode): DensityNode {
    return node instanceof MarkerNode ? this.chunk.createCache(node) : node;
  }
}

export class NoiseChunk implements FunctionContext, ContextProvider {
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly cellCountXZ: number;
  readonly cellCountY: number;
  readonly cellNoiseMinY: number;
  readonly firstCellX: number;
  readonly firstCellZ: number;
  readonly firstNoiseX: number;
  readonly firstNoiseZ: number;
  readonly noiseSizeXZ: number;

  readonly interpolators: NoiseInterpolator[] = [];
  readonly cellCaches: CacheAllInCell[] = [];
  /** Router functions wired into this chunk (only the requested fields are populated). */
  readonly router: Partial<NoiseRouter> = {};
  /** cacheAllInCell(add(finalDensity, beardifier)): what doFill feeds to the aquifer. */
  readonly finalDensityForFill: DensityNode;

  interpolating = false;
  fillingCell = false;
  cellStartBlockX = 0;
  cellStartBlockY = 0;
  cellStartBlockZ = 0;
  inCellX = 0;
  inCellY = 0;
  inCellZ = 0;
  interpolationCounter = 0;
  arrayInterpolationCounter = 0;
  arrayIndex = 0;
  /** The interpolation deltas of the last updateForY / updateForX / updateForZ (interpolators read them lazily). */
  deltaY = 0;
  deltaX = 0;
  deltaZ = 0;

  readonly sliceFillingContextProvider: ContextProvider;

  constructor(routerSource: NoiseRouter, settings: NoiseChunkSettings) {
    this.cellWidth = settings.cellWidth ?? 4;
    this.cellHeight = settings.cellHeight ?? 4;
    this.cellCountXZ = settings.cellCountXZ;
    this.cellCountY = Math.floor(settings.height / this.cellHeight);
    this.cellNoiseMinY = Math.floor(settings.minY / this.cellHeight);
    this.firstCellX = Math.floor(settings.firstBlockX / this.cellWidth);
    this.firstCellZ = Math.floor(settings.firstBlockZ / this.cellWidth);
    this.firstNoiseX = settings.firstBlockX >> 2;
    this.firstNoiseZ = settings.firstBlockZ >> 2;
    this.noiseSizeXZ = (this.cellCountXZ * this.cellWidth) >> 2;

    const chunk = this;
    this.sliceFillingContextProvider = {
      forIndex(arrayIndex: number): FunctionContext {
        chunk.cellStartBlockY = (arrayIndex + chunk.cellNoiseMinY) * chunk.cellHeight;
        chunk.interpolationCounter++;
        chunk.inCellY = 0;
        chunk.arrayIndex = arrayIndex;
        return chunk;
      },
      fillAllDirectly(values: Float64Array, densityFunction: DensityNode): void {
        for (let index = 0; index < chunk.cellCountY + 1; index++) {
          chunk.cellStartBlockY = (index + chunk.cellNoiseMinY) * chunk.cellHeight;
          chunk.interpolationCounter++;
          chunk.inCellY = 0;
          chunk.arrayIndex = index;
          values[index] = densityFunction.compute(chunk);
        }
      },
    };

    const template = getNoiseChunkTemplate(routerSource);
    const wiringVisitor = new NoiseChunkWiringVisitor(this, template);
    const wiredFields = new Set(settings.wiredRouterFields ?? (Object.keys(template.router) as (keyof NoiseRouter)[]));
    for (const fieldName of template.fieldOrder) {
      if (wiredFields.has(fieldName)) this.router[fieldName] = wiringVisitor.map(template.router[fieldName]);
    }
    this.finalDensityForFill = wiringVisitor.map(template.finalDensityForFill);
    for (const interpolator of this.interpolators) {
      if (interpolator.templateWrapped === undefined) continue;
      interpolator.cornerSampler = cornerColumnSamplerFor(interpolator.templateWrapped, this.cellNoiseMinY, this.cellHeight, this.cellCountY + 1);
    }
  }

  get blockX(): number {
    return this.cellStartBlockX + this.inCellX;
  }

  get blockY(): number {
    return this.cellStartBlockY + this.inCellY;
  }

  get blockZ(): number {
    return this.cellStartBlockZ + this.inCellZ;
  }

  /** NoiseChunk.wrapNew for markers. */
  createCache(marker: MarkerNode): DensityNode {
    switch (marker.type) {
      case "interpolated": {
        const interpolator = new NoiseInterpolator(this, marker.wrapped);
        this.interpolators.push(interpolator);
        return interpolator;
      }
      case "flat_cache":
        return new FlatCache(this, marker.wrapped, true);
      case "cache_2d":
        return new Cache2D(this, marker.wrapped);
      case "cache_once":
        return new CacheOnce(this, marker.wrapped);
      case "cache_all_in_cell": {
        const cellCache = new CacheAllInCell(this, marker.wrapped);
        this.cellCaches.push(cellCache);
        return cellCache;
      }
    }
  }

  /** NoiseChunk.forIndex: index within a cell, ordered y (top first), then x, then z. */
  forIndex(arrayIndex: number): FunctionContext {
    const inCellZ = arrayIndex % this.cellWidth;
    const xyIndex = Math.floor(arrayIndex / this.cellWidth);
    this.inCellX = xyIndex % this.cellWidth;
    this.inCellY = this.cellHeight - 1 - Math.floor(xyIndex / this.cellWidth);
    this.inCellZ = inCellZ;
    this.arrayIndex = arrayIndex;
    return this;
  }

  fillAllDirectly(values: Float64Array, densityFunction: DensityNode): void {
    this.arrayIndex = 0;
    for (let inCellY = this.cellHeight - 1; inCellY >= 0; inCellY--) {
      this.inCellY = inCellY;
      for (let inCellX = 0; inCellX < this.cellWidth; inCellX++) {
        this.inCellX = inCellX;
        for (let inCellZ = 0; inCellZ < this.cellWidth; inCellZ++) {
          this.inCellZ = inCellZ;
          values[this.arrayIndex++] = densityFunction.compute(this);
        }
      }
    }
  }

  private fillSlice(firstSlice: boolean, cellX: number): void {
    this.cellStartBlockX = cellX * this.cellWidth;
    this.inCellX = 0;
    for (let cellOffsetZ = 0; cellOffsetZ < this.cellCountXZ + 1; cellOffsetZ++) {
      this.cellStartBlockZ = (this.firstCellZ + cellOffsetZ) * this.cellWidth;
      this.inCellZ = 0;
      this.arrayInterpolationCounter++;
      for (const interpolator of this.interpolators) {
        const column = (firstSlice ? interpolator.slice0 : interpolator.slice1)[cellOffsetZ]!;
        const cornerSampler = interpolator.cornerSampler;
        if (cornerSampler === null) interpolator.fillArray(column, this.sliceFillingContextProvider);
        else cornerSampler.fill(column, this.cellStartBlockX, this.cellStartBlockZ);
      }
    }
    this.arrayInterpolationCounter++;
  }

  initializeForFirstCellX(): void {
    if (this.interpolating) throw new Error("Staring interpolation twice");
    this.interpolating = true;
    this.interpolationCounter = 0;
    this.fillSlice(true, this.firstCellX);
  }

  advanceCellX(cellOffsetX: number): void {
    this.fillSlice(false, this.firstCellX + cellOffsetX + 1);
    this.cellStartBlockX = (this.firstCellX + cellOffsetX) * this.cellWidth;
  }

  selectCellYZ(cellY: number, cellOffsetZ: number): void {
    for (const interpolator of this.interpolators) interpolator.selectCellYZ(cellY, cellOffsetZ);
    this.fillingCell = true;
    this.cellStartBlockY = (cellY + this.cellNoiseMinY) * this.cellHeight;
    this.cellStartBlockZ = (this.firstCellZ + cellOffsetZ) * this.cellWidth;
    this.arrayInterpolationCounter++;
    for (const cellCache of this.cellCaches) cellCache.wrapped.fillArray(cellCache.values, this);
    this.arrayInterpolationCounter++;
    this.fillingCell = false;
  }

  updateForY(blockY: number, deltaY: number): void {
    this.inCellY = blockY - this.cellStartBlockY;
    this.deltaY = deltaY;
  }

  updateForX(blockX: number, deltaX: number): void {
    this.inCellX = blockX - this.cellStartBlockX;
    this.deltaX = deltaX;
  }

  updateForZ(blockZ: number, deltaZ: number): void {
    this.inCellZ = blockZ - this.cellStartBlockZ;
    this.interpolationCounter++;
    this.deltaZ = deltaZ;
  }

  swapSlices(): void {
    for (const interpolator of this.interpolators) interpolator.swapSlices();
  }

  stopInterpolation(): void {
    if (!this.interpolating) throw new Error("Staring interpolation twice");
    this.interpolating = false;
  }
}
