// Pure single-input and leaf density functions. Mirrors DensityFunctions.Constant, Mapped, Clamp, RangeChoice and
// YClampedGradient, including their bounds (the two-argument family lives in two-argument-nodes.ts).

import {
  type ContextProvider,
  DensityNode,
  type DensityVisitor,
  type FunctionContext,
  numberSignature,
  type StructuralIdLookup,
} from "../density-function";

export class ConstantNode extends DensityNode {
  constructor(readonly value: number) {
    super();
  }

  get minValue(): number {
    return this.value;
  }

  get maxValue(): number {
    return this.value;
  }

  compute(): number {
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
    return `constant(${numberSignature(this.value)})`;
  }
}

export type MappedType = "abs" | "square" | "cube" | "half_negative" | "quarter_negative" | "squeeze";

function transformMapped(type: MappedType, value: number): number {
  switch (type) {
    case "abs":
      return Math.abs(value);
    case "square":
      return value * value;
    case "cube":
      return value * value * value;
    case "half_negative":
      return value > 0 ? value : value * 0.5;
    case "quarter_negative":
      return value > 0 ? value : value * 0.25;
    case "squeeze": {
      const clamped = clamp(value, -1, 1);
      return clamped / 2 - (clamped * clamped * clamped) / 24;
    }
  }
}

/** Mth.clamp(double, double, double). */
export function clamp(value: number, minimum: number, maximum: number): number {
  return value < minimum ? minimum : Math.min(value, maximum);
}

/** DensityFunctions.Mapped.create. Note the Java quirk: abs/square use max(0, untransformed input minimum). */
export function createMapped(type: MappedType, input: DensityNode): MappedNode {
  const inputMinimum = input.minValue;
  const transformedMinimum = transformMapped(type, inputMinimum);
  const transformedMaximum = transformMapped(type, input.maxValue);
  return type !== "abs" && type !== "square"
    ? new MappedNode(type, input, transformedMinimum, transformedMaximum)
    : new MappedNode(type, input, Math.max(0, inputMinimum), Math.max(transformedMinimum, transformedMaximum));
}

export class MappedNode extends DensityNode {
  constructor(
    readonly type: MappedType,
    readonly input: DensityNode,
    readonly minValue: number,
    readonly maxValue: number,
  ) {
    super();
  }

  compute(context: FunctionContext): number {
    return transformMapped(this.type, this.input.compute(context));
  }

  fillArray(values: Float64Array, provider: ContextProvider): void {
    this.input.fillArray(values, provider);
    for (let index = 0; index < values.length; index++) values[index] = transformMapped(this.type, values[index]);
  }

  mapAll(visitor: DensityVisitor): DensityNode {
    return visitor.apply(createMapped(this.type, visitor.map(this.input)));
  }

  children(): readonly DensityNode[] {
    return [this.input];
  }

  structuralSignature(structuralIdOf: StructuralIdLookup): string {
    return `${this.type}(${structuralIdOf(this.input)},${numberSignature(this.minValue)},${numberSignature(this.maxValue)})`;
  }
}

/** DensityFunctions.Clamp (JSON fields "min"/"max" become the bounds). */
export class ClampNode extends DensityNode {
  constructor(
    readonly input: DensityNode,
    readonly minValue: number,
    readonly maxValue: number,
  ) {
    super();
  }

  compute(context: FunctionContext): number {
    return clamp(this.input.compute(context), this.minValue, this.maxValue);
  }

  fillArray(values: Float64Array, provider: ContextProvider): void {
    this.input.fillArray(values, provider);
    for (let index = 0; index < values.length; index++) values[index] = clamp(values[index], this.minValue, this.maxValue);
  }

  mapAll(visitor: DensityVisitor): DensityNode {
    return visitor.apply(new ClampNode(visitor.map(this.input), this.minValue, this.maxValue));
  }

  children(): readonly DensityNode[] {
    return [this.input];
  }

  structuralSignature(structuralIdOf: StructuralIdLookup): string {
    return `clamp(${structuralIdOf(this.input)},${numberSignature(this.minValue)},${numberSignature(this.maxValue)})`;
  }
}

/** DensityFunctions.RangeChoice. */
export class RangeChoiceNode extends DensityNode {
  readonly minValue: number;
  readonly maxValue: number;

  constructor(
    readonly input: DensityNode,
    readonly minInclusive: number,
    readonly maxExclusive: number,
    readonly whenInRange: DensityNode,
    readonly whenOutOfRange: DensityNode,
  ) {
    super();
    this.minValue = Math.min(whenInRange.minValue, whenOutOfRange.minValue);
    this.maxValue = Math.max(whenInRange.maxValue, whenOutOfRange.maxValue);
  }

  compute(context: FunctionContext): number {
    const inputValue = this.input.compute(context);
    return inputValue >= this.minInclusive && inputValue < this.maxExclusive
      ? this.whenInRange.compute(context)
      : this.whenOutOfRange.compute(context);
  }

  fillArray(values: Float64Array, provider: ContextProvider): void {
    this.input.fillArray(values, provider);
    for (let index = 0; index < values.length; index++) {
      const inputValue = values[index];
      values[index] =
        inputValue >= this.minInclusive && inputValue < this.maxExclusive
          ? this.whenInRange.compute(provider.forIndex(index))
          : this.whenOutOfRange.compute(provider.forIndex(index));
    }
  }

  mapAll(visitor: DensityVisitor): DensityNode {
    return visitor.apply(
      new RangeChoiceNode(
        visitor.map(this.input),
        this.minInclusive,
        this.maxExclusive,
        visitor.map(this.whenInRange),
        visitor.map(this.whenOutOfRange),
      ),
    );
  }

  children(): readonly DensityNode[] {
    return [this.input, this.whenInRange, this.whenOutOfRange];
  }

  structuralSignature(structuralIdOf: StructuralIdLookup): string {
    return `range_choice(${structuralIdOf(this.input)},${numberSignature(this.minInclusive)},${numberSignature(this.maxExclusive)},${structuralIdOf(this.whenInRange)},${structuralIdOf(this.whenOutOfRange)})`;
  }
}

/** Mth.clampedMap(double, double, double, double, double). */
export function clampedMap(value: number, fromInput: number, toInput: number, fromOutput: number, toOutput: number): number {
  const delta = (value - fromInput) / (toInput - fromInput);
  if (delta < 0) return fromOutput;
  if (delta > 1) return toOutput;
  return fromOutput + delta * (toOutput - fromOutput);
}

/** DensityFunctions.YClampedGradient. */
export class YClampedGradientNode extends DensityNode {
  readonly minValue: number;
  readonly maxValue: number;

  constructor(
    readonly fromY: number,
    readonly toY: number,
    readonly fromValue: number,
    readonly toValue: number,
  ) {
    super();
    this.minValue = Math.min(fromValue, toValue);
    this.maxValue = Math.max(fromValue, toValue);
  }

  compute(context: FunctionContext): number {
    return clampedMap(context.blockY, this.fromY, this.toY, this.fromValue, this.toValue);
  }

  mapAll(visitor: DensityVisitor): DensityNode {
    return visitor.apply(this);
  }

  children(): readonly DensityNode[] {
    return [];
  }

  structuralSignature(): string {
    return `y_clamped_gradient(${this.fromY},${this.toY},${numberSignature(this.fromValue)},${numberSignature(this.toValue)})`;
  }
}
