// Cell-corner columns of an interpolated density function, computed without NoiseChunk's per-chunk caches.
//
// NoiseChunk fills an interpolator's slices through fillArray over the chunk-wired subtree. For the routers this
// engine uses, every cache inside an interpolated subtree returns exactly the plain function's value at a cell corner:
// flat_cache and cache_2d only wrap y-independent functions (and corners are quart aligned), cache_once is keyed on
// counters that advance with every corner sample, and no interpolator is nested in another. So a corner column is a
// pure function of the corner position, and evaluating the template subtree point by point (with its y-independent
// parts computed once per column) gives the same doubles. Columns on chunk borders are shared by up to four chunks,
// so they are kept in a bounded cache. `isCornerSamplingExact` guards the assumptions per subtree.

import { BlockYDependence, createColumnMemoizedDensity } from "../density/column-memoization";
import type { DensityNode } from "../density/density-function";
import { MarkerNode } from "../density/nodes/structural-nodes";
import { BoundedLruCache } from "../pipeline/bounded-lru-cache";

const MAX_CACHED_BORDER_COLUMNS = 1024;
const CHUNK_SIZE = 16;

/** True when every cache marker inside `root` is value-transparent at cell corners (see the file comment). */
export function isCornerSamplingExact(root: DensityNode): boolean {
  const dependence = new BlockYDependence();
  const visited = new Set<DensityNode>();
  const pending: DensityNode[] = [...root.children()];
  if (root instanceof MarkerNode) return false;
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);
    if (node instanceof MarkerNode) {
      if (node.type === "interpolated" || node.type === "cache_all_in_cell") return false;
      if ((node.type === "flat_cache" || node.type === "cache_2d") && dependence.dependsOnBlockY(node.wrapped)) return false;
    }
    pending.push(...node.children());
  }
  return true;
}

export class CornerColumnSampler {
  private readonly density: DensityNode;
  private readonly probe = { blockX: 0, blockY: 0, blockZ: 0 };
  private readonly borderColumns = new BoundedLruCache<number, Float64Array>(MAX_CACHED_BORDER_COLUMNS);

  constructor(
    templateWrapped: DensityNode,
    private readonly cellNoiseMinY: number,
    private readonly cellHeight: number,
    private readonly sampleCount: number,
  ) {
    this.density = createColumnMemoizedDensity(templateWrapped);
  }

  /** Writes the corner samples at (cornerBlockX, cornerBlockZ), bottom cell first, into `values`. */
  fill(values: Float64Array, cornerBlockX: number, cornerBlockZ: number): void {
    const isOnChunkBorder = cornerBlockX % CHUNK_SIZE === 0 || cornerBlockZ % CHUNK_SIZE === 0;
    if (!isOnChunkBorder) {
      this.evaluate(values, cornerBlockX, cornerBlockZ);
      return;
    }
    const key = (cornerBlockX + 0x2000000) * 0x4000000 + (cornerBlockZ + 0x2000000);
    const cached = this.borderColumns.get(key);
    if (cached !== undefined) {
      values.set(cached);
      return;
    }
    this.evaluate(values, cornerBlockX, cornerBlockZ);
    this.borderColumns.set(key, values.slice(0, this.sampleCount));
  }

  private evaluate(values: Float64Array, cornerBlockX: number, cornerBlockZ: number): void {
    const probe = this.probe;
    probe.blockX = cornerBlockX;
    probe.blockZ = cornerBlockZ;
    for (let index = 0; index < this.sampleCount; index++) {
      probe.blockY = (index + this.cellNoiseMinY) * this.cellHeight;
      values[index] = this.density.compute(probe);
    }
  }
}

const samplersByTemplate = new WeakMap<DensityNode, Map<string, CornerColumnSampler | null>>();

/** One sampler per interpolated template subtree and vertical layout, or null when the subtree needs the chunk caches. */
export function cornerColumnSamplerFor(
  templateWrapped: DensityNode,
  cellNoiseMinY: number,
  cellHeight: number,
  sampleCount: number,
): CornerColumnSampler | null {
  let samplersByLayout = samplersByTemplate.get(templateWrapped);
  if (samplersByLayout === undefined) {
    samplersByLayout = new Map();
    samplersByTemplate.set(templateWrapped, samplersByLayout);
  }
  const layoutKey = `${cellNoiseMinY},${cellHeight},${sampleCount}`;
  let sampler = samplersByLayout.get(layoutKey);
  if (sampler === undefined) {
    sampler = isCornerSamplingExact(templateWrapped)
      ? new CornerColumnSampler(templateWrapped, cellNoiseMinY, cellHeight, sampleCount)
      : null;
    samplersByLayout.set(layoutKey, sampler);
  }
  return sampler;
}
