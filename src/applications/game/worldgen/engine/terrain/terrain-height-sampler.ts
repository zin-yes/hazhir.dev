// Heightmap values of the aquifer-free noise fill at single block columns, without filling a chunk.
//
// A filled column's block at (x, y, z) is solid exactly when the cell-filled final density is above 0. That density
// depends only on the corner columns of the cell holding (x, z) (pure functions of the corner position, see
// corner-column-sampler.ts) and on the compiled cell fill, so this sampler evaluates the four corner columns lazily
// from the top down and stops at the first solid block. Results equal the heightmaps of fillChunkColumn's output
// (OCEAN_FLOOR_WG: highest solid block + 1; WORLD_SURFACE_WG: also counts the fluid below sea level).

import { createColumnMemoizedDensity } from "../density/column-memoization";
import { compileDensityFunction, type CompiledDensityFunction, noteCompiledDensityEvaluations } from "../density/density-codegen";
import type { DensityNode } from "../density/density-function";
import type { NoiseRouter } from "../density/router-wiring";
import type { CompiledCellFill } from "./cell-fill-compiler";
import { isCornerSamplingExact } from "./corner-column-sampler";
import { beginColdStart, defineColdStartLabel, endColdStart } from "../profiling/cold-start-ledger";
import { defineHotCounter, noteHot, noteHotAmount } from "../profiling/hot-counters";
import { NoiseChunk } from "./noise-chunk";
import { CacheAllInCell } from "./noise-chunk-caches";

const HEIGHT_QUERIES = defineHotCounter("heightSampler.queries");
const HEIGHT_CELLS_SCANNED = defineHotCounter("heightSampler.cellsScanned");
const HEIGHT_QUERIES_WITHOUT_SOLID_BLOCK = defineHotCounter("heightSampler.queriesWithoutSolidBlock");
const HEIGHT_CORNER_POSITION_HITS = defineHotCounter("heightSampler.cornerPositionHits");
const HEIGHT_CORNER_POSITIONS_CREATED = defineHotCounter("heightSampler.cornerPositionsCreated");
const HEIGHT_CORNER_POSITION_RESETS = defineHotCounter("heightSampler.cornerPositionResets");
const HEIGHT_CORNER_COLUMNS_EXTENDED = defineHotCounter("heightSampler.cornerColumnsExtended");
const HEIGHT_CORNER_SAMPLES = defineHotCounter("heightSampler.cornerSamples");
const HEIGHT_CORNER_COLUMNS_REUSED = defineHotCounter("heightSampler.cornerColumnsReused");
const SAMPLER_CREATE_LABEL = defineColdStartLabel("heightSampler.create");

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
  private readonly cornerDensities: CompiledDensityFunction[][];
  private readonly cornerPositions = new Map<number, CornerPosition>();
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
      Array.from({ length: CORNER_SLOTS }, () => compileDensityFunction(createColumnMemoizedDensity(template))),
    );
    this.corners = new Float64Array(this.interpolatorCount * CORNERS_PER_INTERPOLATOR);
  }

  /** A sampler for the router's aquifer-free fill, or undefined when its final density cannot be sampled this way. */
  static create(router: NoiseRouter, settings: TerrainHeightSamplerSettings): TerrainHeightSampler | undefined {
    const coldStartToken = beginColdStart(SAMPLER_CREATE_LABEL);
    try {
      return TerrainHeightSampler.createUntimed(router, settings);
    } finally {
      endColdStart(SAMPLER_CREATE_LABEL, coldStartToken);
    }
  }

  private static createUntimed(router: NoiseRouter, settings: TerrainHeightSamplerSettings): TerrainHeightSampler | undefined {
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
    noteHot(HEIGHT_QUERIES);
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
      noteHot(HEIGHT_CELLS_SCANNED);
      this.gatherCorners(cellY);
      const cellStartBlockY = (cellY + this.cellNoiseMinY) * CELL_HEIGHT;
      this.compiledFill(this.cellValues, this.corners, cellStartBlockY);
      for (let inCellY = CELL_HEIGHT - 1; inCellY >= 0; inCellY--) {
        const valueIndex = ((CELL_HEIGHT - 1 - inCellY) * CELL_WIDTH + inCellX) * CELL_WIDTH + inCellZ;
        if (this.cellValues[valueIndex]! > 0) return cellStartBlockY + inCellY + 1;
      }
    }
    noteHot(HEIGHT_QUERIES_WITHOUT_SOLID_BLOCK);
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
      const evaluateDensity = this.cornerDensities[interpolatorIndex]![cornerSlot]!;
      for (let index = lowestFilledIndex - 1; index >= cellY; index--) {
        values[index] = evaluateDensity(position.blockX, (index + this.cellNoiseMinY) * CELL_HEIGHT, position.blockZ);
      }
      position.lowestFilledIndexByInterpolator[interpolatorIndex] = cellY;
      noteHot(HEIGHT_CORNER_COLUMNS_EXTENDED);
      noteHotAmount(HEIGHT_CORNER_SAMPLES, lowestFilledIndex - cellY);
      noteCompiledDensityEvaluations(evaluateDensity, lowestFilledIndex - cellY, lowestFilledIndex === this.cellCountY + 1 ? 1 : 0);
    } else {
      noteHot(HEIGHT_CORNER_COLUMNS_REUSED);
    }
    return values;
  }

  private cornerPositionAt(cornerBlockX: number, cornerBlockZ: number): CornerPosition {
    const key = (cornerBlockX + 0x2000000) * 0x4000000 + (cornerBlockZ + 0x2000000);
    let position = this.cornerPositions.get(key);
    if (position === undefined) {
      if (this.cornerPositions.size >= MAX_CACHED_CORNER_POSITIONS) {
        this.cornerPositions.clear();
        noteHot(HEIGHT_CORNER_POSITION_RESETS);
      }
      position = new CornerPosition(cornerBlockX, cornerBlockZ, this.interpolatorCount, this.cellCountY + 1);
      this.cornerPositions.set(key, position);
      noteHot(HEIGHT_CORNER_POSITIONS_CREATED);
    } else {
      noteHot(HEIGHT_CORNER_POSITION_HITS);
    }
    return position;
  }
}
