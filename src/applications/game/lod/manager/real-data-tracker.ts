// Main-thread bookkeeping of real chunks for the LOD: per loaded chunk a surface summary, per touched column a
// pending re-assembly (batched, a few columns per frame), the real surface pyramid the tiles read their overlays
// from, and the coverage that hides LOD cells under rendered chunks.

import { profiler } from "../../profiler";
import { DIMENSIONS } from "../../profiler/dimensions";
import { CHUNK_SIZE_BLOCKS, MAX_LOD_LEVEL, TILE_CELL_COUNT } from "../core/lod-constants";
import { lodLevelKey } from "../core/lod-level-keys";
import type { TileAddress } from "../core/tile-address";
import { RealChunkCoverage } from "../coverage/real-chunk-coverage";
import { assembleColumnSurface, summarizeChunk, type ChunkSurfaceSummary } from "../data/real-chunk-summary";
import { RealSurfacePyramid } from "../data/real-surface-pyramid";
import type { SerializedTileSurface } from "../worker/lod-tile-builder";

const CHUNK_VOLUME = CHUNK_SIZE_BLOCKS ** 3;
/** Bytes of one chunk summary: two Int16 and two Uint8 arrays of one entry per column. */
const SUMMARY_BYTES = TILE_CELL_COUNT * (2 + 1 + 1 + 2);
/** Bytes copied for one overlay: the four surface arrays and the coverage mask. */
const OVERLAY_SNAPSHOT_BYTES = TILE_CELL_COUNT * (2 + 1 + 1 + 2 + 1);
const COLUMN_KEY_STRIDE = 2 ** 26;
const COLUMN_KEY_OFFSET = 2 ** 25;

function columnKeyOf(chunkX: number, chunkZ: number): number {
  return (chunkX + COLUMN_KEY_OFFSET) * COLUMN_KEY_STRIDE + (chunkZ + COLUMN_KEY_OFFSET);
}

function isSameArray(first: ArrayLike<number>, second: ArrayLike<number>): boolean {
  for (let index = 0; index < first.length; index++) if (first[index] !== second[index]) return false;
  return true;
}

/** Edits below the surface (mining, caves) leave the summary unchanged and must not rebuild any tile. */
function isSameSummary(first: ChunkSurfaceSummary, second: ChunkSurfaceSummary): boolean {
  return (
    isSameArray(first.solidTops, second.solidTops) &&
    isSameArray(first.topBlocks, second.topBlocks) &&
    isSameArray(first.sideBlocks, second.sideBlocks) &&
    isSameArray(first.waterTops, second.waterTops)
  );
}

export interface RealOverlaySnapshot {
  surface: SerializedTileSurface;
  coveredCells: Uint8Array;
  version: number;
}

export class RealDataTracker {
  readonly coverage = new RealChunkCoverage();
  readonly pyramid: RealSurfacePyramid;
  private readonly summariesByColumn = new Map<number, { chunkX: number; chunkZ: number; summaries: Map<number, ChunkSurfaceSummary> }>();
  private readonly dirtyColumns = new Map<number, { chunkX: number; chunkZ: number }>();
  summarizedChunks = 0;
  private summaryCount = 0;

  constructor(realDataBudgetBytes: number, highestLevel: number = MAX_LOD_LEVEL) {
    this.pyramid = new RealSurfacePyramid(highestLevel, realDataBudgetBytes);
  }

  get pendingColumnCount(): number {
    return this.dirtyColumns.size;
  }

  /** Summarizes a chunk's blocks (game layout, 32^3) and queues its column for re-assembly. */
  recordChunkBlocks(chunkX: number, chunkY: number, chunkZ: number, blocks: Uint8Array): void {
    if (blocks.length !== CHUNK_VOLUME) throw new Error(`LOD expected a ${CHUNK_VOLUME}-block chunk, got ${blocks.length}`);
    const token = profiler.begin("main.lod.summarizeChunk");
    try {
      const key = columnKeyOf(chunkX, chunkZ);
      let column = this.summariesByColumn.get(key);
      if (column === undefined) {
        column = { chunkX, chunkZ, summaries: new Map() };
        this.summariesByColumn.set(key, column);
      }
      const summarizeToken = profiler.begin("main.lod.summarizeChunk.scan");
      const summary = summarizeChunk(blocks, chunkY);
      profiler.end(summarizeToken);
      const previous = column.summaries.get(chunkY);
      column.summaries.set(chunkY, summary);
      this.summarizedChunks++;
      if (previous === undefined) this.summaryCount++;
      profiler.addCounter("game.lod.real.chunksSummarized");
      profiler.recordBytes("bytes.lod.real.chunkBlocksRead", blocks.length);
      profiler.recordBytes("bytes.lod.real.summary", SUMMARY_BYTES);
      if (previous !== undefined) {
        const compareToken = profiler.begin("main.lod.summarizeChunk.compare");
        const isUnchanged = isSameSummary(previous, summary);
        profiler.end(compareToken);
        if (isUnchanged) {
          profiler.addCounter("game.lod.real.summariesUnchanged");
          return;
        }
        profiler.addCounter("game.lod.real.summariesChanged");
      }
      if (!this.dirtyColumns.has(key)) profiler.addCounter("game.lod.real.columnsDirtied");
      this.dirtyColumns.set(key, { chunkX, chunkZ });
    } finally {
      profiler.end(token);
    }
  }

  /** Drops the chunk's summary; what the LOD learned from it stays in the pyramid. */
  forgetChunk(chunkX: number, chunkY: number, chunkZ: number): void {
    const key = columnKeyOf(chunkX, chunkZ);
    const column = this.summariesByColumn.get(key);
    if (column === undefined) return;
    if (column.summaries.delete(chunkY)) {
      this.summaryCount--;
      profiler.addCounter("game.lod.real.chunksForgotten");
    }
    if (column.summaries.size === 0) {
      this.summariesByColumn.delete(key);
      this.dirtyColumns.delete(key);
      profiler.addCounter("game.lod.real.columnsForgotten");
    }
  }

  /** Re-assembles up to `maximumColumns` queued columns into the pyramid and coverage; returns the changed addresses. */
  applyPendingColumns(maximumColumns: number): TileAddress[] {
    if (this.dirtyColumns.size === 0) return [];
    const token = profiler.begin("main.lod.applyRealColumns");
    const changed: TileAddress[] = [];
    try {
      let processedColumns = 0;
      for (const [key, { chunkX, chunkZ }] of this.dirtyColumns) {
        if (processedColumns >= maximumColumns) {
          profiler.addCounter("game.lod.real.applyBudgetHits");
          break;
        }
        processedColumns++;
        this.dirtyColumns.delete(key);
        const column = this.summariesByColumn.get(key);
        if (column === undefined) {
          profiler.addCounter("game.lod.real.columnsWithoutSummary");
          continue;
        }
        const assembleToken = profiler.begin("main.lod.applyRealColumns.assemble");
        const assembled = assembleColumnSurface(column.summaries);
        profiler.end(assembleToken);
        const coverageToken = profiler.begin("main.lod.applyRealColumns.coverage");
        this.coverage.setSurfaceChunkRange(chunkX, chunkZ, assembled.lowestSurfaceChunkY, assembled.highestSurfaceChunkY);
        profiler.end(coverageToken);
        if (assembled.coveredCellCount === 0) {
          profiler.addCounter("game.lod.real.columnsWithoutCoveredCells");
          continue;
        }
        profiler.addCounter("game.lod.real.coveredCellsApplied", assembled.coveredCellCount);
        const pyramidToken = profiler.begin("main.lod.applyRealColumns.pyramid");
        const columnChanges = this.pyramid.setColumn(chunkX, chunkZ, assembled.surface, assembled.coveredCells);
        profiler.end(pyramidToken);
        changed.push(...columnChanges);
      }
      profiler.addCounter("game.lod.real.columnsApplied", processedColumns);
      profiler.addCounter("game.lod.real.addressesChanged", changed.length);
    } finally {
      profiler.end(token);
    }
    return changed;
  }

  realDataVersionOf(address: TileAddress): number {
    return this.pyramid.nodeAt(address)?.version ?? 0;
  }

  /** Copies of the pyramid node for a tile build request (transferable), or undefined without real data. */
  overlayFor(address: TileAddress): RealOverlaySnapshot | undefined {
    const node = this.pyramid.nodeAt(address);
    profiler.addCounter("game.lod.overlay.requests");
    if (node === undefined || node.coveredCellCount === 0) {
      profiler.addCounter("game.lod.overlay.misses");
      return undefined;
    }
    const token = profiler.begin("main.lod.overlayFor", DIMENSIONS.lodLevel, lodLevelKey(address.level));
    try {
      profiler.addCounter("game.lod.overlay.hits");
      profiler.addCounter("game.lod.overlay.coveredCells", node.coveredCellCount);
      profiler.recordBytes("bytes.lod.overlay.snapshot", OVERLAY_SNAPSHOT_BYTES);
      return {
        surface: {
          heights: node.surface.heights.slice(),
          topBlocks: node.surface.topBlocks.slice(),
          sideBlocks: node.surface.sideBlocks.slice(),
          waterLevels: node.surface.waterLevels.slice(),
        },
        coveredCells: node.coveredCells.slice(),
        version: node.version,
      };
    } finally {
      profiler.end(token);
    }
  }

  /** Samples the tracker, pyramid and coverage state and flushes their operation counts. Call once per frame. */
  reportToProfiler(): void {
    this.coverage.reportToProfiler();
    if (!profiler.enabled) return;
    profiler.sampleGauge("game.lod.real.pendingColumns", this.dirtyColumns.size);
    profiler.sampleGauge("game.lod.real.summaryColumns", this.summariesByColumn.size);
    profiler.sampleGauge("game.lod.real.summaries", this.summaryCount);
    profiler.sampleGauge("memory.lod.realSummaries", this.summaryCount * SUMMARY_BYTES, "bytes");
    profiler.sampleGauge("game.lod.pyramid.nodes", this.pyramid.nodeCount);
  }
}
