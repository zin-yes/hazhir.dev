// Two-argument density functions. Mirrors DensityFunctions.TwoArgumentSimpleFunction.create, Ap2 (add, mul, min,
// max with their short-circuits on the second argument's bounds) and MulOrAdd (a constant operand folded in).

import {
  type ContextProvider,
  DensityNode,
  type DensityVisitor,
  type FunctionContext,
  numberSignature,
  type StructuralIdLookup,
} from "../density-function";
import { ConstantNode } from "./arithmetic-nodes";

export type TwoArgumentType = "add" | "mul" | "min" | "max";

/** TwoArgumentSimpleFunction.create: computes bounds, and folds a constant operand of add/mul into MulOrAdd. */
export function createTwoArgument(type: TwoArgumentType, first: DensityNode, second: DensityNode): DensityNode {
  const firstMinimum = first.minValue;
  const secondMinimum = second.minValue;
  const firstMaximum = first.maxValue;
  const secondMaximum = second.maxValue;
  let minimum: number;
  let maximum: number;
  switch (type) {
    case "add":
      minimum = firstMinimum + secondMinimum;
      maximum = firstMaximum + secondMaximum;
      break;
    case "max":
      minimum = Math.max(firstMinimum, secondMinimum);
      maximum = Math.max(firstMaximum, secondMaximum);
      break;
    case "min":
      minimum = Math.min(firstMinimum, secondMinimum);
      maximum = Math.min(firstMaximum, secondMaximum);
      break;
    case "mul": {
      const bothPositive = firstMinimum > 0 && secondMinimum > 0;
      const bothNegative = firstMaximum < 0 && secondMaximum < 0;
      minimum = bothPositive
        ? firstMinimum * secondMinimum
        : bothNegative
          ? firstMaximum * secondMaximum
          : Math.min(firstMinimum * secondMaximum, firstMaximum * secondMinimum);
      maximum = bothPositive
        ? firstMaximum * secondMaximum
        : bothNegative
          ? firstMinimum * secondMinimum
          : Math.max(firstMinimum * secondMinimum, firstMaximum * secondMaximum);
      break;
    }
  }
  if (type === "add" || type === "mul") {
    if (first instanceof ConstantNode) return new MulOrAddNode(type, second, minimum, maximum, first.value);
    if (second instanceof ConstantNode) return new MulOrAddNode(type, first, minimum, maximum, second.value);
  }
  return new TWO_ARGUMENT_CLASSES[type](type, first, second, minimum, maximum);
}

/** DensityFunctions.Ap2, split into one subclass per operation so each compute stays monomorphic. */
export abstract class TwoArgumentNode extends DensityNode {
  constructor(
    readonly type: TwoArgumentType,
    readonly first: DensityNode,
    readonly second: DensityNode,
    readonly minValue: number,
    readonly maxValue: number,
  ) {
    super();
  }

  mapAll(visitor: DensityVisitor): DensityNode {
    return visitor.apply(createTwoArgument(this.type, visitor.map(this.first), visitor.map(this.second)));
  }

  children(): readonly DensityNode[] {
    return [this.first, this.second];
  }

  structuralSignature(structuralIdOf: StructuralIdLookup): string {
    return `${this.type}(${structuralIdOf(this.first)},${structuralIdOf(this.second)})`;
  }
}

class AddNode extends TwoArgumentNode {
  compute(context: FunctionContext): number {
    return this.first.compute(context) + this.second.compute(context);
  }

  fillArray(values: Float64Array, provider: ContextProvider): void {
    this.first.fillArray(values, provider);
    const secondValues = new Float64Array(values.length);
    this.second.fillArray(secondValues, provider);
    for (let index = 0; index < values.length; index++) values[index] += secondValues[index];
  }
}

class MulNode extends TwoArgumentNode {
  compute(context: FunctionContext): number {
    const firstValue = this.first.compute(context);
    return firstValue === 0 ? 0 : firstValue * this.second.compute(context);
  }

  fillArray(values: Float64Array, provider: ContextProvider): void {
    this.first.fillArray(values, provider);
    for (let index = 0; index < values.length; index++) {
      const firstValue = values[index];
      values[index] = firstValue === 0 ? 0 : firstValue * this.second.compute(provider.forIndex(index));
    }
  }
}

/** min skips the second argument when the first is already below the second's minimum. */
class MinNode extends TwoArgumentNode {
  compute(context: FunctionContext): number {
    const firstValue = this.first.compute(context);
    return firstValue < this.second.minValue ? firstValue : Math.min(firstValue, this.second.compute(context));
  }

  fillArray(values: Float64Array, provider: ContextProvider): void {
    this.first.fillArray(values, provider);
    const secondMinimum = this.second.minValue;
    for (let index = 0; index < values.length; index++) {
      const firstValue = values[index];
      values[index] =
        firstValue < secondMinimum ? firstValue : Math.min(firstValue, this.second.compute(provider.forIndex(index)));
    }
  }
}

/** max skips the second argument when the first is already above the second's maximum. */
class MaxNode extends TwoArgumentNode {
  compute(context: FunctionContext): number {
    const firstValue = this.first.compute(context);
    return firstValue > this.second.maxValue ? firstValue : Math.max(firstValue, this.second.compute(context));
  }

  fillArray(values: Float64Array, provider: ContextProvider): void {
    this.first.fillArray(values, provider);
    const secondMaximum = this.second.maxValue;
    for (let index = 0; index < values.length; index++) {
      const firstValue = values[index];
      values[index] =
        firstValue > secondMaximum ? firstValue : Math.max(firstValue, this.second.compute(provider.forIndex(index)));
    }
  }
}

const TWO_ARGUMENT_CLASSES = { add: AddNode, mul: MulNode, min: MinNode, max: MaxNode } as const;

/** DensityFunctions.MulOrAdd: add/mul where one operand was a constant. */
export class MulOrAddNode extends DensityNode {
  constructor(
    readonly type: "add" | "mul",
    readonly input: DensityNode,
    readonly minValue: number,
    readonly maxValue: number,
    readonly argument: number,
  ) {
    super();
  }

  private transform(value: number): number {
    return this.type === "add" ? value + this.argument : value * this.argument;
  }

  compute(context: FunctionContext): number {
    return this.transform(this.input.compute(context));
  }

  fillArray(values: Float64Array, provider: ContextProvider): void {
    this.input.fillArray(values, provider);
    for (let index = 0; index < values.length; index++) values[index] = this.transform(values[index]);
  }

  mapAll(visitor: DensityVisitor): DensityNode {
    const mappedInput = visitor.map(this.input);
    const inputMinimum = mappedInput.minValue;
    const inputMaximum = mappedInput.maxValue;
    let minimum: number;
    let maximum: number;
    if (this.type === "add") {
      minimum = inputMinimum + this.argument;
      maximum = inputMaximum + this.argument;
    } else if (this.argument >= 0) {
      minimum = inputMinimum * this.argument;
      maximum = inputMaximum * this.argument;
    } else {
      minimum = inputMaximum * this.argument;
      maximum = inputMinimum * this.argument;
    }
    return visitor.apply(new MulOrAddNode(this.type, mappedInput, minimum, maximum, this.argument));
  }

  children(): readonly DensityNode[] {
    return [this.input];
  }

  structuralSignature(structuralIdOf: StructuralIdLookup): string {
    return `${this.type}Constant(${structuralIdOf(this.input)},${numberSignature(this.minValue)},${numberSignature(this.maxValue)},${numberSignature(this.argument)})`;
  }
}
