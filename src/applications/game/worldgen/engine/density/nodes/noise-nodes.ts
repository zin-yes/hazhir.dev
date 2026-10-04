// Noise-sampling density functions. Mirrors DensityFunctions.Noise, ShiftedNoise, ShiftA, ShiftB, Shift,
// WeirdScaledSampler (with NoiseRouterData.QuantizedSpaghettiRarity), EndIslandDensityFunction (stubbed) and
// the BlendedNoise density function (minecraft:old_blended_noise).

import {
  allocateIdentitySignature,
  type ContextProvider,
  DensityNode,
  type DensityVisitor,
  type FunctionContext,
  type NoiseHolder,
  numberSignature,
  type StructuralIdLookup,
} from "../density-function";

export class NoiseNode extends DensityNode {
  constructor(
    readonly noise: NoiseHolder,
    readonly xzScale: number,
    readonly yScale: number,
  ) {
    super();
  }

  get minValue(): number {
    return -this.noise.maxValue;
  }

  get maxValue(): number {
    return this.noise.maxValue;
  }

  compute(context: FunctionContext): number {
    return this.noise.getValue(context.blockX * this.xzScale, context.blockY * this.yScale, context.blockZ * this.xzScale);
  }

  mapAll(visitor: DensityVisitor): DensityNode {
    return visitor.apply(new NoiseNode(visitor.visitNoise(this.noise), this.xzScale, this.yScale));
  }

  children(): readonly DensityNode[] {
    return [];
  }

  structuralSignature(): string {
    return `noise(${this.noise.signature},${numberSignature(this.xzScale)},${numberSignature(this.yScale)})`;
  }
}

export class ShiftedNoiseNode extends DensityNode {
  constructor(
    readonly shiftX: DensityNode,
    readonly shiftY: DensityNode,
    readonly shiftZ: DensityNode,
    readonly xzScale: number,
    readonly yScale: number,
    readonly noise: NoiseHolder,
  ) {
    super();
  }

  get minValue(): number {
    return -this.noise.maxValue;
  }

  get maxValue(): number {
    return this.noise.maxValue;
  }

  compute(context: FunctionContext): number {
    const sampleX = context.blockX * this.xzScale + this.shiftX.compute(context);
    const sampleY = context.blockY * this.yScale + this.shiftY.compute(context);
    const sampleZ = context.blockZ * this.xzScale + this.shiftZ.compute(context);
    return this.noise.getValue(sampleX, sampleY, sampleZ);
  }

  mapAll(visitor: DensityVisitor): DensityNode {
    return visitor.apply(
      new ShiftedNoiseNode(
        visitor.map(this.shiftX),
        visitor.map(this.shiftY),
        visitor.map(this.shiftZ),
        this.xzScale,
        this.yScale,
        visitor.visitNoise(this.noise),
      ),
    );
  }

  children(): readonly DensityNode[] {
    return [this.shiftX, this.shiftY, this.shiftZ];
  }

  structuralSignature(structuralIdOf: StructuralIdLookup): string {
    return `shifted_noise(${structuralIdOf(this.shiftX)},${structuralIdOf(this.shiftY)},${structuralIdOf(this.shiftZ)},${numberSignature(this.xzScale)},${numberSignature(this.yScale)},${this.noise.signature})`;
  }
}

/** shift_a samples (x, 0, z), shift_b samples (z, x, 0), shift samples (x, y, z); all at quarter scale, times 4. */
export type ShiftType = "shift_a" | "shift_b" | "shift";

export class ShiftNode extends DensityNode {
  constructor(
    readonly type: ShiftType,
    readonly offsetNoise: NoiseHolder,
  ) {
    super();
  }

  get minValue(): number {
    return -this.maxValue;
  }

  get maxValue(): number {
    return this.offsetNoise.maxValue * 4.0;
  }

  private sampleShift(x: number, y: number, z: number): number {
    return this.offsetNoise.getValue(x * 0.25, y * 0.25, z * 0.25) * 4.0;
  }

  compute(context: FunctionContext): number {
    switch (this.type) {
      case "shift_a":
        return this.sampleShift(context.blockX, 0, context.blockZ);
      case "shift_b":
        return this.sampleShift(context.blockZ, context.blockX, 0);
      case "shift":
        return this.sampleShift(context.blockX, context.blockY, context.blockZ);
    }
  }

  mapAll(visitor: DensityVisitor): DensityNode {
    return visitor.apply(new ShiftNode(this.type, visitor.visitNoise(this.offsetNoise)));
  }

  children(): readonly DensityNode[] {
    return [];
  }

  structuralSignature(): string {
    return `${this.type}(${this.offsetNoise.signature})`;
  }
}

export type RarityValueMapper = "type_1" | "type_2";

/** NoiseRouterData.QuantizedSpaghettiRarity.getSpaghettiRarity3D (type_1). */
export function spaghettiRarity3D(value: number): number {
  if (value < -0.5) return 0.75;
  if (value < 0.0) return 1.0;
  return value < 0.5 ? 1.5 : 2.0;
}

/** NoiseRouterData.QuantizedSpaghettiRarity.getSphaghettiRarity2D (type_2). */
export function spaghettiRarity2D(value: number): number {
  if (value < -0.75) return 0.5;
  if (value < -0.5) return 0.75;
  if (value < 0.5) return 1.0;
  return value < 0.75 ? 2.0 : 3.0;
}

export class WeirdScaledSamplerNode extends DensityNode {
  readonly minValue = 0;

  constructor(
    readonly input: DensityNode,
    readonly noise: NoiseHolder,
    readonly rarityValueMapper: RarityValueMapper,
  ) {
    super();
  }

  get maxValue(): number {
    return (this.rarityValueMapper === "type_1" ? 2.0 : 3.0) * this.noise.maxValue;
  }

  private transform(context: FunctionContext, inputValue: number): number {
    const rarity = this.rarityValueMapper === "type_1" ? spaghettiRarity3D(inputValue) : spaghettiRarity2D(inputValue);
    return rarity * Math.abs(this.noise.getValue(context.blockX / rarity, context.blockY / rarity, context.blockZ / rarity));
  }

  compute(context: FunctionContext): number {
    return this.transform(context, this.input.compute(context));
  }

  fillArray(values: Float64Array, provider: ContextProvider): void {
    this.input.fillArray(values, provider);
    for (let index = 0; index < values.length; index++) values[index] = this.transform(provider.forIndex(index), values[index]);
  }

  mapAll(visitor: DensityVisitor): DensityNode {
    return visitor.apply(new WeirdScaledSamplerNode(visitor.map(this.input), visitor.visitNoise(this.noise), this.rarityValueMapper));
  }

  children(): readonly DensityNode[] {
    return [this.input];
  }

  structuralSignature(structuralIdOf: StructuralIdLookup): string {
    return `weird_scaled_sampler(${structuralIdOf(this.input)},${this.noise.signature},${this.rarityValueMapper})`;
  }
}

/** The subset of engine/noise BlendedNoise that the density function needs (block coordinates in). */
export interface BlendedNoiseSampler {
  compute(blockX: number, blockY: number, blockZ: number): number;
  readonly minValue: number;
  readonly maxValue: number;
}

export interface BlendedNoiseParameters {
  xzScale: number;
  yScale: number;
  xzFactor: number;
  yFactor: number;
  smearScaleMultiplier: number;
}

/**
 * minecraft:old_blended_noise. Java's BlendedNoise is a plain class (identity equality); RandomState replaces it with
 * `withNewRandom(random.fromHashOf("minecraft:terrain"))`, which here means wiring a sampler in.
 */
export class OldBlendedNoiseNode extends DensityNode {
  private readonly identitySignature = allocateIdentitySignature("old_blended_noise");

  constructor(
    readonly parameters: BlendedNoiseParameters,
    readonly sampler: BlendedNoiseSampler | null,
  ) {
    super();
  }

  get minValue(): number {
    return this.sampler === null ? Number.NEGATIVE_INFINITY : this.sampler.minValue;
  }

  get maxValue(): number {
    return this.sampler === null ? Number.POSITIVE_INFINITY : this.sampler.maxValue;
  }

  compute(context: FunctionContext): number {
    if (this.sampler === null) throw new Error("old_blended_noise evaluated before RandomState wiring");
    return this.sampler.compute(context.blockX, context.blockY, context.blockZ);
  }

  mapAll(visitor: DensityVisitor): DensityNode {
    return visitor.apply(this);
  }

  children(): readonly DensityNode[] {
    return [];
  }

  structuralSignature(): string {
    return this.identitySignature;
  }
}

/** minecraft:end_islands, stubbed to 0 (the overworld never uses it). Bounds match EndIslandDensityFunction. */
export class EndIslandsNode extends DensityNode {
  readonly minValue = -0.84375;
  readonly maxValue = 0.5625;

  compute(): number {
    return 0;
  }

  mapAll(visitor: DensityVisitor): DensityNode {
    return visitor.apply(this);
  }

  children(): readonly DensityNode[] {
    return [];
  }

  structuralSignature(): string {
    return "end_islands";
  }
}
