// Core density function contracts. Mirrors net.minecraft.world.level.levelgen.DensityFunction:
// compute (single point), fillArray (bulk, driven by a ContextProvider), mapAll (bottom-up rewrite by a Visitor)
// and the minValue/maxValue bounds that MIN/MAX short-circuits and spline bounds depend on.

export interface FunctionContext {
  readonly blockX: number;
  readonly blockY: number;
  readonly blockZ: number;
}

export interface DensityFunction {
  compute(context: FunctionContext): number;
  readonly minValue: number;
  readonly maxValue: number;
}

/** Mirrors DensityFunction.ContextProvider: NoiseChunk and its slice filler implement it. */
export interface ContextProvider {
  forIndex(arrayIndex: number): FunctionContext;
  fillAllDirectly(values: Float64Array, densityFunction: DensityNode): void;
}

export class SinglePointContext implements FunctionContext {
  constructor(
    readonly blockX: number,
    readonly blockY: number,
    readonly blockZ: number,
  ) {}
}

/** Returns a structural id for a node, assigned by a StructuralInterner (equal ids = Java record equality). */
export type StructuralIdLookup = (node: DensityNode) => number;

export abstract class DensityNode implements DensityFunction {
  abstract readonly minValue: number;
  abstract readonly maxValue: number;
  abstract compute(context: FunctionContext): number;

  fillArray(values: Float64Array, provider: ContextProvider): void {
    provider.fillAllDirectly(values, this);
  }

  /** Rebuilds this node with every child mapped through `visitor.map`, then hands the result to `visitor.apply`. */
  abstract mapAll(visitor: DensityVisitor): DensityNode;

  /** Direct density-function children, including spline coordinates (used by analyses and chunk wiring). */
  abstract children(): readonly DensityNode[];

  /** Key that is equal for two nodes exactly when Java's record `equals` would consider them equal. */
  abstract structuralSignature(structuralIdOf: StructuralIdLookup): string;
}

let nextIdentityNumber = 1;

/** Unique token for nodes whose Java counterpart is a plain class (identity equality), e.g. NoiseChunk caches. */
export function allocateIdentitySignature(prefix: string): string {
  return `${prefix}#${nextIdentityNumber++}`;
}

/** Distinguishes -0.0 from 0.0 the way Double.equals does. */
export function numberSignature(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

/** Interns structural signatures to small integers so equality checks on huge trees stay cheap. */
export class StructuralInterner {
  private readonly idsBySignature = new Map<string, number>();
  private readonly idsByNode = new Map<DensityNode, number>();
  private readonly lookup: StructuralIdLookup = (node) => this.idOf(node);

  idOf(node: DensityNode): number {
    const known = this.idsByNode.get(node);
    if (known !== undefined) return known;
    const signature = node.structuralSignature(this.lookup);
    let id = this.idsBySignature.get(signature);
    if (id === undefined) {
      id = this.idsBySignature.size + 1;
      this.idsBySignature.set(signature, id);
    }
    this.idsByNode.set(node, id);
    return id;
  }
}

/**
 * Mirrors DensityFunction.Visitor. `map` is the traversal entry (Java's `child.mapAll(visitor)`); the result for a
 * given source node is cached, which is equivalent to Java's re-traversal because every visitor here is
 * deterministic and memoizes `apply` by structural equality.
 */
export abstract class DensityVisitor {
  private readonly mappedBySource = new Map<DensityNode, DensityNode>();

  map(node: DensityNode): DensityNode {
    let mapped = this.mappedBySource.get(node);
    if (mapped === undefined) {
      mapped = node.mapAll(this);
      this.mappedBySource.set(node, mapped);
    }
    return mapped;
  }

  abstract apply(node: DensityNode): DensityNode;

  visitNoise(noise: NoiseHolder): NoiseHolder {
    return noise;
  }
}

/** A visitor whose `apply` is `wrapped.computeIfAbsent(node, this::wrapNew)` over a HashMap of records. */
export abstract class MemoizingDensityVisitor extends DensityVisitor {
  private readonly interner = new StructuralInterner();
  private readonly resultsByStructuralId = new Map<number, DensityNode>();

  apply(node: DensityNode): DensityNode {
    const structuralId = this.interner.idOf(node);
    let result = this.resultsByStructuralId.get(structuralId);
    if (result === undefined) {
      result = this.wrapNew(node);
      this.resultsByStructuralId.set(structuralId, result);
    }
    return result;
  }

  protected abstract wrapNew(node: DensityNode): DensityNode;
}

/** The subset of engine/noise NormalNoise that density functions need. */
export interface NormalNoiseSampler {
  getValue(x: number, y: number, z: number): number;
  readonly maxValue: number;
}

/** Mirrors DensityFunction.NoiseHolder: a noise id plus the instance wired in by RandomState (null before wiring). */
export class NoiseHolder {
  constructor(
    readonly noiseId: string,
    readonly noise: NormalNoiseSampler | null,
  ) {}

  getValue(x: number, y: number, z: number): number {
    return this.noise === null ? 0 : this.noise.getValue(x, y, z);
  }

  get maxValue(): number {
    return this.noise === null ? 2.0 : this.noise.maxValue;
  }

  get signature(): string {
    return this.noise === null ? `noise(${this.noiseId})` : `noise(${this.noiseId},wired)`;
  }
}
