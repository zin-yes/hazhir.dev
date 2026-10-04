// Compiles the `surface_rule` JSON of a noise settings file into closures, once per seed. Mirrors the
// RuleSource.apply / ConditionSource.apply pairs of SurfaceRules. A rule returns an index into the result table
// (block state strings, plus the clay band colours), or -1 when it does not apply.

import { DIMENSIONS } from "@/applications/game/profiler/dimensions";
import { endWorkerSection, startWorkerSection } from "@/applications/game/profiler/worker-recorder";
import type { JsonObject, JsonValue } from "../registry/datapack-loader";
import { formatBlockState } from "../chunk";
import { generateSurfaceRule } from "./surface-rule-codegen";
import { NO_WATER_HEIGHT, type SurfaceRuleContext } from "./surface-rule-context";
import {
  withDefaultNamespace,
  type SurfaceNoiseRegistry,
  type SurfaceNoiseSource,
  type SurfacePositionalRandomFactory,
} from "./surface-types";

export type SurfaceCondition = (context: SurfaceRuleContext) => boolean;
export type SurfaceRule = (context: SurfaceRuleContext) => number;

export const NO_RULE_MATCH = -1;

/** Interns the block states rules can produce; rules return indices into it. */
export class SurfaceResultTable {
  readonly states: string[] = [];
  private readonly indexByState = new Map<string, number>();

  indexOf(state: string): number {
    const existing = this.indexByState.get(state);
    if (existing !== undefined) return existing;
    this.states.push(state);
    this.indexByState.set(state, this.states.length - 1);
    return this.states.length - 1;
  }
}

export interface SurfaceRuleCompilerInputs {
  /**
   * Wraps every rule and condition in a timed profiler section keyed by its type (DIMENSIONS.worldgenSurfaceRule).
   * Only used for the variant of the rules that runs on a sample of evaluations while profiling, so the normal rules
   * carry no wrappers.
   */
  profileRuleTypes?: boolean;
  noises: SurfaceNoiseRegistry;
  randomFactory: SurfacePositionalRandomFactory;
  resultTable: SurfaceResultTable;
  /** Clay band lookup for the `bandlands` rule, already resolved to result table indices. */
  getBandResultIndex: (blockX: number, blockY: number, blockZ: number) => number;
}

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

type VerticalAnchorResolver = (minGenY: number, genDepth: number) => number;

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

function lazyByY(compute: SurfaceCondition): SurfaceCondition {
  let cachedStamp = -1;
  let cachedValue = false;
  return (context) => {
    if (context.lastUpdateY !== cachedStamp) {
      cachedStamp = context.lastUpdateY;
      cachedValue = compute(context);
    }
    return cachedValue;
  };
}

function lazyByColumn(compute: SurfaceCondition): SurfaceCondition {
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

function shortTypeOf(json: JsonValue | undefined, description: string): string {
  return withDefaultNamespace(String(asObject(json, description).type)).replace("minecraft:", "");
}

function profileRule(rule: SurfaceRule, typeKey: string): SurfaceRule {
  return (context) => {
    startWorkerSection("surface.rule", DIMENSIONS.worldgenSurfaceRule, typeKey);
    try {
      return rule(context);
    } finally {
      endWorkerSection();
    }
  };
}

function profileCondition(condition: SurfaceCondition, typeKey: string): SurfaceCondition {
  return (context) => {
    startWorkerSection("surface.condition", DIMENSIONS.worldgenSurfaceRule, typeKey);
    try {
      return condition(context);
    } finally {
      endWorkerSection();
    }
  };
}

export function compileSurfaceRules(ruleJson: JsonObject, inputs: SurfaceRuleCompilerInputs): SurfaceRule {
  const generated = inputs.profileRuleTypes ? undefined : generateSurfaceRule(ruleJson, inputs);
  return generated ?? compileSurfaceRuleClosures(ruleJson, inputs);
}

/** The closure form of the rules (one closure per node); the profiler wraps each one with its type. */
export function compileSurfaceRuleClosures(ruleJson: JsonObject, inputs: SurfaceRuleCompilerInputs): SurfaceRule {
  function compileCondition(json: JsonValue | undefined): SurfaceCondition {
    const condition = compileConditionBody(json);
    return inputs.profileRuleTypes ? profileCondition(condition, `condition.${shortTypeOf(json, "condition")}`) : condition;
  }

  function compileRule(json: JsonValue | undefined): SurfaceRule {
    const rule = compileRuleBody(json);
    return inputs.profileRuleTypes ? profileRule(rule, `rule.${shortTypeOf(json, "rule")}`) : rule;
  }

  function compileConditionBody(json: JsonValue | undefined): SurfaceCondition {
    const node = asObject(json, "condition");
    const type = withDefaultNamespace(String(node.type));
    switch (type) {
      case "minecraft:not": {
        const inner = compileCondition(node.invert);
        return (context) => !inner(context);
      }
      case "minecraft:biome": {
        const biomeIds = new Set(asArray(node.biome_is, "biome_is").map((id) => withDefaultNamespace(String(id))));
        return lazyByY((context) => biomeIds.has(context.getBiome()));
      }
      case "minecraft:stone_depth": {
        const isCeiling = node.surface_type === "ceiling";
        const addSurfaceDepth = node.add_surface_depth === true;
        const secondaryDepthRange = Number(node.secondary_depth_range);
        const offset = Number(node.offset);
        return lazyByY((context) => {
          const stoneDepth = isCeiling ? context.stoneDepthBelow : context.stoneDepthAbove;
          const surfaceDepthTerm = addSurfaceDepth ? context.surfaceDepth : 0;
          const secondaryTerm =
            secondaryDepthRange === 0
              ? 0
              : Math.trunc(((context.getSurfaceSecondary() - -1) / (1 - -1)) * secondaryDepthRange);
          return stoneDepth <= 1 + offset + surfaceDepthTerm + secondaryTerm;
        });
      }
      case "minecraft:y_above": {
        const resolveAnchor = parseVerticalAnchor(node.anchor);
        const surfaceDepthMultiplier = Number(node.surface_depth_multiplier);
        const addStoneDepth = node.add_stone_depth === true;
        return lazyByY(
          (context) =>
            context.blockY + (addStoneDepth ? context.stoneDepthAbove : 0) >=
            resolveAnchor(context.minGenY, context.genDepth) + context.surfaceDepth * surfaceDepthMultiplier,
        );
      }
      case "minecraft:water": {
        const offset = Number(node.offset);
        const surfaceDepthMultiplier = Number(node.surface_depth_multiplier);
        const addStoneDepth = node.add_stone_depth === true;
        return lazyByY(
          (context) =>
            context.waterHeight === NO_WATER_HEIGHT ||
            context.blockY + (addStoneDepth ? context.stoneDepthAbove : 0) >=
              context.waterHeight + offset + context.surfaceDepth * surfaceDepthMultiplier,
        );
      }
      case "minecraft:noise_threshold": {
        const noiseId = withDefaultNamespace(String(node.noise));
        const minThreshold = Number(node.min_threshold);
        const maxThreshold = Number(node.max_threshold);
        let noise: SurfaceNoiseSource | undefined;
        return lazyByColumn((context) => {
          noise ??= inputs.noises.get(noiseId);
          const value = noise.getValue(context.blockX, 0, context.blockZ);
          return value >= minThreshold && value <= maxThreshold;
        });
      }
      case "minecraft:vertical_gradient": {
        const resolveTrueAtAndBelow = parseVerticalAnchor(node.true_at_and_below);
        const resolveFalseAtAndAbove = parseVerticalAnchor(node.false_at_and_above);
        const randomName = withDefaultNamespace(String(node.random_name));
        let gradientFactory: SurfacePositionalRandomFactory | undefined;
        return lazyByY((context) => {
          const trueAtAndBelow = resolveTrueAtAndBelow(context.minGenY, context.genDepth);
          const falseAtAndAbove = resolveFalseAtAndAbove(context.minGenY, context.genDepth);
          if (context.blockY <= trueAtAndBelow) return true;
          if (context.blockY >= falseAtAndAbove) return false;
          gradientFactory ??= inputs.randomFactory.fromHashOf(randomName).forkPositional();
          const probability = 1 + ((context.blockY - trueAtAndBelow) / (falseAtAndAbove - trueAtAndBelow)) * (0 - 1);
          return gradientFactory.at(context.blockX, context.blockY, context.blockZ).nextFloat() < probability;
        });
      }
      case "minecraft:steep":
        return lazyByColumn((context) => context.isSteep());
      case "minecraft:hole":
        return lazyByColumn((context) => context.surfaceDepth <= 0);
      case "minecraft:above_preliminary_surface":
        return (context) => context.blockY >= context.getMinSurfaceLevel();
      case "minecraft:temperature":
        return lazyByY((context) => context.isColdEnoughToSnow());
      default:
        throw new Error(`Unsupported surface condition type ${type}`);
    }
  }

  function compileRuleBody(json: JsonValue | undefined): SurfaceRule {
    const node = asObject(json, "rule");
    const type = withDefaultNamespace(String(node.type));
    switch (type) {
      case "minecraft:sequence": {
        const rules = asArray(node.sequence, "sequence").map(compileRule);
        if (rules.length === 1) return rules[0]!;
        return (context) => {
          for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {
            const result = rules[ruleIndex]!(context);
            if (result !== NO_RULE_MATCH) return result;
          }
          return NO_RULE_MATCH;
        };
      }
      case "minecraft:condition": {
        const condition = compileCondition(node.if_true);
        const followup = compileRule(node.then_run);
        return (context) => (condition(context) ? followup(context) : NO_RULE_MATCH);
      }
      case "minecraft:block": {
        const resultState = asObject(node.result_state, "result_state");
        const properties = resultState.Properties
          ? (asObject(resultState.Properties, "result_state properties") as Record<string, string>)
          : undefined;
        const resultIndex = inputs.resultTable.indexOf(formatBlockState(String(resultState.Name), properties));
        return () => resultIndex;
      }
      case "minecraft:bandlands":
        return (context) => inputs.getBandResultIndex(context.blockX, context.blockY, context.blockZ);
      default:
        throw new Error(`Unsupported surface rule type ${type}`);
    }
  }

  return compileRule(ruleJson);
}
