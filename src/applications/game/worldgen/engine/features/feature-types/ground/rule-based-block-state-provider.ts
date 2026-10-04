// Mirrors RuleBasedBlockStateProvider: the first rule whose block predicate holds at the position picks the
// provider, otherwise the fallback does.

import type { FeatureParser } from "../../feature/feature-parser";
import type { WorldGenLevel } from "../../level/world-gen-level";
import type { BlockPredicate } from "../../providers/block-predicates";
import type { BlockStateProvider } from "../../providers/block-state-providers";
import { asArray, asObject, type JsonValue } from "../../providers/json-fields";
import type { RandomSource } from "../../../random";

export interface RuleBasedBlockStateProvider {
  getState(level: WorldGenLevel, random: RandomSource, x: number, y: number, z: number): string;
}

export function parseRuleBasedBlockStateProvider(json: JsonValue | undefined, parser: FeatureParser, what: string): RuleBasedBlockStateProvider {
  const object = asObject(json, what);
  const fallback: BlockStateProvider = parser.blockStateProvider(object.fallback, `${what}.fallback`);
  const rules: Array<{ condition: BlockPredicate; provider: BlockStateProvider }> = asArray(object.rules, `${what}.rules`).map((ruleJson, index) => {
    const rule = asObject(ruleJson, `${what}.rules[${index}]`);
    return {
      condition: parser.blockPredicate(rule.if_true, `${what}.rules[${index}].if_true`),
      provider: parser.blockStateProvider(rule.then, `${what}.rules[${index}].then`),
    };
  });
  return {
    getState(level, random, x, y, z) {
      for (const rule of rules) {
        if (rule.condition.test(level, x, y, z)) return rule.provider.getState(random, x, y, z);
      }
      return fallback.getState(random, x, y, z);
    },
  };
}
