// Sparse quadtree of real chunk data, one node per LOD tile address that has any: level 0 holds chunk columns at block
// resolution and every level above holds the 2 x 2 downsample of its children (a parent cell counts as real only when
// all four child cells are). Only the updated quadrant of each ancestor is recomputed, so a chunk update costs about
// 256 cell merges per level. Nodes are evicted least recently updated first beyond a memory budget.

import { profiler } from "../../profiler";
import { DIMENSIONS } from "../../profiler/dimensions";
import { MAX_LOD_LEVEL, TILE_CELL_COUNT, TILE_CELLS } from "../core/lod-constants";
import { lodLevelKey } from "../core/lod-level-keys";
import { parentAddressOf, tileKeyOf, type TileAddress } from "../core/tile-address";
import { cellIndexOf, createTileSurface, downsampleChildIntoParent, type TileSurface } from "./tile-surface";

export interface RealSurfaceNode {
  readonly address: TileAddress;
  readonly surface: TileSurface;
  readonly coveredCells: Uint8Array;
  coveredCellCount: number;
  /** Increases on every change, so tiles built from an older version can be detected as stale. */
  version: number;
  lastUpdateSequence: number;
}

/** Bytes held per node: the four surface arrays plus the coverage mask. */
export const REAL_SURFACE_NODE_BYTES = TILE_CELL_COUNT * (2 + 1 + 1 + 2 + 1);

function quadrantOf(tileCoordinate: number): number {
  return ((tileCoordinate % 2) + 2) % 2;
}

export class RealSurfacePyramid {
  private readonly nodes = new Map<number, RealSurfaceNode>();
  private updateSequence = 0;
  private versionCounter = 0;

  constructor(
    private readonly highestLevel: number = MAX_LOD_LEVEL,
    private readonly memoryBudgetBytes: number = 24 * 1024 * 1024,
  ) {}

  get nodeCount(): number {
    return this.nodes.size;
  }

  get byteSize(): number {
    return this.nodes.size * REAL_SURFACE_NODE_BYTES;
  }

  nodeAt(address: TileAddress): RealSurfaceNode | undefined {
    return this.nodes.get(tileKeyOf(address.level, address.tileX, address.tileZ));
  }

  private createNode(address: TileAddress): RealSurfaceNode {
    const node: RealSurfaceNode = {
      address,
      surface: createTileSurface(),
      coveredCells: new Uint8Array(TILE_CELL_COUNT),
      coveredCellCount: 0,
      version: 0,
      lastUpdateSequence: 0,
    };
    this.nodes.set(tileKeyOf(address.level, address.tileX, address.tileZ), node);
    profiler.addCounter("game.lod.pyramid.nodesCreated");
    return node;
  }

  private touch(node: RealSurfaceNode): void {
    node.version = ++this.versionCounter;
    node.lastUpdateSequence = this.updateSequence;
  }

  /**
   * Replaces the level-0 node of a chunk column and refreshes its ancestors. Returns the addresses whose content
   * changed (level 0 up to the highest level), so tiles built from them can be marked stale.
   */
  setColumn(chunkX: number, chunkZ: number, surface: TileSurface, coveredCells: Uint8Array): TileAddress[] {
    this.updateSequence++;
    profiler.addCounter("game.lod.pyramid.columnsSet");
    const changed: TileAddress[] = [];
    let childAddress: TileAddress = { level: 0, tileX: chunkX, tileZ: chunkZ };
    let coveredCount = 0;
    for (let index = 0; index < TILE_CELL_COUNT; index++) coveredCount += coveredCells[index]!;
    let child: RealSurfaceNode | undefined;
    if (coveredCount > 0) {
      child = this.nodeAt(childAddress) ?? this.createNode(childAddress);
      child.surface.heights.set(surface.heights);
      child.surface.topBlocks.set(surface.topBlocks);
      child.surface.sideBlocks.set(surface.sideBlocks);
      child.surface.waterLevels.set(surface.waterLevels);
      child.coveredCells.set(coveredCells);
      child.coveredCellCount = coveredCount;
      this.touch(child);
    } else {
      this.nodes.delete(tileKeyOf(0, chunkX, chunkZ));
      profiler.addCounter("game.lod.pyramid.nodesDeleted");
    }
    changed.push(childAddress);

    for (let level = 1; level <= this.highestLevel; level++) {
      const parentAddress = parentAddressOf(childAddress);
      const parent = this.nodeAt(parentAddress) ?? (child === undefined ? undefined : this.createNode(parentAddress));
      if (parent === undefined) break;
      this.refreshQuadrant(parent, child, quadrantOf(childAddress.tileX), quadrantOf(childAddress.tileZ));
      if (profiler.enabled) {
        profiler.addCounter("game.lod.pyramid.ancestorsRefreshed");
        profiler.recordBreakdown(DIMENSIONS.lodLevel, lodLevelKey(level), { units: (TILE_CELLS / 2) ** 2, calls: 1 });
      }
      changed.push(parentAddress);
      if (parent.coveredCellCount === 0) {
        this.nodes.delete(tileKeyOf(parentAddress.level, parentAddress.tileX, parentAddress.tileZ));
        profiler.addCounter("game.lod.pyramid.nodesDeleted");
        child = undefined;
      } else {
        this.touch(parent);
        child = parent;
      }
      childAddress = parentAddress;
    }
    this.enforceBudget();
    return changed;
  }

  private refreshQuadrant(parent: RealSurfaceNode, child: RealSurfaceNode | undefined, quadrantX: number, quadrantZ: number): void {
    const half = TILE_CELLS / 2;
    if (child !== undefined) downsampleChildIntoParent(child.surface, parent.surface, quadrantX, quadrantZ);
    for (let parentLocalZ = 0; parentLocalZ < half; parentLocalZ++) {
      for (let parentLocalX = 0; parentLocalX < half; parentLocalX++) {
        const parentIndex = cellIndexOf(quadrantX * half + parentLocalX, quadrantZ * half + parentLocalZ);
        let isCovered = 0;
        if (child !== undefined) {
          const childX = parentLocalX * 2;
          const childZ = parentLocalZ * 2;
          isCovered =
            child.coveredCells[cellIndexOf(childX, childZ)]! &
            child.coveredCells[cellIndexOf(childX + 1, childZ)]! &
            child.coveredCells[cellIndexOf(childX, childZ + 1)]! &
            child.coveredCells[cellIndexOf(childX + 1, childZ + 1)]!;
        }
        parent.coveredCellCount += isCovered - parent.coveredCells[parentIndex]!;
        parent.coveredCells[parentIndex] = isCovered;
      }
    }
  }

  private enforceBudget(): void {
    const maximumNodes = Math.floor(this.memoryBudgetBytes / REAL_SURFACE_NODE_BYTES);
    if (this.nodes.size <= maximumNodes) return;
    const token = profiler.begin("main.lod.pyramid.enforceBudget");
    try {
      const evictable = [...this.nodes.entries()]
        .filter(([, node]) => node.lastUpdateSequence !== this.updateSequence)
        .sort(([, first], [, second]) => first.lastUpdateSequence - second.lastUpdateSequence || first.address.level - second.address.level);
      profiler.addCounter("game.lod.pyramid.evictionCandidates", evictable.length);
      let evicted = 0;
      for (const [key] of evictable) {
        if (this.nodes.size <= maximumNodes) break;
        this.nodes.delete(key);
        evicted++;
      }
      profiler.addCounter("game.lod.pyramid.nodesEvicted", evicted);
    } finally {
      profiler.end(token);
    }
  }
}
