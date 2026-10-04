// Mirrors levelgen.structure.templatesystem.RuleTest and its types as OreConfiguration.TargetBlockState uses them
// (always_true, block_match, blockstate_match, tag_match, random_block_match, random_blockstate_match).
// BlockState identity (`==`) becomes equality of normalized state strings.

import { type BlockStateInfo, normalizeBlockId, normalizeTagId } from "../../../block-state";
import type { FeatureParser } from "../../feature/feature-parser";
import type { WorldGenLevel } from "../../level/world-gen-level";
import { asObject, type JsonValue, requireNumber, requireString } from "../../providers/json-fields";
import type { RandomSource } from "../../../random";
import { parseBlockStateIgnoringUnknownProperties } from "./config-fields";
import { fround } from "./java-math";

export interface RuleTest {
  test(level: WorldGenLevel, blockInfo: BlockStateInfo, random: RandomSource): boolean;
}

export function parseRuleTest(json: JsonValue | undefined, parser: FeatureParser, what: string): RuleTest {
  const object = asObject(json, what);
  const predicateType = requireString(object, "predicate_type", what);
  const typeId = predicateType.includes(":") ? predicateType : `minecraft:${predicateType}`;
  switch (typeId) {
    case "minecraft:always_true":
      return { test: () => true };
    case "minecraft:block_match": {
      const blockName = normalizeBlockId(requireString(object, "block", what));
      if (!parser.blockStates.isKnownBlock(blockName)) parser.blockStates.reportUnknownBlock(blockName, what);
      return { test: (_level, blockInfo) => blockInfo.name === blockName };
    }
    case "minecraft:blockstate_match": {
      const state = parseBlockStateIgnoringUnknownProperties(object.block_state, parser, `${what}.block_state`);
      return { test: (level, blockInfo) => level.blockStates.normalize(blockInfo.state) === state };
    }
    case "minecraft:tag_match": {
      const tagId = normalizeTagId(requireString(object, "tag", what));
      return { test: (level, blockInfo) => level.blockTags.is(blockInfo.name, tagId) };
    }
    case "minecraft:random_block_match": {
      const blockName = normalizeBlockId(requireString(object, "block", what));
      if (!parser.blockStates.isKnownBlock(blockName)) parser.blockStates.reportUnknownBlock(blockName, what);
      const probability = fround(requireNumber(object, "probability", what));
      return { test: (_level, blockInfo, random) => blockInfo.name === blockName && random.nextFloat() < probability };
    }
    case "minecraft:random_blockstate_match": {
      const state = parseBlockStateIgnoringUnknownProperties(object.block_state, parser, `${what}.block_state`);
      const probability = fround(requireNumber(object, "probability", what));
      return { test: (level, blockInfo, random) => level.blockStates.normalize(blockInfo.state) === state && random.nextFloat() < probability };
    }
    default:
      throw new Error(`${what}: unknown rule test ${typeId}`);
  }
}
