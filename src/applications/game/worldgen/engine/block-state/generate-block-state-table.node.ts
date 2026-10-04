// Node-only generator: turns fixtures/block-state-reference.json.gz (recorded from the real 1.20.6 classes by
// ../features/fixtures/FeaturesReference.java) into block-state-table.generated.ts, the browser-safe table that
// BlockStateCatalog and canSurvive read. Run: bun src/applications/game/worldgen/engine/block-state/generate-block-state-table.node.ts
//
// Survival sets ("which neighbor blocks let this block survive") are stored as a base set computed from the table
// itself (sturdy faces, solid, blocksMotion, not-air, all, none) plus explicit additions and removals, which keeps
// the table small while staying exact against the recorded probe.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

export interface RecordedSurvivalProbe {
  air?: boolean;
  error?: boolean;
  below?: string[];
  above?: string[];
  north?: string[];
  belowWithWaterBesideIt?: string[];
  belowInDarkness?: string[];
}

export interface RecordedBlock {
  default: string;
  flags: string;
  sturdy: string;
  leaves?: boolean;
  doublePlant?: boolean;
  liquid?: boolean;
  waterloggable?: boolean;
  variants?: Record<string, string>;
  survival: Record<string, RecordedSurvivalProbe>;
}

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const BLOCK_STATE_FIXTURE_PATH = join(MODULE_DIRECTORY, "fixtures", "block-state-reference.json.gz");
const GENERATED_PATH = join(MODULE_DIRECTORY, "block-state-table.generated.ts");

export function readRecordedBlocks(): Record<string, RecordedBlock> {
  return (JSON.parse(gunzipSync(readFileSync(BLOCK_STATE_FIXTURE_PATH)).toString()) as { blocks: Record<string, RecordedBlock> }).blocks;
}

const FLUID_LETTERS: Record<string, string> = {
  "": "",
  "minecraft:water": "W",
  "minecraft:flowing_water": "F",
  "minecraft:lava": "L",
  "minecraft:flowing_lava": "G",
};

/** Recorded "AMSR|minecraft:water" -> table letters "AMSRW". */
export function compactFlags(recordedFlags: string): string {
  const [stateLetters, fluidName] = recordedFlags.split("|") as [string, string];
  const fluidLetter = FLUID_LETTERS[fluidName];
  if (fluidLetter === undefined) throw new Error(`Unknown fluid ${fluidName}`);
  return stateLetters + fluidLetter;
}

function propertiesOf(state: string): Record<string, string> {
  const bracketIndex = state.indexOf("[");
  if (bracketIndex === -1) return {};
  const properties: Record<string, string> = {};
  for (const pair of state.slice(bracketIndex + 1, -1).split(",")) {
    const [key, value] = pair.split("=") as [string, string];
    properties[key] = value;
  }
  return properties;
}

function propertyString(properties: Record<string, string>): string {
  return Object.keys(properties)
    .sort()
    .map((key) => `${key}=${properties[key]}`)
    .join(",");
}

/** Properties of `state` that differ from the default state, as "key=value,..." (empty for the default state). */
export function differingProperties(state: string, defaultState: string): string {
  const properties = propertiesOf(state);
  const defaults = propertiesOf(defaultState);
  const differing: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) if (defaults[key] !== value) differing[key] = value;
  return propertyString(differing);
}

type BaseSetName = "none" | "all" | "notAir" | "solid" | "motion" | "sturdyUp" | "sturdyDown" | "sturdySide";

export function baseSetMembers(blocks: Record<string, RecordedBlock>): Record<BaseSetName, Set<string>> {
  const names = Object.keys(blocks);
  const select = (predicate: (block: RecordedBlock) => boolean) => new Set(names.filter((name) => predicate(blocks[name]!)));
  return {
    none: new Set(),
    all: new Set(names),
    notAir: select((block) => !block.flags.startsWith("A")),
    solid: select((block) => block.flags.split("|")[0]!.includes("S")),
    motion: select((block) => block.flags.split("|")[0]!.includes("M")),
    sturdyUp: select((block) => block.sturdy.includes("u")),
    sturdyDown: select((block) => block.sturdy.includes("d")),
    sturdySide: select((block) => block.sturdy.includes("s")),
  };
}

export interface SurvivalSetData {
  base: BaseSetName;
  plus?: string[];
  minus?: string[];
}

function encodeSet(members: Set<string>, baseSets: Record<BaseSetName, Set<string>>): SurvivalSetData {
  let best: SurvivalSetData | undefined;
  let bestCost = Infinity;
  for (const [baseName, baseMembers] of Object.entries(baseSets) as [BaseSetName, Set<string>][]) {
    const plus = [...members].filter((name) => !baseMembers.has(name)).sort();
    const minus = [...baseMembers].filter((name) => !members.has(name)).sort();
    const cost = plus.length + minus.length;
    if (cost < bestCost) {
      bestCost = cost;
      best = { base: baseName, ...(plus.length ? { plus } : {}), ...(minus.length ? { minus } : {}) };
    }
  }
  return best!;
}

function generate(): string {
  const blocks = readRecordedBlocks();
  const allNames = Object.keys(blocks);
  const baseSets = baseSetMembers(blocks);
  const sets: SurvivalSetData[] = [];
  const setIndexByKey = new Map<string, number>();
  const internSet = (survivingWith: Set<string>): number => {
    const encoded = encodeSet(survivingWith, baseSets);
    const key = JSON.stringify(encoded);
    let index = setIndexByKey.get(key);
    if (index === undefined) {
      index = sets.length;
      sets.push(encoded);
      setIndexByKey.set(key, index);
    }
    return index;
  };
  /** The probe lists neighbors whose result differs from the all-air result; turn it into "survives with". */
  const survivingSet = (airResult: boolean, differing: string[] | undefined): Set<string> => {
    const differingSet = new Set(differing ?? []);
    return new Set(allNames.filter((name) => (differingSet.has(name) ? !airResult : airResult)));
  };

  const entries: Record<string, unknown[]> = {};
  for (const [name, block] of Object.entries(blocks)) {
    let extraLetters = "";
    if (block.leaves) extraLetters += "Y";
    if (block.doublePlant) extraLetters += "D";
    if (block.liquid) extraLetters += "I";
    if (block.waterloggable) extraLetters += "Q";
    const defaultProperties = block.default.includes("[") ? block.default.slice(block.default.indexOf("[") + 1, -1) : "";
    const variants: Record<string, string> = {};
    for (const [state, flags] of Object.entries(block.variants ?? {})) variants[differingProperties(state, block.default)] = compactFlags(flags);
    const survival: Record<string, Record<string, number>> = {};
    for (const [state, probe] of Object.entries(block.survival)) {
      if (probe.error) throw new Error(`Survival probe failed for ${state}`);
      const trivial = probe.air === true && Object.keys(probe).length === 1;
      if (trivial) continue;
      const airResult = probe.air === true;
      const rule: Record<string, number> = { a: airResult ? 1 : 0 };
      if (probe.below) rule.b = internSet(survivingSet(airResult, probe.below));
      if (probe.above) rule.u = internSet(survivingSet(airResult, probe.above));
      if (probe.north) rule.n = internSet(survivingSet(airResult, probe.north));
      if (probe.belowWithWaterBesideIt) rule.w = internSet(survivingSet(airResult, probe.belowWithWaterBesideIt));
      if (probe.belowInDarkness) rule.k = internSet(survivingSet(airResult, probe.belowInDarkness));
      survival[differingProperties(state, block.default)] = rule;
    }
    const entry: unknown[] = [defaultProperties, compactFlags(block.flags) + extraLetters, block.sturdy];
    if (Object.keys(variants).length || Object.keys(survival).length) entry.push(variants);
    if (Object.keys(survival).length) entry.push(survival);
    entries[name] = entry;
  }
  return [
    "// GENERATED by generate-block-state-table.node.ts from fixtures/block-state-reference.json.gz. Do not edit by hand.",
    "// Entry: [default properties, flags, sturdy faces, variant flags by differing properties?, survival rules by differing properties?]",
    "// Flags: A air, M blocksMotion, S isSolid, R canBeReplaced, W/F water source/flowing, L/G lava source/flowing,",
    "// Y LeavesBlock, D DoublePlantBlock, I liquid(), Q waterloggable. Sturdy faces: d u n s w e (full face sturdy).",
    "// Survival rule: a = survives with only air around; b/u/n = survival set index for the single neighbor below/above/north;",
    "// w = below set when water is beside the below block; k = below set in darkness (raw brightness 0).",
    "",
    'import type { GeneratedBlockEntry, GeneratedSurvivalSet } from "./block-state-table-types";',
    "",
    `export const GENERATED_SURVIVAL_SETS: GeneratedSurvivalSet[] = ${JSON.stringify(sets)};`,
    "",
    `export const GENERATED_BLOCK_ENTRIES: Record<string, GeneratedBlockEntry> = ${JSON.stringify(entries)};`,
    "",
  ].join("\n");
}

if (import.meta.main) {
  writeFileSync(GENERATED_PATH, generate());
  console.log(`wrote ${GENERATED_PATH}`);
}
