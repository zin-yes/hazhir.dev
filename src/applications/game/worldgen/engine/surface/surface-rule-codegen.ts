// Generates one JavaScript function per `sequence` of a `surface_rule` instead of a closure per node. Rules and
// conditions run in the same order with the same short circuits and the same arithmetic as the closure compiler in
// surface-rule-compiler.ts; per-y conditions are evaluated inline (no surface condition is shared between two places
// of the tree, so per-y caching never hit), per-column conditions keep their column cache.

import type { JsonObject, JsonValue } from "../registry/datapack-loader";
import { formatBlockState } from "../chunk";
import { buildGeneratedFunction } from "../generated-function";
import { transientRandomAt } from "../random/xoroshiro-random-source";
import { beginColdStart, defineColdStartLabel, endColdStart, recordColdStartUnits } from "../profiling/cold-start-ledger";
import { NO_WATER_HEIGHT, type SurfaceRuleContext } from "./surface-rule-context";
import type { SurfaceRule, SurfaceRuleCompilerInputs } from "./surface-rule-compiler";
import { withDefaultNamespace, type SurfaceNoiseSource, type SurfacePositionalRandomFactory } from "./surface-types";

const NO_RULE_MATCH = -1;

const GENERATE_LABEL = defineColdStartLabel("codegen.surfaceRule");
const SOURCE_CHARACTERS_LABEL = defineColdStartLabel("codegen.surfaceRule.sourceCharacters");
const FUNCTIONS_LABEL = defineColdStartLabel("codegen.surfaceRule.functions");
const BIOME_CONDITIONS_LABEL = defineColdStartLabel("codegen.surfaceRule.biomeConditions");

type VerticalAnchorResolver = (minGenY: number, genDepth: number) => number;

function asObject(value: JsonValue | undefined, description: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Surface rule ${description} must be an object`);
  }
  return value;
}

function asArray(value: JsonValue | undefined, description: string): JsonValue[] {
  if (!Array.isArray(value)) throw new Error(`Surface rule ${description} must be an array`);
  return value;
}

function parseVerticalAnchor(value: JsonValue | undefined): VerticalAnchorResolver {
  const anchor = asObject(value, "vertical anchor");
  if (typeof anchor.absolute === "number") {
    const absolute = anchor.absolute;
    return () => absolute;
  }
  if (typeof anchor.above_bottom === "number") {
    const offset = anchor.above_bottom;
    return (minGenY) => minGenY + offset;
  }
  if (typeof anchor.below_top === "number") {
    const offset = anchor.below_top;
    return (minGenY, genDepth) => genDepth - 1 + minGenY - offset;
  }
  throw new Error(`Unknown vertical anchor ${JSON.stringify(anchor)}`);
}

function numberLiteral(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`Surface rule number ${value} is not finite`);
  return Object.is(value, -0) ? "(-0)" : `(${String(value)})`;
}

function lazyByColumn(compute: (context: SurfaceRuleContext) => boolean): (context: SurfaceRuleContext) => boolean {
  let cachedStamp = -1;
  let cachedValue = false;
  return (context) => {
    if (context.lastUpdateXZ !== cachedStamp) {
      cachedStamp = context.lastUpdateXZ;
      cachedValue = compute(context);
    }
    return cachedValue;
  };
}

class SurfaceRuleCodeWriter {
  readonly helpers: unknown[] = [];
  readonly functionSources: string[] = [];
  /** Biome sets of the biome conditions, by the index the generated code checks in context.biomeConditionPossible. */
  readonly biomeConditionSets: ReadonlySet<string>[] = [];

  /** Per stone_depth condition: the depth at or below which it holds (`1 + offset + surface terms`), by surface type. */
  readonly floorDepthLimits: string[] = [];
  readonly ceilingDepthLimits: string[] = [];
  private readonly emptySequenceNames = new Set<string>();

  /**
   * With `assumeDeep`, every stone_depth and above_preliminary_surface condition is false (the caller only runs that
   * rule where they are) and the branches they guard are left out.
   */
  constructor(
    private readonly inputs: SurfaceRuleCompilerInputs,
    private readonly assumeDeep = false,
  ) {}

  private helper(value: unknown): string {
    this.helpers.push(value);
    return `helper${this.helpers.length - 1}`;
  }

  condition(json: JsonValue | undefined): string {
    const node = asObject(json, "condition");
    const type = withDefaultNamespace(String(node.type));
    switch (type) {
      case "minecraft:not": {
        const inverted = this.condition(node.invert);
        if (inverted === "false") return "true";
        if (inverted === "true") return "false";
        return `!${inverted}`;
      }
      case "minecraft:biome": {
        const biomeIds = new Set(asArray(node.biome_is, "biome_is").map((id) => withDefaultNamespace(String(id))));
        const conditionIndex = this.biomeConditionSets.length;
        this.biomeConditionSets.push(biomeIds);
        return `(context.biomeConditionPossible[${conditionIndex}] !== 0 && ${this.helper(biomeIds)}.has(context.getBiome()))`;
      }
      case "minecraft:stone_depth": {
        const stoneDepth = node.surface_type === "ceiling" ? "context.stoneDepthBelow" : "context.stoneDepthAbove";
        const surfaceDepthTerm = node.add_surface_depth === true ? "context.surfaceDepth" : "0";
        const secondaryDepthRange = Number(node.secondary_depth_range);
        const secondaryTerm =
          secondaryDepthRange === 0
            ? "0"
            : `Math.trunc(((context.getSurfaceSecondary() - -1) / (1 - -1)) * ${numberLiteral(secondaryDepthRange)})`;
        const depthLimit = `1 + ${numberLiteral(Number(node.offset))} + ${surfaceDepthTerm} + ${secondaryTerm}`;
        (node.surface_type === "ceiling" ? this.ceilingDepthLimits : this.floorDepthLimits).push(depthLimit);
        if (this.assumeDeep) return "false";
        return `(${stoneDepth} <= ${depthLimit})`;
      }
      case "minecraft:y_above": {
        const anchor = this.helper(parseVerticalAnchor(node.anchor));
        const stoneDepthTerm = node.add_stone_depth === true ? "context.stoneDepthAbove" : "0";
        return `(context.blockY + ${stoneDepthTerm} >= ${anchor}(context.minGenY, context.genDepth) + context.surfaceDepth * ${numberLiteral(Number(node.surface_depth_multiplier))})`;
      }
      case "minecraft:water": {
        const stoneDepthTerm = node.add_stone_depth === true ? "context.stoneDepthAbove" : "0";
        return (
          `(context.waterHeight === ${NO_WATER_HEIGHT} || context.blockY + ${stoneDepthTerm} >= ` +
          `context.waterHeight + ${numberLiteral(Number(node.offset))} + context.surfaceDepth * ${numberLiteral(Number(node.surface_depth_multiplier))})`
        );
      }
      case "minecraft:noise_threshold": {
        const noiseId = withDefaultNamespace(String(node.noise));
        const minThreshold = Number(node.min_threshold);
        const maxThreshold = Number(node.max_threshold);
        let noise: SurfaceNoiseSource | undefined;
        const condition = lazyByColumn((context) => {
          noise ??= this.inputs.noises.get(noiseId);
          const value = noise.getValue(context.blockX, 0, context.blockZ);
          return value >= minThreshold && value <= maxThreshold;
        });
        return `${this.helper(condition)}(context)`;
      }
      case "minecraft:vertical_gradient": {
        const resolveTrueAtAndBelow = parseVerticalAnchor(node.true_at_and_below);
        const resolveFalseAtAndAbove = parseVerticalAnchor(node.false_at_and_above);
        const randomName = withDefaultNamespace(String(node.random_name));
        let gradientFactory: SurfacePositionalRandomFactory | undefined;
        const condition = (context: SurfaceRuleContext): boolean => {
          const trueAtAndBelow = resolveTrueAtAndBelow(context.minGenY, context.genDepth);
          const falseAtAndAbove = resolveFalseAtAndAbove(context.minGenY, context.genDepth);
          if (context.blockY <= trueAtAndBelow) return true;
          if (context.blockY >= falseAtAndAbove) return false;
          gradientFactory ??= this.inputs.randomFactory.fromHashOf(randomName).forkPositional();
          const probability = 1 + ((context.blockY - trueAtAndBelow) / (falseAtAndAbove - trueAtAndBelow)) * (0 - 1);
          return transientRandomAt(gradientFactory, context.blockX, context.blockY, context.blockZ).nextFloat() < probability;
        };
        return `${this.helper(condition)}(context)`;
      }
      case "minecraft:steep":
        return `${this.helper(lazyByColumn((context) => context.isSteep()))}(context)`;
      case "minecraft:hole":
        return "(context.surfaceDepth <= 0)";
      case "minecraft:above_preliminary_surface":
        return this.assumeDeep ? "false" : "(context.blockY >= context.getMinSurfaceLevel())";
      case "minecraft:temperature":
        return "context.isColdEnoughToSnow()";
      default:
        throw new Error(`Unsupported surface condition type ${type}`);
    }
  }

  /** Statements that return the result index when the rule matches and fall through otherwise. */
  rule(json: JsonValue | undefined): string {
    const node = asObject(json, "rule");
    const type = withDefaultNamespace(String(node.type));
    switch (type) {
      case "minecraft:sequence": {
        const children = asArray(node.sequence, "sequence");
        if (children.length === 1) return this.rule(children[0]);
        const functionName = this.sequenceFunction(children);
        if (this.emptySequenceNames.has(functionName)) return "";
        return `{ const result = ${functionName}(context); if (result !== ${NO_RULE_MATCH}) return result; }`;
      }
      case "minecraft:condition": {
        const condition = this.condition(node.if_true);
        const body = this.rule(node.then_run);
        // Conditions only read (and cache) pure values, so one guarding nothing can be left out.
        if (condition === "false" || body.trim() === "") return "";
        if (condition === "true") return `{ ${body} }`;
        return `if (${condition}) { ${body} }`;
      }
      case "minecraft:block": {
        const resultState = asObject(node.result_state, "result_state");
        const properties = resultState.Properties
          ? (asObject(resultState.Properties, "result_state properties") as Record<string, string>)
          : undefined;
        return `return ${this.inputs.resultTable.indexOf(formatBlockState(String(resultState.Name), properties))};`;
      }
      case "minecraft:bandlands":
        return `return ${this.helper(this.inputs.getBandResultIndex)}(context.blockX, context.blockY, context.blockZ);`;
      default:
        throw new Error(`Unsupported surface rule type ${type}`);
    }
  }

  sequenceFunction(children: JsonValue[]): string {
    const functionName = `sequence${this.functionSources.length}`;
    this.functionSources.push("");
    const index = this.functionSources.length - 1;
    const body = children.map((child) => this.rule(child)).join("\n");
    if (body.trim() === "") this.emptySequenceNames.add(functionName);
    this.functionSources[index] = `function ${functionName}(context) {\n${body}\nreturn ${NO_RULE_MATCH};\n}`;
    return functionName;
  }
}

/** Largest stone depth (floor, ceiling) at which some stone_depth condition still holds, for the current column. */
export type StoneDepthLimits = (context: SurfaceRuleContext) => number;

/** A generated surface rule plus the biome sets its conditions test (see SurfaceRuleContext.biomeConditionPossible). */
export type GeneratedSurfaceRule = SurfaceRule & {
  readonly biomeConditionSets: readonly ReadonlySet<string>[];
  /**
   * The same rule for a block where every stone_depth and above_preliminary_surface condition is false: stone depth
   * above it greater than floorDepthLimit, below it greater than ceilingDepthLimit, and y below the preliminary surface.
   */
  readonly deepRule: SurfaceRule;
  readonly floorDepthLimit: StoneDepthLimits;
  readonly ceilingDepthLimit: StoneDepthLimits;
};

function buildRuleFunction(writer: SurfaceRuleCodeWriter, ruleJson: JsonObject): SurfaceRule | undefined {
  const rootFunction = writer.sequenceFunction([ruleJson]);
  const helperDeclarations = writer.helpers.map((_, index) => `const helper${index} = helpers[${index}];`).join("\n");
  const source = `${helperDeclarations}\n${writer.functionSources.join("\n")}\nreturn ${rootFunction};`;
  recordColdStartUnits(SOURCE_CHARACTERS_LABEL, source.length);
  recordColdStartUnits(FUNCTIONS_LABEL, writer.functionSources.length);
  recordColdStartUnits(BIOME_CONDITIONS_LABEL, writer.biomeConditionSets.length);
  return buildGeneratedFunction<SurfaceRule>(["helpers"], source, [writer.helpers]);
}

function buildDepthLimit(depthLimits: readonly string[]): StoneDepthLimits | undefined {
  const body = depthLimits.length === 0 ? "return -Infinity;" : `return Math.max(${depthLimits.join(", ")});`;
  return buildGeneratedFunction<StoneDepthLimits>([], `return function depthLimit(context) {\n${body}\n};`, []);
}

/** The surface rule as generated code (same results as the closures), or undefined when code generation is blocked. */
export function generateSurfaceRule(ruleJson: JsonObject, inputs: SurfaceRuleCompilerInputs): GeneratedSurfaceRule | undefined {
  const coldStartToken = beginColdStart(GENERATE_LABEL);
  try {
    return generateSurfaceRuleUntimed(ruleJson, inputs);
  } finally {
    endColdStart(GENERATE_LABEL, coldStartToken);
  }
}

function generateSurfaceRuleUntimed(ruleJson: JsonObject, inputs: SurfaceRuleCompilerInputs): GeneratedSurfaceRule | undefined {
  const writer = new SurfaceRuleCodeWriter(inputs);
  const rule = buildRuleFunction(writer, ruleJson);
  const deepWriter = new SurfaceRuleCodeWriter(inputs, true);
  const deepRule = buildRuleFunction(deepWriter, ruleJson);
  const floorDepthLimit = buildDepthLimit(writer.floorDepthLimits);
  const ceilingDepthLimit = buildDepthLimit(writer.ceilingDepthLimits);
  if (rule === undefined || deepRule === undefined || floorDepthLimit === undefined || ceilingDepthLimit === undefined) return undefined;
  if (deepWriter.biomeConditionSets.length !== writer.biomeConditionSets.length) throw new Error("Deep surface rule lost a biome condition");
  return Object.assign(rule, { biomeConditionSets: writer.biomeConditionSets, deepRule, floorDepthLimit, ceilingDepthLimit });
}
