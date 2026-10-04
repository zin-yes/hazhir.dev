// Main-thread bookkeeping of real chunks for the LOD: per loaded chunk a surface summary, per touched column a
// pending re-assembly (batched, a few columns per frame), the real surface pyramid the tiles read their overlays
// from, and the coverage that hides LOD cells under rendered chunks.

import { profiler } from "../../profiler";
import { CHUNK_SIZE_BLOCKS, MAX_LOD_LEVEL } from "../core/lod-constants";
import type { TileAddress } from "../core/tile-address";
import { RealChunkCoverage } from "../coverage/real-chunk-coverage";
import { assembleColumnSurface, summarizeChunk, type ChunkSurfaceSummary } from "../data/real-chunk-summary";
import { RealSurfacePyramid } from "../data/real-surface-pyramid";
import type { SerializedTileSurface } from "../worker/lod-tile-builder";

const CHUNK_VOLUME = CHUNK_SIZE_BLOCKS ** 3;
const COLUMN_KEY_STRIDE = 2 ** 26;
const COLUMN_KEY_OFFSET = 2 ** 25;

function columnKeyOf(chunkX: number, chunkZ: number): number {
  return (chunkX + COLUMN_KEY_OFFSET) * COLUMN_KEY_STRIDE + (chunkZ + COLUMN_KEY_OFFSET);
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
      column.summaries.set(chunkY, summarizeChunk(blocks, chunkY));
      this.dirtyColumns.set(key, { chunkX, chunkZ });
      this.summarizedChunks++;
    } finally {
      profiler.end(token);
    }
  }

  /** Drops the chunk's summary; what the LOD learned from it stays in the pyramid. */
  forgetChunk(chunkX: number, chunkY: number, chunkZ: number): void {
    const key = columnKeyOf(chunkX, chunkZ);
    const column = this.summariesByColumn.get(key);
    if (column === undefined) return;
    column.summaries.delete(chunkY);
    if (column.summaries.size === 0) {
      this.summariesByColumn.delete(key);
      this.dirtyColumns.delete(key);
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
        if (processedColumns >= maximumColumns) break;
        processedColumns++;
        this.dirtyColumns.delete(key);
        const column = this.summariesByColumn.get(key);
        if (column === undefined) continue;
        const assembled = assembleColumnSurface(column.summaries);
        this.coverage.setSurfaceChunkRange(chunkX, chunkZ, assembled.lowestSurfaceChunkY, assembled.highestSurfaceChunkY);
        if (assembled.coveredCellCount === 0) continue;
        changed.push(...this.pyramid.setColumn(chunkX, chunkZ, assembled.surface, assembled.coveredCells));
      }
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
    if (node === undefined || node.coveredCellCount === 0) return undefined;
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
  }
}
