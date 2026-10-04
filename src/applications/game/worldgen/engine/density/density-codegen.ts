// Compiles a plain density tree (as evaluated outside a NoiseChunk, markers transparent) into one JavaScript function
// of (blockX, blockY, blockZ). Every node runs the same floating point operations in the same order as its `compute`,
// with the same short circuits; only the virtual calls and per-node bookkeeping disappear. Nodes the generator does not
// know are called through their own `compute`. The column and point caches of column-memoization.ts become lazily
// computed closure variables: column values are kept until the evaluated (x, z) changes, point values for one call.

import { buildGeneratedFunction } from "../generated-function";
import { BlendedNoise } from "../noise/blended-noise";
import { NOISE_IO } from "../noise/inline-noise-source";
import { NormalNoise } from "../noise/normal-noise";
import {
  DensityNode,
  type DensityVisitor,
  type FunctionContext,
  type NormalNoiseSampler,
  type StructuralIdLookup,
} from "./density-function";
import { LastColumnCacheNode, LastPointCacheNode } from "./column-memoization";
import {
  ClampNode,
  ConstantNode,
  MappedNode,
  RangeChoiceNode,
  YClampedGradientNode,
} from "./nodes/arithmetic-nodes";
import {
  EndIslandsNode,
  NoiseNode,
  OldBlendedNoiseNode,
  ShiftedNoiseNode,
  ShiftNode,
  spaghettiRarity2D,
  spaghettiRarity3D,
  WeirdScaledSamplerNode,
} from "./nodes/noise-nodes";
import { BeardifierNode, BlendConstantNode, BlendDensityNode, HolderNode, MarkerNode } from "./nodes/structural-nodes";
import { MulOrAddNode, TwoArgumentNode } from "./nodes/two-argument-nodes";

export type CompiledDensityFunction = (blockX: number, blockY: number, blockZ: number) => number;

function literal(value: number): string {
  if (Object.is(value, -0)) return "(-0)";
  if (value === Number.POSITIVE_INFINITY) return "Infinity";
  if (value === Number.NEGATIVE_INFINITY) return "(-Infinity)";
  if (Number.isNaN(value)) return "NaN";
  return `(${String(value)})`;
}

class DensityCodeWriter {
  readonly helpers: unknown[] = [];
  private readonly helperIndexByValue = new Map<unknown, number>();
  readonly cachedFunctionSources: string[] = [];
  readonly columnCacheNames: string[] = [];
  readonly pointCacheNames: string[] = [];
  readonly columnCacheIndices: number[] = [];
  readonly pointCacheIndices: number[] = [];
  private readonly cacheFunctionByNode = new Map<DensityNode, string>();
  private temporaryCount = 0;

  helper(value: unknown): string {
    let index = this.helperIndexByValue.get(value);
    if (index === undefined) {
      index = this.helpers.length;
      this.helpers.push(value);
      this.helperIndexByValue.set(value, index);
    }
    return `helper${index}`;
  }

  /**
   * An expression holding `noise` sampled at (x, y, z). Generated NormalNoise samplers take their coordinates and
   * return their value through NOISE_IO, so no double crosses a call boundary (V8 would box it).
   */
  private noiseCall(noise: NormalNoiseSampler, x: string, y: string, z: string, statements: string[]): string {
    const sampler = noise instanceof NormalNoise ? noise.compiledSampler() : undefined;
    if (sampler === undefined) return `${this.helper(noise)}.getValue(${x}, ${y}, ${z})`;
    return this.ioCall(sampler, x, y, z, statements);
  }

  private ioCall(sampler: () => void, x: string, y: string, z: string, statements: string[]): string {
    const io = this.helper(NOISE_IO);
    const result = this.temporary();
    statements.push(`${io}[0] = ${x};`, `${io}[1] = ${y};`, `${io}[2] = ${z};`, `${this.helper(sampler)}();`);
    statements.push(`const ${result} = ${io}[3];`);
    return result;
  }

  private temporary(): string {
    return `value${this.temporaryCount++}`;
  }

  /** Emits statements into `statements` computing `node`; returns the expression holding the value. */
  emit(node: DensityNode, statements: string[]): string {
    if (node instanceof ConstantNode) return literal(node.value);
    if (node instanceof BlendConstantNode) return literal(node.value);
    if (node instanceof BeardifierNode || node instanceof EndIslandsNode) return "0";
    if (node instanceof HolderNode) return this.emit(node.target, statements);
    if (node instanceof MarkerNode) return this.emit(node.wrapped, statements);
    if (node instanceof BlendDensityNode) return this.emit(node.input, statements);
    if (node instanceof LastColumnCacheNode) return `${this.cachedFunction(node, node.wrapped, "column")}(blockX, blockY, blockZ)`;
    if (node instanceof LastPointCacheNode) return `${this.cachedFunction(node, node.wrapped, "point")}(blockX, blockY, blockZ)`;
    if (node instanceof YClampedGradientNode) {
      const result = this.temporary();
      statements.push(
        `let ${result}; { const delta = (blockY - ${literal(node.fromY)}) / (${literal(node.toY)} - ${literal(node.fromY)}); ` +
          `${result} = delta < 0 ? ${literal(node.fromValue)} : delta > 1 ? ${literal(node.toValue)} : ${literal(node.fromValue)} + delta * (${literal(node.toValue)} - ${literal(node.fromValue)}); }`,
      );
      return result;
    }
    if (node instanceof NoiseNode) {
      if (node.noise.noise === null) return "0";
      const result = this.temporary();
      statements.push(
        `const ${result} = ${this.noiseCall(node.noise.noise, `blockX * ${literal(node.xzScale)}`, `blockY * ${literal(node.yScale)}`, `blockZ * ${literal(node.xzScale)}`, statements)};`,
      );
      return result;
    }
    if (node instanceof ShiftedNoiseNode) {
      const shiftX = this.emit(node.shiftX, statements);
      const sampleX = this.temporary();
      statements.push(`const ${sampleX} = blockX * ${literal(node.xzScale)} + ${shiftX};`);
      const shiftY = this.emit(node.shiftY, statements);
      const sampleY = this.temporary();
      statements.push(`const ${sampleY} = blockY * ${literal(node.yScale)} + ${shiftY};`);
      const shiftZ = this.emit(node.shiftZ, statements);
      const sampleZ = this.temporary();
      statements.push(`const ${sampleZ} = blockZ * ${literal(node.xzScale)} + ${shiftZ};`);
      if (node.noise.noise === null) return "0";
      const result = this.temporary();
      statements.push(`const ${result} = ${this.noiseCall(node.noise.noise, sampleX, sampleY, sampleZ, statements)};`);
      return result;
    }
    if (node instanceof ShiftNode) {
      if (node.offsetNoise.noise === null) return "0";
      const result = this.temporary();
      const [first, second, third] =
        node.type === "shift_a" ? ["blockX", "0", "blockZ"] : node.type === "shift_b" ? ["blockZ", "blockX", "0"] : ["blockX", "blockY", "blockZ"];
      statements.push(`const ${result} = ${this.noiseCall(node.offsetNoise.noise, `${first} * 0.25`, `${second} * 0.25`, `${third} * 0.25`, statements)} * 4;`);
      return result;
    }
    if (node instanceof WeirdScaledSamplerNode) {
      const input = this.emit(node.input, statements);
      const rarity = this.temporary();
      const mapper = this.helper(node.rarityValueMapper === "type_1" ? spaghettiRarity3D : spaghettiRarity2D);
      statements.push(`const ${rarity} = ${mapper}(${input});`);
      const result = this.temporary();
      const noiseValue =
        node.noise.noise === null ? "0" : this.noiseCall(node.noise.noise, `blockX / ${rarity}`, `blockY / ${rarity}`, `blockZ / ${rarity}`, statements);
      statements.push(`const ${result} = ${rarity} * Math.abs(${noiseValue});`);
      return result;
    }
    if (node instanceof OldBlendedNoiseNode && node.sampler instanceof BlendedNoise) {
      const sampler = node.sampler.compiledSampler();
      if (sampler !== undefined) return this.ioCall(sampler, "blockX", "blockY", "blockZ", statements);
    }
    if (node instanceof OldBlendedNoiseNode && node.sampler !== null) {
      const result = this.temporary();
      statements.push(`const ${result} = ${this.helper(node.sampler)}.compute(blockX, blockY, blockZ);`);
      return result;
    }
    if (node instanceof MulOrAddNode) {
      const input = this.emit(node.input, statements);
      const result = this.temporary();
      statements.push(`const ${result} = ${input} ${node.type === "add" ? "+" : "*"} ${literal(node.argument)};`);
      return result;
    }
    if (node instanceof MappedNode) return this.emitMapped(node, statements);
    if (node instanceof ClampNode) {
      const input = this.emit(node.input, statements);
      const result = this.temporary();
      statements.push(`const ${result} = ${input} < ${literal(node.minValue)} ? ${literal(node.minValue)} : Math.min(${input}, ${literal(node.maxValue)});`);
      return result;
    }
    if (node instanceof RangeChoiceNode) {
      const input = this.emit(node.input, statements);
      const result = this.temporary();
      statements.push(`let ${result};`);
      statements.push(`if (${input} >= ${literal(node.minInclusive)} && ${input} < ${literal(node.maxExclusive)}) {`);
      const inRange = this.emit(node.whenInRange, statements);
      statements.push(`${result} = ${inRange}; } else {`);
      const outOfRange = this.emit(node.whenOutOfRange, statements);
      statements.push(`${result} = ${outOfRange}; }`);
      return result;
    }
    if (node instanceof TwoArgumentNode) return this.emitTwoArgument(node, statements);
    const result = this.temporary();
    statements.push(`const ${result} = ${this.helper(node)}.compute(context);`);
    return result;
  }

  private emitMapped(node: MappedNode, statements: string[]): string {
    const input = this.emit(node.input, statements);
    const result = this.temporary();
    switch (node.type) {
      case "abs":
        statements.push(`const ${result} = Math.abs(${input});`);
        break;
      case "square":
        statements.push(`const ${result} = ${input} * ${input};`);
        break;
      case "cube":
        statements.push(`const ${result} = ${input} * ${input} * ${input};`);
        break;
      case "half_negative":
        statements.push(`const ${result} = ${input} > 0 ? ${input} : ${input} * 0.5;`);
        break;
      case "quarter_negative":
        statements.push(`const ${result} = ${input} > 0 ? ${input} : ${input} * 0.25;`);
        break;
      case "squeeze": {
        const clamped = this.temporary();
        statements.push(`const ${clamped} = ${input} < -1 ? -1 : Math.min(${input}, 1);`);
        statements.push(`const ${result} = ${clamped} / 2 - (${clamped} * ${clamped} * ${clamped}) / 24;`);
        break;
      }
    }
    return result;
  }

  private emitTwoArgument(node: TwoArgumentNode, statements: string[]): string {
    const first = this.emit(node.first, statements);
    const result = this.temporary();
    if (node.type === "add") {
      const second = this.emit(node.second, statements);
      statements.push(`const ${result} = ${first} + ${second};`);
      return result;
    }
    statements.push(`let ${result};`);
    if (node.type === "mul") statements.push(`if (${first} === 0) { ${result} = 0; } else {`);
    else if (node.type === "min") statements.push(`if (${first} < ${literal(node.second.minValue)}) { ${result} = ${first}; } else {`);
    else statements.push(`if (${first} > ${literal(node.second.maxValue)}) { ${result} = ${first}; } else {`);
    const second = this.emit(node.second, statements);
    if (node.type === "mul") statements.push(`${result} = ${first} * ${second}; }`);
    else statements.push(`${result} = Math.${node.type}(${first}, ${second}); }`);
    return result;
  }

  /** A closure-level lazily computed value: per evaluated column, or per evaluated point. */
  private cachedFunction(cacheNode: DensityNode, wrapped: DensityNode, scope: "column" | "point"): string {
    const existing = this.cacheFunctionByNode.get(cacheNode);
    if (existing !== undefined) return existing;
    const index = this.cachedFunctionSources.length;
    const name = `${scope}Cache${index}`;
    this.cacheFunctionByNode.set(cacheNode, name);
    this.cachedFunctionSources.push("");
    (scope === "column" ? this.columnCacheNames : this.pointCacheNames).push(name);
    const statements: string[] = [];
    const value = this.emit(wrapped, statements);
    // Cached values live in typed arrays: V8 boxes doubles held in closure variables, typed arrays store them raw.
    this.cachedFunctionSources[index] =
      `function ${name}(blockX, blockY, blockZ) {\n` +
      `if (cacheIsValid[${index}] === 1) return cachedValues[${index}];\n${statements.join("\n")}\n` +
      `cachedValues[${index}] = ${value};\ncacheIsValid[${index}] = 1;\nreturn cachedValues[${index}];\n}`;
    (scope === "column" ? this.columnCacheIndices : this.pointCacheIndices).push(index);
    return name;
  }
}

/** Compiles `root`; the result keeps column and point caches, so use one instance per thread. */
export function compileDensityFunction(root: DensityNode): CompiledDensityFunction {
  const writer = new DensityCodeWriter();
  const bodyStatements: string[] = [];
  const result = writer.emit(root, bodyStatements);
  const helperDeclarations = writer.helpers.map((_, index) => `const helper${index} = helpers[${index}];`).join("\n");
  const columnResets = writer.columnCacheIndices.map((index) => `cacheIsValid[${index}] = 0;`).join(" ");
  const pointResets = writer.pointCacheIndices.map((index) => `cacheIsValid[${index}] = 0;`).join(" ");
  const cacheCount = Math.max(1, writer.cachedFunctionSources.length);
  const source = `${helperDeclarations}
const cachedValues = new Float64Array(${cacheCount});
const cacheIsValid = new Uint8Array(${cacheCount});
const columnPosition = new Float64Array([NaN, NaN]);
const context = { blockX: 0, blockY: 0, blockZ: 0 };
${writer.cachedFunctionSources.join("\n")}
return function evaluate(blockX, blockY, blockZ) {
  context.blockX = blockX;
  context.blockY = blockY;
  context.blockZ = blockZ;
  if (blockX !== columnPosition[0] || blockZ !== columnPosition[1]) { columnPosition[0] = blockX; columnPosition[1] = blockZ; ${columnResets} }
  ${pointResets}
  ${bodyStatements.join("\n  ")}
  return ${result};
};`;
  const compiled = buildGeneratedFunction<CompiledDensityFunction>(["helpers"], source, [writer.helpers]);
  if (compiled !== undefined) return compiled;
  const context = { blockX: 0, blockY: 0, blockZ: 0 };
  return (blockX, blockY, blockZ) => {
    context.blockX = blockX;
    context.blockY = blockY;
    context.blockZ = blockZ;
    return root.compute(context);
  };
}

/** A DensityNode whose compute runs the compiled form of `source` (bounds and children are the source's). */
export class CompiledDensityNode extends DensityNode {
  private readonly evaluate: CompiledDensityFunction;

  constructor(readonly source: DensityNode) {
    super();
    this.evaluate = compileDensityFunction(source);
  }

  get minValue(): number {
    return this.source.minValue;
  }

  get maxValue(): number {
    return this.source.maxValue;
  }

  compute(context: FunctionContext): number {
    return this.evaluate(context.blockX, context.blockY, context.blockZ);
  }

  mapAll(visitor: DensityVisitor): DensityNode {
    return visitor.apply(new CompiledDensityNode(visitor.map(this.source)));
  }

  children(): readonly DensityNode[] {
    return [this.source];
  }

  structuralSignature(structuralIdOf: StructuralIdLookup): string {
    return `compiled(${structuralIdOf(this.source)})`;
  }
}
