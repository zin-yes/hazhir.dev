// Quadtree LOD selection by screen-space error, the way Distant Horizons builds its detail rings: a tile is split while
// one of its cells would cover more than `maximumCellPixels` pixels at the tile's nearest point, so the cell size grows
// with distance and each level forms a ring. Previously split tiles only merge once the error drops below the threshold
// times `mergeHysteresis`, which keeps tiles at a ring boundary from flickering between levels while the camera moves.

import { profiler } from "../../profiler";
import { cellSizeOfLevel, LOD_SEA_LEVEL, MAX_LOD_LEVEL, tileSizeOfLevel } from "../core/lod-constants";
import { metricNameOfLevel, perLevelMetricNames } from "../core/lod-level-keys";
import { childAddressesOf, tileBoundsOf, tileKeyOf, type TileAddress, type TileBounds } from "../core/tile-address";
import type { HeightRange } from "../data/tile-surface";

export interface SelectionParameters {
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  /** Pixels per block at distance 1: viewportHeightPixels / (2 * tan(verticalFov / 2)). */
  projectionScale: number;
  /** Largest on-screen size of a level-0 cell before its tile splits. */
  maximumCellPixels: number;
  /**
   * The pixel threshold is multiplied by this per level, so detail is dense next to the real chunks and thins out
   * towards the fogged horizon (1 = the same threshold everywhere).
   */
  thresholdGrowthPerLevel?: number;
  /** Tiles whose nearest point is farther than this (horizontally) are not drawn. */
  radiusBlocks: number;
  minimumLevel: number;
  maximumLevel: number;
  /** Known height range of a tile (from its own or an ancestor's data); a default band is assumed otherwise. */
  heightRangeOf?: (address: TileAddress) => HeightRange | undefined;
  /** Keys of the tiles split by the previous selection. */
  previouslySplit?: ReadonlySet<number>;
  mergeHysteresis?: number;
}

export interface SelectionResult {
  leaves: TileAddress[];
  split: Set<number>;
}

const DEFAULT_HEIGHT_RANGE: HeightRange = { minHeight: LOD_SEA_LEVEL - 30, maxHeight: LOD_SEA_LEVEL + 60 };
const DEFAULT_MERGE_HYSTERESIS = 0.8;

const VISITED_PER_LEVEL = perLevelMetricNames("game.lod.select.visited.");
const SPLIT_PER_LEVEL = perLevelMetricNames("game.lod.select.split.");
const MERGED_PER_LEVEL = perLevelMetricNames("game.lod.select.merged.");
const CULLED_PER_LEVEL = perLevelMetricNames("game.lod.select.culled.");
const BALANCE_SPLIT_PER_LEVEL = perLevelMetricNames("game.lod.select.balanceSplit.");

/** Per-level tallies of one selection, kept only while the profiler is on. */
interface SelectionTally {
  visited: Int32Array;
  split: Int32Array;
  merged: Int32Array;
  culled: Int32Array;
  balanceSplit: Int32Array;
  hysteresisHeld: number;
  newSplits: number;
  balanceVisits: number;
  balanceProbes: number;
  balanceLevelLookups: number;
}

function createSelectionTally(): SelectionTally {
  const levelCount = MAX_LOD_LEVEL + 1;
  return {
    visited: new Int32Array(levelCount),
    split: new Int32Array(levelCount),
    merged: new Int32Array(levelCount),
    culled: new Int32Array(levelCount),
    balanceSplit: new Int32Array(levelCount),
    hysteresisHeld: 0,
    newSplits: 0,
    balanceVisits: 0,
    balanceProbes: 0,
    balanceLevelLookups: 0,
  };
}

function reportPerLevel(names: readonly string[], counts: Int32Array): void {
  for (let level = 0; level < counts.length; level++) {
    if (counts[level]! > 0) profiler.addCounter(metricNameOfLevel(names, level), counts[level]!);
  }
}

function sumOf(counts: Int32Array): number {
  let total = 0;
  for (let level = 0; level < counts.length; level++) total += counts[level]!;
  return total;
}

function reportSelectionTally(tally: SelectionTally, rootCount: number, leafCount: number): void {
  profiler.addCounter("game.lod.select.roots", rootCount);
  profiler.addCounter("game.lod.select.nodesVisited", sumOf(tally.visited));
  profiler.addCounter("game.lod.select.nodesSplit", sumOf(tally.split));
  profiler.addCounter("game.lod.select.nodesNewlySplit", tally.newSplits);
  profiler.addCounter("game.lod.select.nodesMerged", sumOf(tally.merged));
  profiler.addCounter("game.lod.select.childrenCulledByRadius", sumOf(tally.culled));
  profiler.addCounter("game.lod.select.splitHeldByHysteresis", tally.hysteresisHeld);
  profiler.addCounter("game.lod.select.leaves", leafCount);
  profiler.addCounter("game.lod.select.balanceVisits", tally.balanceVisits);
  profiler.addCounter("game.lod.select.balanceProbes", tally.balanceProbes);
  profiler.addCounter("game.lod.select.balanceLevelLookups", tally.balanceLevelLookups);
  profiler.addCounter("game.lod.select.balanceSplits", sumOf(tally.balanceSplit));
  reportPerLevel(VISITED_PER_LEVEL, tally.visited);
  reportPerLevel(SPLIT_PER_LEVEL, tally.split);
  reportPerLevel(MERGED_PER_LEVEL, tally.merged);
  reportPerLevel(CULLED_PER_LEVEL, tally.culled);
  reportPerLevel(BALANCE_SPLIT_PER_LEVEL, tally.balanceSplit);
}

export function horizontalDistanceToBounds(bounds: TileBounds, pointX: number, pointZ: number): number {
  const deltaX = Math.max(bounds.minX - pointX, 0, pointX - bounds.maxX);
  const deltaZ = Math.max(bounds.minZ - pointZ, 0, pointZ - bounds.maxZ);
  return Math.hypot(deltaX, deltaZ);
}

export function distanceToTile(address: TileAddress, parameters: SelectionParameters): number {
  const bounds = tileBoundsOf(address);
  const range = parameters.heightRangeOf?.(address) ?? DEFAULT_HEIGHT_RANGE;
  const horizontal = horizontalDistanceToBounds(bounds, parameters.cameraX, parameters.cameraZ);
  const deltaY = Math.max(range.minHeight - parameters.cameraY, 0, parameters.cameraY - range.maxHeight);
  return Math.hypot(horizontal, deltaY);
}

/** Pixels covered by one cell of the tile at its nearest point. */
export function screenSpaceCellPixels(address: TileAddress, parameters: SelectionParameters): number {
  return (cellSizeOfLevel(address.level) * parameters.projectionScale) / Math.max(distanceToTile(address, parameters), 1);
}

export function rootTilesAround(parameters: SelectionParameters): TileAddress[] {
  const size = tileSizeOfLevel(parameters.maximumLevel);
  const firstX = Math.floor((parameters.cameraX - parameters.radiusBlocks) / size);
  const lastX = Math.floor((parameters.cameraX + parameters.radiusBlocks) / size);
  const firstZ = Math.floor((parameters.cameraZ - parameters.radiusBlocks) / size);
  const lastZ = Math.floor((parameters.cameraZ + parameters.radiusBlocks) / size);
  const roots: TileAddress[] = [];
  for (let tileZ = firstZ; tileZ <= lastZ; tileZ++) {
    for (let tileX = firstX; tileX <= lastX; tileX++) {
      const address = { level: parameters.maximumLevel, tileX, tileZ };
      if (horizontalDistanceToBounds(tileBoundsOf(address), parameters.cameraX, parameters.cameraZ) <= parameters.radiusBlocks) roots.push(address);
    }
  }
  return roots;
}

export function selectTiles(parameters: SelectionParameters): SelectionResult {
  const tally = profiler.enabled ? createSelectionTally() : null;
  const leaves: TileAddress[] = [];
  const split = new Set<number>();
  const hysteresis = parameters.mergeHysteresis ?? DEFAULT_MERGE_HYSTERESIS;
  const growth = parameters.thresholdGrowthPerLevel ?? 1;
  const visit = (address: TileAddress) => {
    const key = tileKeyOf(address.level, address.tileX, address.tileZ);
    const wasSplit = parameters.previouslySplit?.has(key) ?? false;
    const levelThreshold = parameters.maximumCellPixels * growth ** address.level;
    const threshold = wasSplit ? levelThreshold * hysteresis : levelThreshold;
    const canSplit = address.level > parameters.minimumLevel;
    const cellPixels = canSplit ? screenSpaceCellPixels(address, parameters) : 0;
    if (tally !== null) tally.visited[address.level]!++;
    if (canSplit && cellPixels > threshold) {
      split.add(key);
      if (tally !== null) {
        tally.split[address.level]!++;
        if (!wasSplit) tally.newSplits++;
        if (wasSplit && cellPixels <= levelThreshold) tally.hysteresisHeld++;
      }
      for (const child of childAddressesOf(address)) {
        if (horizontalDistanceToBounds(tileBoundsOf(child), parameters.cameraX, parameters.cameraZ) <= parameters.radiusBlocks) visit(child);
        else if (tally !== null) tally.culled[child.level]!++;
      }
      return;
    }
    if (tally !== null && wasSplit) tally.merged[address.level]!++;
    leaves.push(address);
  };
  const traverseToken = profiler.begin("main.lod.select.traverse");
  const roots = rootTilesAround(parameters);
  try {
    for (const root of roots) visit(root);
  } finally {
    profiler.end(traverseToken);
  }
  const balanceToken = profiler.begin("main.lod.select.balance");
  try {
    const balanced = balanceNeighborLevels({ leaves, split }, parameters, tally);
    if (tally !== null) reportSelectionTally(tally, roots.length, balanced.leaves.length);
    return balanced;
  } finally {
    profiler.end(balanceToken);
  }
}

function leafAtPoint(leafKeys: ReadonlySet<number>, pointX: number, pointZ: number, maximumLevel: number, tally: SelectionTally | null): number | undefined {
  for (let level = 0; level <= maximumLevel; level++) {
    if (tally !== null) tally.balanceLevelLookups++;
    const size = tileSizeOfLevel(level);
    if (leafKeys.has(tileKeyOf(level, Math.floor(pointX / size), Math.floor(pointZ / size)))) return level;
  }
  return undefined;
}

/**
 * Splits leaves until edge-adjacent leaves differ by at most one level (a restricted quadtree), so no tile ever borders
 * cells more than twice smaller or larger than its own and ring transitions stay gradual.
 */
function balanceNeighborLevels(selection: SelectionResult, parameters: SelectionParameters, tally: SelectionTally | null): SelectionResult {
  const leafByKey = new Map(selection.leaves.map((leaf) => [tileKeyOf(leaf.level, leaf.tileX, leaf.tileZ), leaf]));
  const leafKeys = new Set(leafByKey.keys());
  const pending = [...selection.leaves];
  while (pending.length > 0) {
    const leaf = pending.pop()!;
    if (tally !== null) tally.balanceVisits++;
    const key = tileKeyOf(leaf.level, leaf.tileX, leaf.tileZ);
    if (!leafKeys.has(key) || leaf.level < 2) continue;
    const bounds = tileBoundsOf(leaf);
    const probeSpacing = tileSizeOfLevel(leaf.level - 2);
    let needsSplit = false;
    for (let along = probeSpacing / 2; along < bounds.maxX - bounds.minX && !needsSplit; along += probeSpacing) {
      const probes = [
        [bounds.minX - 0.5, bounds.minZ + along],
        [bounds.maxX + 0.5, bounds.minZ + along],
        [bounds.minX + along, bounds.minZ - 0.5],
        [bounds.minX + along, bounds.maxZ + 0.5],
      ];
      for (const [probeX, probeZ] of probes) {
        if (tally !== null) tally.balanceProbes++;
        const neighborLevel = leafAtPoint(leafKeys, probeX!, probeZ!, parameters.maximumLevel, tally);
        if (neighborLevel !== undefined && neighborLevel < leaf.level - 1) {
          needsSplit = true;
          break;
        }
      }
    }
    if (!needsSplit) continue;
    leafKeys.delete(key);
    leafByKey.delete(key);
    selection.split.add(key);
    if (tally !== null) tally.balanceSplit[leaf.level]!++;
    for (const child of childAddressesOf(leaf)) {
      if (horizontalDistanceToBounds(tileBoundsOf(child), parameters.cameraX, parameters.cameraZ) > parameters.radiusBlocks) continue;
      const childKey = tileKeyOf(child.level, child.tileX, child.tileZ);
      leafKeys.add(childKey);
      leafByKey.set(childKey, child);
      pending.push(child);
    }
    for (const neighbor of leafByKey.values()) {
      if (neighbor.level > leaf.level && horizontalDistanceToBounds(tileBoundsOf(neighbor), (bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2) <= tileSizeOfLevel(neighbor.level) * 2) {
        pending.push(neighbor);
      }
    }
  }
  return { leaves: [...leafByKey.values()], split: selection.split };
}

/** projectionScale for a perspective camera. */
export function projectionScaleOf(verticalFovDegrees: number, viewportHeightPixels: number): number {
  return viewportHeightPixels / (2 * Math.tan((verticalFovDegrees * Math.PI) / 360));
}
