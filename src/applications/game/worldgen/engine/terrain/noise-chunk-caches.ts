// The per-chunk implementations NoiseChunk substitutes for each density function Marker. Mirrors the inner classes
// NoiseChunk.NoiseInterpolator, FlatCache, Cache2D, CacheOnce and CacheAllInCell, including their quirks: they only
// cache when the context is the NoiseChunk itself, flat_cache samples quart corners at y = 0, and cache_once is
// keyed on the chunk's interpolation counters rather than on the position.

import {
  allocateIdentitySignature,
  type ContextProvider,
  DensityNode,
  type DensityVisitor,
  type FunctionContext,
  SinglePointContext,
} from "../density/density-function";
import { MarkerNode, type MarkerType } from "../density/nodes/structural-nodes";
import { densityCacheTypeIndex, noteDensityCacheHit, noteDensityEvaluation } from "../density/density-evaluation-counter";
import type { CornerColumnSampler } from "./corner-column-sampler";
import type { NoiseChunk } from "./noise-chunk";

const INTERPOLATED_TYPE_INDEX = densityCacheTypeIndex("interpolated");
const FLAT_CACHE_TYPE_INDEX = densityCacheTypeIndex("flat_cache");
const CACHE_2D_TYPE_INDEX = densityCacheTypeIndex("cache_2d");
const CACHE_ONCE_TYPE_INDEX = densityCacheTypeIndex("cache_once");
const CACHE_ALL_IN_CELL_TYPE_INDEX = densityCacheTypeIndex("cache_all_in_cell");

function lerp(delta: number, start: number, end: number): number {
  return start + delta * (end - start);
}

abstract class NoiseChunkCache extends DensityNode {
  private readonly identitySignature: string;

  constructor(
    protected readonly chunk: NoiseChunk,
    readonly markerType: MarkerType,
    readonly wrapped: DensityNode,
  ) {
    super();
    this.identitySignature = allocateIdentitySignature(markerType);
  }

  get minValue(): number {
    return this.wrapped.minValue;
  }

  get maxValue(): number {
    return this.wrapped.maxValue;
  }

  /** MarkerOrMarked.mapAll: rebuild as a plain Marker around the mapped wrapped function. */
  mapAll(visitor: DensityVisitor): DensityNode {
    return visitor.apply(new MarkerNode(this.markerType, visitor.map(this.wrapped)));
  }

  children(): readonly DensityNode[] {
    return [this.wrapped];
  }

  structuralSignature(): string {
    return this.identitySignature;
  }
}

/** NoiseChunk.NoiseInterpolator: trilinear interpolation of cell-corner samples. */
export class NoiseInterpolator extends NoiseChunkCache {
  slice0: Float64Array[];
  slice1: Float64Array[];
  /** The template subtree this interpolator was wired from (before per-chunk caches replaced its markers). */
  templateWrapped: DensityNode | undefined;
  /** Fills corner columns directly when that is exact for the subtree; otherwise slices go through fillArray. */
  cornerSampler: CornerColumnSampler | null = null;
  private noise000 = 0;
  private noise001 = 0;
  private noise100 = 0;
  private noise101 = 0;
  private noise010 = 0;
  private noise011 = 0;
  private noise110 = 0;
  private noise111 = 0;

  constructor(chunk: NoiseChunk, wrapped: DensityNode) {
    super(chunk, "interpolated", wrapped);
    this.slice0 = NoiseInterpolator.allocateSlice(chunk.cellCountY, chunk.cellCountXZ);
    this.slice1 = NoiseInterpolator.allocateSlice(chunk.cellCountY, chunk.cellCountXZ);
  }

  private static allocateSlice(cellCountY: number, cellCountXZ: number): Float64Array[] {
    const slice: Float64Array[] = [];
    for (let index = 0; index <= cellCountXZ; index++) slice.push(new Float64Array(cellCountY + 1));
    return slice;
  }

  selectCellYZ(cellY: number, cellZ: number): void {
    this.noise000 = this.slice0[cellZ][cellY];
    this.noise001 = this.slice0[cellZ + 1][cellY];
    this.noise100 = this.slice1[cellZ][cellY];
    this.noise101 = this.slice1[cellZ + 1][cellY];
    this.noise010 = this.slice0[cellZ][cellY + 1];
    this.noise011 = this.slice0[cellZ + 1][cellY + 1];
    this.noise110 = this.slice1[cellZ][cellY + 1];
    this.noise111 = this.slice1[cellZ + 1][cellY + 1];
  }

  /**
   * The value Java's updateForY / updateForX / updateForZ leave behind, computed on demand from the chunk's current
   * deltas (the same lerps in the same order, so the same doubles).
   */
  private incrementalValue(): number {
    const chunk = this.chunk;
    const deltaY = chunk.deltaY;
    const deltaX = chunk.deltaX;
    const valueXZ00 = lerp(deltaY, this.noise000, this.noise010);
    const valueXZ10 = lerp(deltaY, this.noise100, this.noise110);
    const valueXZ01 = lerp(deltaY, this.noise001, this.noise011);
    const valueXZ11 = lerp(deltaY, this.noise101, this.noise111);
    const valueZ0 = lerp(deltaX, valueXZ00, valueXZ10);
    const valueZ1 = lerp(deltaX, valueXZ01, valueXZ11);
    return lerp(chunk.deltaZ, valueZ0, valueZ1);
  }

  swapSlices(): void {
    const previous = this.slice0;
    this.slice0 = this.slice1;
    this.slice1 = previous;
  }

  compute(context: FunctionContext): number {
    const chunk = this.chunk;
    noteDensityEvaluation(INTERPOLATED_TYPE_INDEX);
    if (context !== chunk) return this.wrapped.compute(context);
    if (!chunk.interpolating) throw new Error("Trying to sample interpolator outside the interpolation loop");
    if (!chunk.fillingCell) {
      noteDensityCacheHit(INTERPOLATED_TYPE_INDEX);
      return this.incrementalValue();
    }
    // Mth.lerp3(dx, dy, dz, ...) = lerp(dz, lerp2(dx, dy, c000, c100, c010, c110), lerp2(dx, dy, c001, c101, c011, c111)).
    const deltaX = chunk.inCellX / chunk.cellWidth;
    const deltaY = chunk.inCellY / chunk.cellHeight;
    const deltaZ = chunk.inCellZ / chunk.cellWidth;
    const nearZ = lerp(deltaY, lerp(deltaX, this.noise000, this.noise100), lerp(deltaX, this.noise010, this.noise110));
    const farZ = lerp(deltaY, lerp(deltaX, this.noise001, this.noise101), lerp(deltaX, this.noise011, this.noise111));
    return lerp(deltaZ, nearZ, farZ);
  }

  fillArray(values: Float64Array, provider: ContextProvider): void {
    if (this.chunk.fillingCell) provider.fillAllDirectly(values, this);
    else this.wrapped.fillArray(values, provider);
  }
}

/** NoiseChunk.FlatCache: the wrapped function sampled once per quart column at (quartX * 4, 0, quartZ * 4). */
export class FlatCache extends NoiseChunkCache {
  readonly values: Float64Array;
  private readonly sideLength: number;

  constructor(chunk: NoiseChunk, wrapped: DensityNode, fill: boolean) {
    super(chunk, "flat_cache", wrapped);
    this.sideLength = chunk.noiseSizeXZ + 1;
    this.values = new Float64Array(this.sideLength * this.sideLength);
    if (fill) {
      for (let quartOffsetX = 0; quartOffsetX < this.sideLength; quartOffsetX++) {
        const blockX = (chunk.firstNoiseX + quartOffsetX) << 2;
        for (let quartOffsetZ = 0; quartOffsetZ < this.sideLength; quartOffsetZ++) {
          const blockZ = (chunk.firstNoiseZ + quartOffsetZ) << 2;
          this.values[quartOffsetX * this.sideLength + quartOffsetZ] = wrapped.compute(new SinglePointContext(blockX, 0, blockZ));
        }
      }
    }
  }

  compute(context: FunctionContext): number {
    const quartOffsetX = (context.blockX >> 2) - this.chunk.firstNoiseX;
    const quartOffsetZ = (context.blockZ >> 2) - this.chunk.firstNoiseZ;
    const sideLength = this.sideLength;
    noteDensityEvaluation(FLAT_CACHE_TYPE_INDEX);
    if (quartOffsetX >= 0 && quartOffsetZ >= 0 && quartOffsetX < sideLength && quartOffsetZ < sideLength) {
      noteDensityCacheHit(FLAT_CACHE_TYPE_INDEX);
      return this.values[quartOffsetX * sideLength + quartOffsetZ];
    }
    return this.wrapped.compute(context);
  }
}

/** NoiseChunk.Cache2D: remembers the last (x, z) column's value, whatever y it was first computed at. */
export class Cache2D extends NoiseChunkCache {
  private lastBlockX = Number.NaN;
  private lastBlockZ = Number.NaN;
  private lastValue = 0;

  constructor(chunk: NoiseChunk, wrapped: DensityNode) {
    super(chunk, "cache_2d", wrapped);
  }

  compute(context: FunctionContext): number {
    const blockX = context.blockX;
    const blockZ = context.blockZ;
    noteDensityEvaluation(CACHE_2D_TYPE_INDEX);
    if (blockX === this.lastBlockX && blockZ === this.lastBlockZ) {
      noteDensityCacheHit(CACHE_2D_TYPE_INDEX);
      return this.lastValue;
    }
    this.lastBlockX = blockX;
    this.lastBlockZ = blockZ;
    const value = this.wrapped.compute(context);
    this.lastValue = value;
    return value;
  }

  fillArray(values: Float64Array, provider: ContextProvider): void {
    this.wrapped.fillArray(values, provider);
  }
}

/** NoiseChunk.CacheOnce: one value per interpolation step, one array per array-fill step. */
export class CacheOnce extends NoiseChunkCache {
  private lastCounter = 0;
  private lastArrayCounter = 0;
  private lastValue = 0;
  private lastArray: Float64Array | null = null;

  constructor(chunk: NoiseChunk, wrapped: DensityNode) {
    super(chunk, "cache_once", wrapped);
  }

  compute(context: FunctionContext): number {
    const chunk = this.chunk;
    noteDensityEvaluation(CACHE_ONCE_TYPE_INDEX);
    if (context !== chunk) return this.wrapped.compute(context);
    if (this.lastArray !== null && this.lastArrayCounter === chunk.arrayInterpolationCounter) {
      noteDensityCacheHit(CACHE_ONCE_TYPE_INDEX);
      return this.lastArray[chunk.arrayIndex];
    }
    if (this.lastCounter === chunk.interpolationCounter) {
      noteDensityCacheHit(CACHE_ONCE_TYPE_INDEX);
      return this.lastValue;
    }
    this.lastCounter = chunk.interpolationCounter;
    const value = this.wrapped.compute(context);
    this.lastValue = value;
    return value;
  }

  fillArray(values: Float64Array, provider: ContextProvider): void {
    const chunk = this.chunk;
    if (this.lastArray !== null && this.lastArrayCounter === chunk.arrayInterpolationCounter) {
      values.set(this.lastArray.subarray(0, values.length));
      return;
    }
    this.wrapped.fillArray(values, provider);
    if (this.lastArray !== null && this.lastArray.length === values.length) this.lastArray.set(values);
    else this.lastArray = values.slice();
    this.lastArrayCounter = chunk.arrayInterpolationCounter;
  }
}

/** NoiseChunk.CacheAllInCell: every block of the current cell, filled in bulk when the cell is selected. */
export class CacheAllInCell extends NoiseChunkCache {
  readonly values: Float64Array;

  constructor(chunk: NoiseChunk, wrapped: DensityNode) {
    super(chunk, "cache_all_in_cell", wrapped);
    this.values = new Float64Array(chunk.cellWidth * chunk.cellWidth * chunk.cellHeight);
  }

  compute(context: FunctionContext): number {
    const chunk = this.chunk;
    noteDensityEvaluation(CACHE_ALL_IN_CELL_TYPE_INDEX);
    if (context !== chunk) return this.wrapped.compute(context);
    if (!chunk.interpolating) throw new Error("Trying to sample interpolator outside the interpolation loop");
    const inCellX = chunk.inCellX;
    const inCellY = chunk.inCellY;
    const inCellZ = chunk.inCellZ;
    const cellWidth = chunk.cellWidth;
    const cellHeight = chunk.cellHeight;
    if (inCellX >= 0 && inCellY >= 0 && inCellZ >= 0 && inCellX < cellWidth && inCellY < cellHeight && inCellZ < cellWidth) {
      noteDensityCacheHit(CACHE_ALL_IN_CELL_TYPE_INDEX);
      return this.values[((cellHeight - 1 - inCellY) * cellWidth + inCellX) * cellWidth + inCellZ];
    }
    return this.wrapped.compute(context);
  }
}
