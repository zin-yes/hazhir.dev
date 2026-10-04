// Exact speedups for evaluating a plain (marker-transparent) density tree many times down one block column: every
// maximal subtree that cannot read the block y is a pure function of (x, z), so it is wrapped in a node that keeps
// its last column's value, and every cache_once subtree keeps its last point's value (it is referenced several times
// per sample). Bounds are delegated unchanged, so rebuilt parents keep Java's min/max short-circuits.

import { DensityNode, DensityVisitor, type FunctionContext, type StructuralIdLookup } from "./density-function";
import { ClampNode, ConstantNode, MappedNode, RangeChoiceNode, YClampedGradientNode } from "./nodes/arithmetic-nodes";
import {
  EndIslandsNode,
  NoiseNode,
  OldBlendedNoiseNode,
  ShiftedNoiseNode,
  ShiftNode,
  WeirdScaledSamplerNode,
} from "./nodes/noise-nodes";
import {
  BeardifierNode,
  BlendConstantNode,
  BlendDensityNode,
  HolderNode,
  MarkerNode,
  SplineNode,
} from "./nodes/structural-nodes";
import { MulOrAddNode, TwoArgumentNode } from "./nodes/two-argument-nodes";

const COMPOSITE_NODE_CLASSES = [
  TwoArgumentNode,
  MulOrAddNode,
  MappedNode,
  ClampNode,
  RangeChoiceNode,
  SplineNode,
  HolderNode,
  MarkerNode,
  BlendDensityNode,
];

function readsBlockYItself(node: DensityNode): boolean | undefined {
  if (node instanceof YClampedGradientNode || node instanceof OldBlendedNoiseNode || node instanceof WeirdScaledSamplerNode) return true;
  if (node instanceof NoiseNode) return node.yScale !== 0;
  if (node instanceof ShiftedNoiseNode) return node.yScale !== 0;
  if (node instanceof ShiftNode) return node.type === "shift";
  if (node instanceof ConstantNode || node instanceof BlendConstantNode || node instanceof BeardifierNode || node instanceof EndIslandsNode) return false;
  if (COMPOSITE_NODE_CLASSES.some((nodeClass) => node instanceof nodeClass)) return false;
  return undefined;
}

/** Conservative y-dependence analysis: unknown node types count as reading y. */
export class BlockYDependence {
  private readonly dependsByNode = new Map<DensityNode, boolean>();

  dependsOnBlockY(node: DensityNode): boolean {
    const known = this.dependsByNode.get(node);
    if (known !== undefined) return known;
    let depends = readsBlockYItself(node) ?? true;
    if (!depends) {
      for (const child of node.children()) {
        if (this.dependsOnBlockY(child)) {
          depends = true;
          break;
        }
      }
    }
    this.dependsByNode.set(node, depends);
    return depends;
  }
}

/** Remembers the value of a y-independent subtree for the last (x, z) it was evaluated at. */
export class LastColumnCacheNode extends DensityNode {
  private lastBlockX = Number.NaN;
  private lastBlockZ = Number.NaN;
  private lastValue = 0;

  constructor(readonly wrapped: DensityNode) {
    super();
  }

  get minValue(): number {
    return this.wrapped.minValue;
  }

  get maxValue(): number {
    return this.wrapped.maxValue;
  }

  compute(context: FunctionContext): number {
    const blockX = context.blockX;
    const blockZ = context.blockZ;
    if (blockX === this.lastBlockX && blockZ === this.lastBlockZ) return this.lastValue;
    const value = this.wrapped.compute(context);
    this.lastBlockX = blockX;
    this.lastBlockZ = blockZ;
    this.lastValue = value;
    return value;
  }

  mapAll(visitor: DensityVisitor): DensityNode {
    return visitor.apply(new LastColumnCacheNode(visitor.map(this.wrapped)));
  }

  children(): readonly DensityNode[] {
    return [this.wrapped];
  }

  structuralSignature(structuralIdOf: StructuralIdLookup): string {
    return `last_column_cache(${structuralIdOf(this.wrapped)})`;
  }
}

/** Remembers the value for the last block position (what cache_once shares between references inside one sample). */
export class LastPointCacheNode extends DensityNode {
  private lastBlockX = Number.NaN;
  private lastBlockY = Number.NaN;
  private lastBlockZ = Number.NaN;
  private lastValue = 0;

  constructor(readonly wrapped: DensityNode) {
    super();
  }

  get minValue(): number {
    return this.wrapped.minValue;
  }

  get maxValue(): number {
    return this.wrapped.maxValue;
  }

  compute(context: FunctionContext): number {
    const blockX = context.blockX;
    const blockY = context.blockY;
    const blockZ = context.blockZ;
    if (blockX === this.lastBlockX && blockY === this.lastBlockY && blockZ === this.lastBlockZ) return this.lastValue;
    const value = this.wrapped.compute(context);
    this.lastBlockX = blockX;
    this.lastBlockY = blockY;
    this.lastBlockZ = blockZ;
    this.lastValue = value;
    return value;
  }

  mapAll(visitor: DensityVisitor): DensityNode {
    return visitor.apply(new LastPointCacheNode(visitor.map(this.wrapped)));
  }

  children(): readonly DensityNode[] {
    return [this.wrapped];
  }

  structuralSignature(structuralIdOf: StructuralIdLookup): string {
    return `last_point_cache(${structuralIdOf(this.wrapped)})`;
  }
}

function isTriviallyCheap(node: DensityNode): boolean {
  return node instanceof ConstantNode || node instanceof BlendConstantNode || node instanceof BeardifierNode || node instanceof EndIslandsNode;
}

class ColumnMemoizingVisitor extends DensityVisitor {
  private readonly dependence = new BlockYDependence();
  private readonly cacheBySource = new Map<DensityNode, DensityNode>();

  map(node: DensityNode): DensityNode {
    if (this.dependence.dependsOnBlockY(node)) {
      if (!(node instanceof MarkerNode && node.type === "cache_once")) return super.map(node);
      let cached = this.cacheBySource.get(node);
      if (cached === undefined) {
        cached = new LastPointCacheNode(this.map(node.wrapped));
        this.cacheBySource.set(node, cached);
      }
      return cached;
    }
    if (isTriviallyCheap(node)) return node;
    let cached = this.cacheBySource.get(node);
    if (cached === undefined) {
      cached = new LastColumnCacheNode(node);
      this.cacheBySource.set(node, cached);
    }
    return cached;
  }

  apply(node: DensityNode): DensityNode {
    return node;
  }
}

/**
 * The same function as `root` (outside a NoiseChunk), with y-independent subtrees cached per column. The result keeps
 * state: use one instance per thread and evaluate column after column for the speedup.
 */
export function createColumnMemoizedDensity(root: DensityNode): DensityNode {
  return new ColumnMemoizingVisitor().map(root);
}
