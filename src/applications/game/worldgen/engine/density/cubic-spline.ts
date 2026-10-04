// Mirrors net.minecraft.util.CubicSpline (Constant and Multipoint) with DensityFunctions.Spline.Coordinate as the
// coordinate. Java does all of this in `float`, so every intermediate result goes through Math.fround.

import type { DensityNode, DensityVisitor, FunctionContext, StructuralIdLookup } from "./density-function";
import { numberSignature } from "./density-function";
import { densityNodeTypeIndex, noteDensityEvaluation } from "./density-evaluation-counter";

const SPLINE_SEGMENT_TYPE_INDEX = densityNodeTypeIndex("spline_segment");

const fround = Math.fround;

export interface CubicSpline {
  readonly minValue: number;
  readonly maxValue: number;
  apply(context: FunctionContext): number;
  mapAll(visitor: DensityVisitor): CubicSpline;
  collectCoordinates(into: DensityNode[]): void;
  signature(structuralIdOf: StructuralIdLookup): string;
}

export class ConstantSpline implements CubicSpline {
  readonly value: number;

  constructor(value: number) {
    this.value = fround(value);
  }

  get minValue(): number {
    return this.value;
  }

  get maxValue(): number {
    return this.value;
  }

  apply(): number {
    return this.value;
  }

  mapAll(): CubicSpline {
    return this;
  }

  collectCoordinates(): void {}

  signature(): string {
    return numberSignature(this.value);
  }
}

/** CubicSpline.linearExtend: extrapolates past the first or last location using that point's derivative. */
function linearExtend(
  coordinateValue: number,
  locations: Float32Array,
  valueAtPoint: number,
  derivatives: Float32Array,
  pointIndex: number,
): number {
  const derivative = derivatives[pointIndex];
  return derivative === 0 ? valueAtPoint : fround(valueAtPoint + fround(derivative * fround(coordinateValue - locations[pointIndex])));
}

/** Mth.binarySearch(0, length, index -> value < locations[index]) - 1. */
function findIntervalStart(locations: Float32Array, value: number): number {
  let low = 0;
  let remaining = locations.length;
  while (remaining > 0) {
    const half = Math.floor(remaining / 2);
    const middle = low + half;
    if (value < locations[middle]) {
      remaining = half;
    } else {
      low = middle + 1;
      remaining -= half + 1;
    }
  }
  return low - 1;
}

function floatLerp(delta: number, start: number, end: number): number {
  return fround(start + fround(delta * fround(end - start)));
}

export class MultipointSpline implements CubicSpline {
  private constructor(
    readonly coordinate: DensityNode,
    readonly locations: Float32Array,
    readonly values: readonly CubicSpline[],
    readonly derivatives: Float32Array,
    readonly minValue: number,
    readonly maxValue: number,
  ) {}

  /** CubicSpline.Multipoint.create, including its (approximate) bounds computation, ported operation by operation. */
  static create(
    coordinate: DensityNode,
    locations: Float32Array,
    values: readonly CubicSpline[],
    derivatives: Float32Array,
  ): MultipointSpline {
    if (locations.length !== values.length || locations.length !== derivatives.length || locations.length === 0) {
      throw new Error("Spline locations, values and derivatives must be non-empty and of equal length");
    }
    const lastIndex = locations.length - 1;
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    const coordinateMinimum = fround(coordinate.minValue);
    const coordinateMaximum = fround(coordinate.maxValue);
    if (coordinateMinimum < locations[0]) {
      const extendedFromMinimum = linearExtend(coordinateMinimum, locations, values[0].minValue, derivatives, 0);
      const extendedFromMaximum = linearExtend(coordinateMinimum, locations, values[0].maxValue, derivatives, 0);
      minimum = Math.min(minimum, Math.min(extendedFromMinimum, extendedFromMaximum));
      maximum = Math.max(maximum, Math.max(extendedFromMinimum, extendedFromMaximum));
    }
    if (coordinateMaximum > locations[lastIndex]) {
      const extendedFromMinimum = linearExtend(coordinateMaximum, locations, values[lastIndex].minValue, derivatives, lastIndex);
      const extendedFromMaximum = linearExtend(coordinateMaximum, locations, values[lastIndex].maxValue, derivatives, lastIndex);
      minimum = Math.min(minimum, Math.min(extendedFromMinimum, extendedFromMaximum));
      maximum = Math.max(maximum, Math.max(extendedFromMinimum, extendedFromMaximum));
    }
    for (const value of values) {
      minimum = Math.min(minimum, value.minValue);
      maximum = Math.max(maximum, value.maxValue);
    }
    for (let index = 0; index < lastIndex; index++) {
      const intervalWidth = fround(locations[index + 1] - locations[index]);
      const startMinimum = values[index].minValue;
      const startMaximum = values[index].maxValue;
      const endMinimum = values[index + 1].minValue;
      const endMaximum = values[index + 1].maxValue;
      const startDerivative = derivatives[index];
      const endDerivative = derivatives[index + 1];
      if (startDerivative !== 0 || endDerivative !== 0) {
        const scaledStartDerivative = fround(startDerivative * intervalWidth);
        const scaledEndDerivative = fround(endDerivative * intervalWidth);
        const lowestEndpoint = Math.min(startMinimum, endMinimum);
        const highestEndpoint = Math.max(startMaximum, endMaximum);
        const lowFromStart = fround(fround(scaledStartDerivative - endMaximum) + startMinimum);
        const highFromStart = fround(fround(scaledStartDerivative - endMinimum) + startMaximum);
        const lowFromEnd = fround(fround(-scaledEndDerivative + endMinimum) - startMaximum);
        const highFromEnd = fround(fround(-scaledEndDerivative + endMaximum) - startMinimum);
        const lowestBulge = Math.min(lowFromStart, lowFromEnd);
        const highestBulge = Math.max(highFromStart, highFromEnd);
        minimum = Math.min(minimum, fround(lowestEndpoint + fround(0.25 * lowestBulge)));
        maximum = Math.max(maximum, fround(highestEndpoint + fround(0.25 * highestBulge)));
      }
    }
    return new MultipointSpline(coordinate, locations, values, derivatives, minimum, maximum);
  }

  apply(context: FunctionContext): number {
    noteDensityEvaluation(SPLINE_SEGMENT_TYPE_INDEX);
    const coordinateValue = fround(this.coordinate.compute(context));
    const intervalStart = findIntervalStart(this.locations, coordinateValue);
    const lastIndex = this.locations.length - 1;
    if (intervalStart < 0) {
      return linearExtend(coordinateValue, this.locations, this.values[0].apply(context), this.derivatives, 0);
    }
    if (intervalStart === lastIndex) {
      return linearExtend(coordinateValue, this.locations, this.values[lastIndex].apply(context), this.derivatives, lastIndex);
    }
    const startLocation = this.locations[intervalStart];
    const endLocation = this.locations[intervalStart + 1];
    const width = fround(endLocation - startLocation);
    const progress = fround(fround(coordinateValue - startLocation) / width);
    const startDerivative = this.derivatives[intervalStart];
    const endDerivative = this.derivatives[intervalStart + 1];
    const startValue = this.values[intervalStart].apply(context);
    const endValue = this.values[intervalStart + 1].apply(context);
    const valueDelta = fround(endValue - startValue);
    const startTangentOffset = fround(fround(startDerivative * width) - valueDelta);
    const endTangentOffset = fround(fround(-endDerivative * width) + valueDelta);
    const hermiteBulge = fround(fround(progress * fround(1 - progress)) * floatLerp(progress, startTangentOffset, endTangentOffset));
    return fround(floatLerp(progress, startValue, endValue) + hermiteBulge);
  }

  mapAll(visitor: DensityVisitor): CubicSpline {
    return MultipointSpline.create(
      visitor.map(this.coordinate),
      this.locations,
      this.values.map((value) => value.mapAll(visitor)),
      this.derivatives,
    );
  }

  collectCoordinates(into: DensityNode[]): void {
    into.push(this.coordinate);
    for (const value of this.values) value.collectCoordinates(into);
  }

  signature(structuralIdOf: StructuralIdLookup): string {
    const points = this.values.map(
      (value, index) =>
        `${numberSignature(this.locations[index])}:${value.signature(structuralIdOf)}:${numberSignature(this.derivatives[index])}`,
    );
    return `spline(${structuralIdOf(this.coordinate)};${points.join(";")})`;
  }
}
