// Wiring-level density functions. Mirrors DensityFunctions.HolderHolder, Marker (interpolated, flat_cache, cache_2d,
// cache_once, cache_all_in_cell), Spline, BlendAlpha, BlendOffset, BlendDensity and BeardifierMarker / Beardifier.

import type { CubicSpline } from "../cubic-spline";
import {
  type ContextProvider,
  DensityNode,
  type DensityVisitor,
  type FunctionContext,
  numberSignature,
  type StructuralIdLookup,
} from "../density-function";
import { densityNodeTypeIndex, noteDensityEvaluation } from "../density-evaluation-counter";

const HOLDER_TYPE_INDEX = densityNodeTypeIndex("holder");
const MARKER_TYPE_INDEX = densityNodeTypeIndex("marker");
const SPLINE_TYPE_INDEX = densityNodeTypeIndex("spline");
const BLEND_CONSTANT_TYPE_INDEX = densityNodeTypeIndex("blend_constant");
const BLEND_DENSITY_TYPE_INDEX = densityNodeTypeIndex("blend_density");
const BEARDIFIER_TYPE_INDEX = densityNodeTypeIndex("beardifier");

/** DensityFunctions.HolderHolder: what every HOLDER_HELPER_CODEC field decodes to. NoiseChunk and Climate unwrap it. */
export class HolderNode extends DensityNode {
  constructor(readonly target: DensityNode) {
    super();
  }

  get minValue(): number {
    return this.target.minValue;
  }

  get maxValue(): number {
    return this.target.maxValue;
  }

  compute(context: FunctionContext): number {
    noteDensityEvaluation(HOLDER_TYPE_INDEX);
    return this.target.compute(context);
  }

  fillArray(values: Float64Array, provider: ContextProvider): void {
    this.target.fillArray(values, provider);
  }

  mapAll(visitor: DensityVisitor): DensityNode {
    return visitor.apply(new HolderNode(visitor.map(this.target)));
  }

  children(): readonly DensityNode[] {
    return [this.target];
  }

  structuralSignature(structuralIdOf: StructuralIdLookup): string {
    return `holder(${structuralIdOf(this.target)})`;
  }
}

export type MarkerType = "interpolated" | "flat_cache" | "cache_2d" | "cache_once" | "cache_all_in_cell";

export const MARKER_TYPES: readonly MarkerType[] = ["interpolated", "flat_cache", "cache_2d", "cache_once", "cache_all_in_cell"];

/** DensityFunctions.Marker: transparent outside a NoiseChunk, which replaces each one with its cache implementation. */
export class MarkerNode extends DensityNode {
  constructor(
    readonly type: MarkerType,
    readonly wrapped: DensityNode,
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
    noteDensityEvaluation(MARKER_TYPE_INDEX);
    return this.wrapped.compute(context);
  }

  fillArray(values: Float64Array, provider: ContextProvider): void {
    this.wrapped.fillArray(values, provider);
  }

  mapAll(visitor: DensityVisitor): DensityNode {
    return visitor.apply(new MarkerNode(this.type, visitor.map(this.wrapped)));
  }

  children(): readonly DensityNode[] {
    return [this.wrapped];
  }

  structuralSignature(structuralIdOf: StructuralIdLookup): string {
    return `${this.type}(${structuralIdOf(this.wrapped)})`;
  }
}

/** DensityFunctions.Spline: a float CubicSpline whose coordinates are density functions. */
export class SplineNode extends DensityNode {
  constructor(readonly spline: CubicSpline) {
    super();
  }

  get minValue(): number {
    return this.spline.minValue;
  }

  get maxValue(): number {
    return this.spline.maxValue;
  }

  compute(context: FunctionContext): number {
    noteDensityEvaluation(SPLINE_TYPE_INDEX);
    return this.spline.apply(context);
  }

  mapAll(visitor: DensityVisitor): DensityNode {
    return visitor.apply(new SplineNode(this.spline.mapAll(visitor)));
  }

  children(): readonly DensityNode[] {
    const coordinates: DensityNode[] = [];
    this.spline.collectCoordinates(coordinates);
    return coordinates;
  }

  structuralSignature(structuralIdOf: StructuralIdLookup): string {
    return this.spline.signature(structuralIdOf);
  }
}

/** blend_alpha (1) and blend_offset (0): what they evaluate to without a Blender (fresh, non-legacy chunks). */
export class BlendConstantNode extends DensityNode {
  readonly value: number;

  constructor(readonly type: "blend_alpha" | "blend_offset") {
    super();
    this.value = type === "blend_alpha" ? 1.0 : 0.0;
  }

  get minValue(): number {
    return this.value;
  }

  get maxValue(): number {
    return this.value;
  }

  compute(): number {
    noteDensityEvaluation(BLEND_CONSTANT_TYPE_INDEX);
    return this.value;
  }

  fillArray(values: Float64Array): void {
    values.fill(this.value);
  }

  mapAll(visitor: DensityVisitor): DensityNode {
    return visitor.apply(this);
  }

  children(): readonly DensityNode[] {
    return [];
  }

  structuralSignature(): string {
    return this.type;
  }
}

/** DensityFunctions.BlendDensity: identity under Blender.empty(), but with infinite bounds like Java. */
export class BlendDensityNode extends DensityNode {
  readonly minValue = Number.NEGATIVE_INFINITY;
  readonly maxValue = Number.POSITIVE_INFINITY;

  constructor(readonly input: DensityNode) {
    super();
  }

  compute(context: FunctionContext): number {
    noteDensityEvaluation(BLEND_DENSITY_TYPE_INDEX);
    return this.input.compute(context);
  }

  fillArray(values: Float64Array, provider: ContextProvider): void {
    this.input.fillArray(values, provider);
    // TransformerWithContext still visits every index (forIndex has side effects on NoiseChunk counters).
    for (let index = 0; index < values.length; index++) provider.forIndex(index);
  }

  mapAll(visitor: DensityVisitor): DensityNode {
    return visitor.apply(new BlendDensityNode(visitor.map(this.input)));
  }

  children(): readonly DensityNode[] {
    return [this.input];
  }

  structuralSignature(structuralIdOf: StructuralIdLookup): string {
    return `blend_density(${structuralIdOf(this.input)})`;
  }
}

/**
 * minecraft:beardifier. As decoded it is BeardifierMarker (constant 0, bounds 0). Inside a NoiseChunk it becomes the
 * structure Beardifier, whose bounds are infinite; structures are not generated yet, so it still evaluates to 0.
 */
export class BeardifierNode extends DensityNode {
  readonly minValue: number;
  readonly maxValue: number;

  constructor(readonly insideNoiseChunk: boolean) {
    super();
    this.minValue = insideNoiseChunk ? Number.NEGATIVE_INFINITY : 0;
    this.maxValue = insideNoiseChunk ? Number.POSITIVE_INFINITY : 0;
  }

  compute(): number {
    noteDensityEvaluation(BEARDIFIER_TYPE_INDEX);
    return 0;
  }

  fillArray(values: Float64Array, provider: ContextProvider): void {
    if (this.insideNoiseChunk) provider.fillAllDirectly(values, this);
    else values.fill(0);
  }

  mapAll(visitor: DensityVisitor): DensityNode {
    return visitor.apply(this);
  }

  children(): readonly DensityNode[] {
    return [];
  }

  structuralSignature(): string {
    return `beardifier(${numberSignature(this.minValue)})`;
  }
}
