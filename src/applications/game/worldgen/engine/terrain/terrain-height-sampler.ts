// Heightmap values of the aquifer-free noise fill at single block columns, without filling a chunk.
//
// A filled column's block at (x, y, z) is solid exactly when the cell-filled final density is above 0. That density
// depends only on the corner columns of the cell holding (x, z) (pure functions of the corner position, see
// corner-column-sampler.ts) and on the compiled cell fill, so this sampler evaluates the four corner columns lazily
// from the top down and stops at the first solid block. Results equal the heightmaps of fillChunkColumn's output
// (OCEAN_FLOOR_WG: highest solid block + 1; WORLD_SURFACE_WG: also counts the fluid below sea level).

import { createColumnMemoizedDensity } from "../density/column-memoization";
import type { DensityNode } from "../density/density-function";
import type { NoiseRouter } from "../density/router-wiring";
import type { CompiledCellFill } from "./cell-fill-compiler";
import { isCornerSamplingExact } from "./corner-column-sampler";
import { NoiseChunk } from "./noise-chunk";
import { CacheAllInCell } from "./noise-chunk-caches";

const CELL_WIDTH = 4;
const CELL_HEIGHT = 4;
const CORNERS_PER_INTERPOLATOR = 8;
const CORNER_SLOTS = 4;
const MAX_CACHED_CORNER_POSITIONS = 4096;

export interface TerrainHeightSamplerSettings {
  minY: number;
  height: number;
  seaLevel: number;
}

/** The corner columns of every interpolated function at one corner position, filled lazily from the top down. */
class CornerPosition {
  readonly valuesByInterpolator: Float64Array[];
  /** Lowest sample index filled so far, per interpolator; samples at and above it are valid. */
  readonly lowestFilledIndexByInterpolator: Int32Array;

  constructor(
    readonly blockX: number,
    readonly blockZ: number,
    interpolatorCount: number,
    sampleCount: number,
  ) {
    this.valuesByInterpolator = Array.from({ length: interpolatorCount }, () => new Float64Array(sampleCount));
    this.lowestFilledIndexByInterpolator = new Int32Array(interpolatorCount).fill(sampleCount);
  }
}

export class TerrainHeightSampler {
  private readonly cellNoiseMinY: number;
  private readonly cellCountY: number;
  private readonly interpolatorCount: number;
  /** One memoized density per interpolator and corner slot, so alternating corners keep their own column caches. */
  private readonly cornerDensities: DensityNode[][];
  private readonly cornerPositions = new Map<number, CornerPosition>();
  private readonly probe = { blockX: 0, blockY: 0, blockZ: 0 };
  private readonly corners: Float64Array;
  private readonly cellValues = new Float64Array(CELL_WIDTH * CELL_WIDTH * CELL_HEIGHT);
  private readonly cellCorners: CornerPosition[] = [];

  private constructor(
    private readonly settings: TerrainHeightSamplerSettings,
    private readonly compiledFill: CompiledCellFill,
    interpolatorTemplates: readonly DensityNode[],
  ) {
    this.cellNoiseMinY = Math.floor(settings.minY / CELL_HEIGHT);
    this.cellCountY = Math.floor(settings.height / CELL_HEIGHT);
    this.interpolatorCount = interpolatorTemplates.length;
    this.cornerDensities = interpolatorTemplates.map((template) =>
      Array.from({ length: CORNER_SLOTS }, () => createColumnMemoizedDensity(template)),
    );
    this.corners = new Float64Array(this.interpolatorCount * CORNERS_PER_INTERPOLATOR);
  }

  /** A sampler for the router's aquifer-free fill, or undefined when its final density cannot be sampled this way. */
  static create(router: NoiseRouter, settings: TerrainHeightSamplerSettings): TerrainHeightSampler | undefined {
    const chunk = new NoiseChunk(router, {
      cellCountXZ: 4,
      firstBlockX: 0,
      firstBlockZ: 0,
      minY: settings.minY,
      height: settings.height,
      cellWidth: CELL_WIDTH,
      cellHeight: CELL_HEIGHT,
      wiredRouterFields: ["finalDensity"],
    });
    const cellCache = chunk.finalDensityForFill;
    if (!(cellCache instanceof CacheAllInCell) || cellCache.compiledFill === undefined) return undefined;
    const interpolatorTemplates: DensityNode[] = [];
    for (const interpolator of cellCache.compiledFillInterpolators) {
      const template = interpolator.templateWrapped;
      if (template === undefined || !isCornerSamplingExact(template)) return undefined;
      interpolatorTemplates.push(template);
    }
    return new TerrainHeightSampler(settings, cellCache.compiledFill, interpolatorTemplates);
  }

  /** Heightmap OCEAN_FLOOR_WG (first free y above the highest solid block, or minY). */
  oceanFloorHeight(blockX: number, blockZ: number): number {
    const cellX = Math.floor(blockX / CELL_WIDTH);
    const cellZ = Math.floor(blockZ / CELL_WIDTH);
    const inCellX = blockX - cellX * CELL_WIDTH;
    const inCellZ = blockZ - cellZ * CELL_WIDTH;
    const cellCorners = this.cellCorners;
    cellCorners[0] = this.cornerPositionAt(cellX * CELL_WIDTH, cellZ * CELL_WIDTH);
    cellCorners[1] = this.cornerPositionAt((cellX + 1) * CELL_WIDTH, cellZ * CELL_WIDTH);
    cellCorners[2] = this.cornerPositionAt(cellX * CELL_WIDTH, (cellZ + 1) * CELL_WIDTH);
    cellCorners[3] = this.cornerPositionAt((cellX + 1) * CELL_WIDTH, (cellZ + 1) * CELL_WIDTH);
    for (let cellY = this.cellCountY - 1; cellY >= 0; cellY--) {
      this.gatherCorners(cellY);
      const cellStartBlockY = (cellY + this.cellNoiseMinY) * CELL_HEIGHT;
      this.compiledFill(this.cellValues, this.corners, cellStartBlockY);
      for (let inCellY = CELL_HEIGHT - 1; inCellY >= 0; inCellY--) {
        const valueIndex = ((CELL_HEIGHT - 1 - inCellY) * CELL_WIDTH + inCellX) * CELL_WIDTH + inCellZ;
        if (this.cellValues[valueIndex]! > 0) return cellStartBlockY + inCellY + 1;
      }
    }
    return this.settings.minY;
  }

  /** Heightmap WORLD_SURFACE_WG: below sea level every open block of the aquifer-free fill holds fluid. */
  worldSurfaceHeight(blockX: number, blockZ: number): number {
    return Math.max(this.oceanFloorHeight(blockX, blockZ), this.settings.seaLevel);
  }

  /** Corner layout of the compiled fill, per interpolator: 000, 100, 010, 110, 001, 101, 011, 111 (x, y, z bits). */
  private gatherCorners(cellY: number): void {
    const [cornerX0Z0, cornerX1Z0, cornerX0Z1, cornerX1Z1] = this.cellCorners as [CornerPosition, CornerPosition, CornerPosition, CornerPosition];
    for (let interpolatorIndex = 0; interpolatorIndex < this.interpolatorCount; interpolatorIndex++) {
      const base = interpolatorIndex * CORNERS_PER_INTERPOLATOR;
      const valuesX0Z0 = this.cornerValues(cornerX0Z0, interpolatorIndex, 0, cellY);
      const valuesX1Z0 = this.cornerValues(cornerX1Z0, interpolatorIndex, 1, cellY);
      const valuesX0Z1 = this.cornerValues(cornerX0Z1, interpolatorIndex, 2, cellY);
      const valuesX1Z1 = this.cornerValues(cornerX1Z1, interpolatorIndex, 3, cellY);
      this.corners[base] = valuesX0Z0[cellY]!;
      this.corners[base + 1] = valuesX1Z0[cellY]!;
      this.corners[base + 2] = valuesX0Z0[cellY + 1]!;
      this.corners[base + 3] = valuesX1Z0[cellY + 1]!;
      this.corners[base + 4] = valuesX0Z1[cellY]!;
      this.corners[base + 5] = valuesX1Z1[cellY]!;
      this.corners[base + 6] = valuesX0Z1[cellY + 1]!;
      this.corners[base + 7] = valuesX1Z1[cellY + 1]!;
    }
  }

  /** The corner column of one interpolator, computed down to sample `cellY` (samples cellY and cellY + 1 are needed). */
  private cornerValues(position: CornerPosition, interpolatorIndex: number, cornerSlot: number, cellY: number): Float64Array {
    const values = position.valuesByInterpolator[interpolatorIndex]!;
    const lowestFilledIndex = position.lowestFilledIndexByInterpolator[interpolatorIndex]!;
    if (lowestFilledIndex > cellY) {
      const density = this.cornerDensities[interpolatorIndex]![cornerSlot]!;
      const probe = this.probe;
      probe.blockX = position.blockX;
      probe.blockZ = position.blockZ;
      for (let index = lowestFilledIndex - 1; index >= cellY; index--) {
        probe.blockY = (index + this.cellNoiseMinY) * CELL_HEIGHT;
        values[index] = density.compute(probe);
      }
      position.lowestFilledIndexByInterpolator[interpolatorIndex] = cellY;
    }
    return values;
  }

  private cornerPositionAt(cornerBlockX: number, cornerBlockZ: number): CornerPosition {
    const key = (cornerBlockX + 0x2000000) * 0x4000000 + (cornerBlockZ + 0x2000000);
    let position = this.cornerPositions.get(key);
    if (position === undefined) {
      if (this.cornerPositions.size >= MAX_CACHED_CORNER_POSITIONS) this.cornerPositions.clear();
      position = new CornerPosition(cornerBlockX, cornerBlockZ, this.interpolatorCount, this.cellCountY + 1);
      this.cornerPositions.set(key, position);
    }
    return position;
  }
}
