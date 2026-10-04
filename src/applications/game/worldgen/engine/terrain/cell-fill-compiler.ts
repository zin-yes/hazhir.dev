// Compiles the function a cache_all_in_cell fills (the final density with its interpolated inputs) into straight-line
// JavaScript for one whole cell. NoiseChunk fills that cache through fillArray, where every interpolator evaluates
// Mth.lerp3 of its cell corners per block and the arithmetic nodes combine the results; the generated loop does the
// same floating point operations in the same order (lerp3's x/y part is shared by the blocks of one z row, which
// recomputes nothing differently), so the values are identical. Trees holding anything else (noises, other caches)
// are not compiled and keep the generic path.

import type { DensityNode } from "../density/density-function";
import { buildGeneratedFunction } from "../generated-function";
import {
  ClampNode,
  ConstantNode,
  MappedNode,
  RangeChoiceNode,
  YClampedGradientNode,
} from "../density/nodes/arithmetic-nodes";
import { BeardifierNode, BlendDensityNode } from "../density/nodes/structural-nodes";
import { MulOrAddNode, TwoArgumentNode } from "../density/nodes/two-argument-nodes";
import { NoiseInterpolator } from "./noise-chunk-caches";

/** Fills a cell's values (cache_all_in_cell layout) from 8 corners per interpolator (000,100,010,110,001,101,011,111). */
export type CompiledCellFill = (values: Float64Array, corners: Float64Array, cellStartBlockY: number) => void;

export interface CellFillProgram {
  /** Template subtrees of the interpolators the fill reads, in corner order (match them by NoiseInterpolator.templateWrapped). */
  readonly interpolatorTemplates: readonly DensityNode[];
  readonly fill: CompiledCellFill;
}

const CORNERS_PER_INTERPOLATOR = 8;

function literal(value: number): string {
  if (Object.is(value, -0)) return "-0";
  if (value === Number.POSITIVE_INFINITY) return "Infinity";
  if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
  if (Number.isNaN(value)) return "NaN";
  return `(${String(value)})`;
}

class CellFillCodeWriter {
  readonly interpolators: NoiseInterpolator[] = [];
  readonly statements: string[] = [];
  private temporaryCount = 0;

  private temporary(): string {
    return `value${this.temporaryCount++}`;
  }

  private interpolatorIndex(interpolator: NoiseInterpolator): number {
    let index = this.interpolators.indexOf(interpolator);
    if (index === -1) {
      index = this.interpolators.length;
      this.interpolators.push(interpolator);
    }
    return index;
  }

  /** Emits statements computing `node` and returns the variable holding it, or undefined when unsupported. */
  emit(node: DensityNode): string | undefined {
    if (node instanceof NoiseInterpolator) return `interpolated${this.interpolatorIndex(node)}`;
    if (node instanceof ConstantNode) return literal(node.value);
    if (node instanceof BeardifierNode) return "0";
    if (node instanceof BlendDensityNode) return this.emit(node.input);
    if (node instanceof YClampedGradientNode) {
      const result = this.temporary();
      this.statements.push(
        `let ${result}; { const delta = (blockY - ${literal(node.fromY)}) / (${literal(node.toY)} - ${literal(node.fromY)}); ` +
          `${result} = delta < 0 ? ${literal(node.fromValue)} : delta > 1 ? ${literal(node.toValue)} : ${literal(node.fromValue)} + delta * (${literal(node.toValue)} - ${literal(node.fromValue)}); }`,
      );
      return result;
    }
    if (node instanceof MulOrAddNode) {
      const input = this.emit(node.input);
      if (input === undefined) return undefined;
      const result = this.temporary();
      this.statements.push(`const ${result} = ${input} ${node.type === "add" ? "+" : "*"} ${literal(node.argument)};`);
      return result;
    }
    if (node instanceof MappedNode) {
      const input = this.emit(node.input);
      if (input === undefined) return undefined;
      const result = this.temporary();
      switch (node.type) {
        case "abs":
          this.statements.push(`const ${result} = Math.abs(${input});`);
          break;
        case "square":
          this.statements.push(`const ${result} = ${input} * ${input};`);
          break;
        case "cube":
          this.statements.push(`const ${result} = ${input} * ${input} * ${input};`);
          break;
        case "half_negative":
          this.statements.push(`const ${result} = ${input} > 0 ? ${input} : ${input} * 0.5;`);
          break;
        case "quarter_negative":
          this.statements.push(`const ${result} = ${input} > 0 ? ${input} : ${input} * 0.25;`);
          break;
        case "squeeze": {
          const clamped = this.temporary();
          this.statements.push(`const ${clamped} = ${input} < -1 ? -1 : Math.min(${input}, 1);`);
          this.statements.push(`const ${result} = ${clamped} / 2 - (${clamped} * ${clamped} * ${clamped}) / 24;`);
          break;
        }
      }
      return result;
    }
    if (node instanceof ClampNode) {
      const input = this.emit(node.input);
      if (input === undefined) return undefined;
      const result = this.temporary();
      this.statements.push(`const ${result} = ${input} < ${literal(node.minValue)} ? ${literal(node.minValue)} : Math.min(${input}, ${literal(node.maxValue)});`);
      return result;
    }
    if (node instanceof RangeChoiceNode) {
      const input = this.emit(node.input);
      if (input === undefined) return undefined;
      const result = this.temporary();
      this.statements.push(`let ${result};`);
      this.statements.push(`if (${input} >= ${literal(node.minInclusive)} && ${input} < ${literal(node.maxExclusive)}) {`);
      const inRange = this.emit(node.whenInRange);
      if (inRange === undefined) return undefined;
      this.statements.push(`${result} = ${inRange}; } else {`);
      const outOfRange = this.emit(node.whenOutOfRange);
      if (outOfRange === undefined) return undefined;
      this.statements.push(`${result} = ${outOfRange}; }`);
      return result;
    }
    if (node instanceof TwoArgumentNode) {
      const first = this.emit(node.first);
      if (first === undefined) return undefined;
      const result = this.temporary();
      if (node.type === "add") {
        const second = this.emit(node.second);
        if (second === undefined) return undefined;
        this.statements.push(`const ${result} = ${first} + ${second};`);
        return result;
      }
      this.statements.push(`let ${result};`);
      if (node.type === "mul") this.statements.push(`if (${first} === 0) { ${result} = 0; } else {`);
      else if (node.type === "min") this.statements.push(`if (${first} < ${literal(node.second.minValue)}) { ${result} = ${first}; } else {`);
      else this.statements.push(`if (${first} > ${literal(node.second.maxValue)}) { ${result} = ${first}; } else {`);
      const second = this.emit(node.second);
      if (second === undefined) return undefined;
      if (node.type === "mul") this.statements.push(`${result} = ${first} * ${second}; }`);
      else this.statements.push(`${result} = Math.${node.type}(${first}, ${second}); }`);
      return result;
    }
    return undefined;
  }
}

/** The compiled fill for `root` (what a cache_all_in_cell wraps), or undefined when the tree is not supported. */
export function compileCellFill(root: DensityNode, cellWidth: number, cellHeight: number): CellFillProgram | undefined {
  const writer = new CellFillCodeWriter();
  const resultVariable = writer.emit(root);
  if (resultVariable === undefined) return undefined;
  const interpolatorCount = writer.interpolators.length;
  const rowSetup: string[] = [];
  const blockSetup: string[] = [];
  for (let index = 0; index < interpolatorCount; index++) {
    const base = index * CORNERS_PER_INTERPOLATOR;
    rowSetup.push(
      `const nearZ${index} = lerp(deltaY, lerp(deltaX, corners[${base}], corners[${base + 1}]), lerp(deltaX, corners[${base + 2}], corners[${base + 3}]));`,
      `const farZ${index} = lerp(deltaY, lerp(deltaX, corners[${base + 4}], corners[${base + 5}]), lerp(deltaX, corners[${base + 6}], corners[${base + 7}]));`,
    );
    blockSetup.push(`const interpolated${index} = lerp(deltaZ, nearZ${index}, farZ${index});`);
  }
  const source = `
    const lerp = (delta, start, end) => start + delta * (end - start);
    return function fillCell(values, corners, cellStartBlockY) {
      let arrayIndex = 0;
      for (let inCellY = ${cellHeight - 1}; inCellY >= 0; inCellY--) {
        const blockY = cellStartBlockY + inCellY;
        const deltaY = inCellY / ${cellHeight};
        for (let inCellX = 0; inCellX < ${cellWidth}; inCellX++) {
          const deltaX = inCellX / ${cellWidth};
          ${rowSetup.join("\n          ")}
          for (let inCellZ = 0; inCellZ < ${cellWidth}; inCellZ++) {
            const deltaZ = inCellZ / ${cellWidth};
            ${blockSetup.join("\n            ")}
            ${writer.statements.join("\n            ")}
            values[arrayIndex++] = ${resultVariable};
          }
        }
      }
    };`;
  const interpolatorTemplates = writer.interpolators.map((interpolator) => interpolator.templateWrapped);
  if (interpolatorTemplates.some((template) => template === undefined)) return undefined;
  const fill = buildGeneratedFunction<CompiledCellFill>([], source, []);
  if (fill === undefined) return undefined;
  return { interpolatorTemplates: interpolatorTemplates as DensityNode[], fill };
}

const programsByTemplate = new WeakMap<DensityNode, Map<string, CellFillProgram | null>>();

/**
 * The compiled fill of a chunk's cache_all_in_cell, shared by every chunk wired from the same template (compiled code
 * only refers to interpolators through their template subtrees). Null when the tree is not supported.
 */
export function cellFillProgramFor(
  templateRoot: DensityNode,
  wiredRoot: DensityNode,
  cellWidth: number,
  cellHeight: number,
  layoutKey: string,
): CellFillProgram | null {
  let programsByLayout = programsByTemplate.get(templateRoot);
  if (programsByLayout === undefined) {
    programsByLayout = new Map();
    programsByTemplate.set(templateRoot, programsByLayout);
  }
  const key = `${cellWidth},${cellHeight},${layoutKey}`;
  let program = programsByLayout.get(key);
  if (program === undefined) {
    program = compileCellFill(wiredRoot, cellWidth, cellHeight) ?? null;
    programsByLayout.set(key, program);
  }
  return program;
}
