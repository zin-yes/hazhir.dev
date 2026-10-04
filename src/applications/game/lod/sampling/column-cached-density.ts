// The router's final density and climate functions for point queries along vertical columns. Holders and markers are
// stripped like the climate sampler does, except the two horizontal caches, which keep a one-column memo the way
// NoiseChunk does: `flat_cache` is evaluated once per quart column at y = 0, `cache_2d` once per block column. A
// vertical search then pays for the expensive 2D splines once and about 5 microseconds per further y instead of 35.

import {
  DensityNode,
  type FunctionContext,
  type NoiseRouter,
  quantizeClimateCoordinate,
  SinglePointContext,
  StripMarkersVisitor,
  type TargetPoint,
} from "../../worldgen/engine/density";
import type { DensityVisitor } from "../../worldgen/engine/density/density-function";
import { MarkerNode } from "../../worldgen/engine/density/nodes/structural-nodes";

let nextColumnCacheIdentity = 1;

class ColumnMemoNode extends DensityNode {
  private lastBlockX = Number.NaN;
  private lastBlockZ = Number.NaN;
  private lastValue = 0;
  private readonly identity = nextColumnCacheIdentity++;

  constructor(
    private readonly wrapped: DensityNode,
    private readonly sampleAtQuartOriginAndYZero: boolean,
  ) {
    super();
  }

  get minValue(): number {
    return this.wrapped.minValue;
  }

  get maxValue(): number {
    return this.wrapped.maxValue;
  }

  compute(context: FunctionContext): number {
    let blockX = context.blockX;
    let blockZ = context.blockZ;
    if (this.sampleAtQuartOriginAndYZero) {
      blockX = (blockX >> 2) << 2;
      blockZ = (blockZ >> 2) << 2;
    }
    if (blockX !== this.lastBlockX || blockZ !== this.lastBlockZ) {
      this.lastBlockX = blockX;
      this.lastBlockZ = blockZ;
      this.lastValue = this.wrapped.compute(this.sampleAtQuartOriginAndYZero ? new SinglePointContext(blockX, 0, blockZ) : context);
    }
    return this.lastValue;
  }

  mapAll(visitor: DensityVisitor): DensityNode {
    return visitor.apply(new ColumnMemoNode(visitor.map(this.wrapped), this.sampleAtQuartOriginAndYZero));
  }

  children(): readonly DensityNode[] {
    return [this.wrapped];
  }

  structuralSignature(): string {
    return `lod_column_memo#${this.identity}`;
  }
}

class ColumnCachingVisitor extends StripMarkersVisitor {
  protected wrapNew(node: DensityNode): DensityNode {
    if (node instanceof MarkerNode && (node.type === "flat_cache" || node.type === "cache_2d")) {
      return new ColumnMemoNode(node.wrapped, node.type === "flat_cache");
    }
    return super.wrapNew(node);
  }
}

export interface ColumnDensity {
  /** Final density at a block position; values above 0 are solid. */
  at(blockX: number, blockY: number, blockZ: number): number;
  /** Number of evaluations so far (for profiler counters and benchmarks). */
  readonly evaluations: number;
}

export interface ColumnClimateSampler {
  /** Same TargetPoint as the engine's Climate.Sampler, reusing the column memos the density search just filled. */
  sample(quartX: number, quartY: number, quartZ: number): TargetPoint;
}

export interface ColumnCachedRouter {
  readonly density: ColumnDensity;
  readonly climate: ColumnClimateSampler;
}

/**
 * Final density and climate functions rewritten by one visitor, so structurally shared subtrees (continentalness,
 * erosion, ridges) become the same memo nodes and the biome lookup of a column costs almost nothing after its height
 * search.
 */
export function createColumnCachedRouter(router: NoiseRouter): ColumnCachedRouter {
  const visitor = new ColumnCachingVisitor();
  const finalDensity = visitor.map(router.finalDensity);
  const temperature = visitor.map(router.temperature);
  const humidity = visitor.map(router.vegetation);
  const continentalness = visitor.map(router.continents);
  const erosion = visitor.map(router.erosion);
  const depth = visitor.map(router.depth);
  const weirdness = visitor.map(router.ridges);
  let evaluations = 0;
  return {
    density: {
      at(blockX, blockY, blockZ) {
        evaluations++;
        return finalDensity.compute(new SinglePointContext(blockX, blockY, blockZ));
      },
      get evaluations() {
        return evaluations;
      },
    },
    climate: {
      sample(quartX, quartY, quartZ) {
        const context = new SinglePointContext(quartX << 2, quartY << 2, quartZ << 2);
        return {
          temperature: quantizeClimateCoordinate(temperature.compute(context)),
          humidity: quantizeClimateCoordinate(humidity.compute(context)),
          continentalness: quantizeClimateCoordinate(continentalness.compute(context)),
          erosion: quantizeClimateCoordinate(erosion.compute(context)),
          depth: quantizeClimateCoordinate(depth.compute(context)),
          weirdness: quantizeClimateCoordinate(weirdness.compute(context)),
        };
      },
    },
  };
}
