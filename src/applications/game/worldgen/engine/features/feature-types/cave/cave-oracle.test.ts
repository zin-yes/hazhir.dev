// Runs every Terralith/vanilla configured feature of the cave and ore types on the layered synthetic world and
// compares with the real 1.20.6 classes (fixtures/cave-reference.json.gz, recorded by fixtures/CaveReference.java):
// the return value, the final block differences against the base world, and the random state afterwards.

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { BlockStateCatalog, BlockTagIndex } from "../../../block-state";
import { toGameBlock } from "../../../blocks/minecraft-block-map";
import { XoroshiroRandomSource } from "../../../random";
import { BlockPos } from "../../core/block-pos";
import { WorldgenRandom } from "../../core/worldgen-random";
import { type FeatureChunkGenerator, FeatureTypeRegistry } from "../../feature/feature-type";
import { FeatureResolver } from "../../feature/feature-parser";
import type { ConfiguredFeature } from "../../feature/placed-feature";
import { DecorationRegion } from "../../level/decoration-region";
import { loadTerralithDatapacks } from "../../testing/feature-fixtures.node";
import { CORE_FEATURE_TYPES } from "../index";
import type { SimpleRandomSelectorConfig } from "../simple-random-selector";
import { CAVE_FEATURE_TYPES } from "./index";
import { CaveWorldSource } from "./testing/cave-world";

const startedAt = performance.now();
const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const CENTER_CHUNK_X = 3;
const CENTER_CHUNK_Z = -7;

interface RecordedRun {
  key: string;
  type: string;
  origin: number;
  seed: number;
  placed?: boolean;
  nextLong?: string;
  error?: string;
  writes: Array<[number, number, number, number]>;
}

interface CaveReference {
  origins: Array<[string, number, number, number]>;
  states: string[];
  runs: RecordedRun[];
}

const reference = JSON.parse(gunzipSync(readFileSync(join(MODULE_DIRECTORY, "fixtures", "cave-reference.json.gz"))).toString()) as CaveReference;
const datapacks = loadTerralithDatapacks();
const blockStates = new BlockStateCatalog({ strict: true });
const blockTags = new BlockTagIndex(datapacks.blockTags);
const source = new CaveWorldSource(blockStates);
const generator: FeatureChunkGenerator = { minY: -64, genDepth: 384, seaLevel: 63, biomeHasFeature: () => false };
const resolver = new FeatureResolver({
  registries: datapacks.registries,
  blockStates,
  featureTypes: new FeatureTypeRegistry([...CORE_FEATURE_TYPES, ...CAVE_FEATURE_TYPES]),
  strict: true,
});

/** "configured:ns:id", "placed:ns:id" (inline feature of a placed feature) or "selector:ns:id#n" (inline in a simple_random_selector). */
function resolveFeature(key: string): ConfiguredFeature {
  const separator = key.indexOf(":");
  const kind = key.slice(0, separator);
  const reference = key.slice(separator + 1);
  if (kind === "configured") return resolver.configuredFeature(reference);
  if (kind === "placed") return resolver.placedFeature(reference).feature;
  const [selectorId, index] = reference.split("#");
  const selector = resolver.configuredFeature(selectorId).config as SimpleRandomSelectorConfig;
  return selector.features[Number(index)]!.feature;
}

function runFeature(run: RecordedRun): { placed: boolean; nextLong: string; writes: Map<string, string> } {
  const [, originX, originY, originZ] = reference.origins[run.origin]!;
  const region = new DecorationRegion({ source, seed: BigInt(1337), centerChunkX: CENTER_CHUNK_X, centerChunkZ: CENTER_CHUNK_Z, blockStates, blockTags });
  const random = new WorldgenRandom(new XoroshiroRandomSource(BigInt(run.seed)));
  const placed = resolveFeature(run.key).place(region, generator, random, new BlockPos(originX, originY, originZ));
  const nextLong = random.nextLong().toString();
  const writes = new Map<string, string>();
  for (const patch of region.extractPatches()) {
    for (let position = 0; position < patch.indices.length; position++) {
      const index = patch.indices[position]!;
      const y = Math.floor(index / 256) + region.minY;
      const x = patch.chunkX * 16 + (index & 15);
      const z = patch.chunkZ * 16 + ((index >> 4) & 15);
      const state = region.blockPalette!.stateOf(patch.paletteIds[position]!);
      if (state !== source.baseStateAt(x, y, z)) writes.set(`${x},${y},${z}`, state);
    }
  }
  return { placed, nextLong, writes };
}

function describeMismatch(run: RecordedRun, actual: ReturnType<typeof runFeature>): string | undefined {
  const [originName] = reference.origins[run.origin]!;
  const label = `${run.key} @ ${originName} seed ${run.seed}`;
  if (actual.placed !== run.placed) return `${label}: placed ${actual.placed} vs ${run.placed}`;
  const expected = new Map<string, string>();
  for (const [x, y, z, stateIndex] of run.writes) expected.set(`${x},${y},${z}`, reference.states[stateIndex]!);
  const differing: string[] = [];
  for (const [position, state] of expected) if (actual.writes.get(position) !== state) differing.push(`${position}: ${actual.writes.get(position)} vs ${state}`);
  for (const [position, state] of actual.writes) if (!expected.has(position)) differing.push(`${position}: ${state} vs (unchanged)`);
  if (differing.length > 0) return `${label}: ${differing.length} writes differ, first ${differing.slice(0, 3).join("; ")}`;
  if (actual.nextLong !== run.nextLong) return `${label}: random state differs after placement`;
  return undefined;
}

/** Ores are cheap per run but numerous (52 configured features x 45 origins x 2 seeds): compare the first seed only to keep the default suite fast. */
const FIRST_SEED_ONLY_TYPES = new Set(["ore"]);
const firstSeed = reference.runs[0]!.seed;
function isComparedByDefault(run: RecordedRun): boolean {
  return !FIRST_SEED_ONLY_TYPES.has(run.type) || run.seed === firstSeed;
}

const featureTypesOf = new Map<string, string[]>();
for (const run of reference.runs) {
  const keys = featureTypesOf.get(run.type) ?? [];
  if (!keys.includes(run.key)) keys.push(run.key);
  featureTypesOf.set(run.type, keys);
}

describe("cave and ore feature types against the real classes", () => {
  test("the recording covers every ported type with populated, placing runs", () => {
    for (const type of ["ore", "scattered_ore", "geode", "dripstone_cluster", "large_dripstone", "pointed_dripstone", "underwater_magma", "netherrack_replace_blobs", "lake"]) {
      const runs = reference.runs.filter((run) => run.type === type);
      expect(runs.length).toBeGreaterThan(20);
      expect(runs.filter((run) => run.placed && run.writes.length > 0).length).toBeGreaterThan(5);
      expect(runs.filter((run) => run.error !== undefined)).toEqual([]);
    }
  });

  for (const [type, keys] of featureTypesOf) {
    test(`${type}: ${keys.length} configured features match the Java writes`, () => {
      const typeStartedAt = performance.now();
      const mismatches: string[] = [];
      let comparedRuns = 0;
      let comparedWrites = 0;
      for (const run of reference.runs) {
        if (run.type !== type || !isComparedByDefault(run)) continue;
        comparedRuns++;
        comparedWrites += run.writes.length;
        const mismatch = describeMismatch(run, runFeature(run));
        if (mismatch) mismatches.push(mismatch);
      }
      console.log(`${type}: ${comparedRuns} runs, ${comparedWrites} recorded writes, ${(performance.now() - typeStartedAt).toFixed(0)} ms`);
      expect(mismatches.slice(0, 8)).toEqual([]);
    });
  }
});

describe("unported feature types", () => {
  test("fossil and monster_room place nothing and parse their real Terralith configs", () => {
    const fossil = resolver.configuredFeature("minecraft:fossil_coal");
    const monsterRoom = resolver.configuredFeature("minecraft:monster_room");
    const region = new DecorationRegion({ source, seed: BigInt(1337), centerChunkX: CENTER_CHUNK_X, centerChunkZ: CENTER_CHUNK_Z, blockStates, blockTags });
    const random = new WorldgenRandom(new XoroshiroRandomSource(BigInt(5)));
    expect(fossil.place(region, generator, random, new BlockPos(50, 12, -105))).toBe(false);
    expect(monsterRoom.place(region, generator, random, new BlockPos(50, 12, -105))).toBe(false);
    expect(region.extractPatches()).toEqual([]);
  });
});

/** Nether-only (base_stone_nether target of ore_ancient_debris_*): not in the overworld game block map. */
const KNOWN_UNMAPPED_BLOCKS = new Set(["minecraft:ancient_debris"]);

describe("block names", () => {
  test("every block state the cave features can place is accepted by toGameBlock (except known nether-only blocks)", () => {
    const placeable = new Set<string>(reference.states);
    const collectStates = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(collectStates);
      else if (value && typeof value === "object") {
        const object = value as Record<string, unknown>;
        if (typeof object.Name === "string") placeable.add(blockStates.normalize(`${object.Name}${formatProperties(object.Properties)}`));
        Object.values(object).forEach(collectStates);
      }
    };
    for (const type of featureTypesOf.keys()) {
      for (const key of featureTypesOf.get(type)!) {
        const kind = key.slice(0, key.indexOf(":"));
        if (kind === "configured") collectStates(datapacks.registries.configured_feature[key.slice("configured:".length)]);
      }
    }
    // States written by code rather than by config: dripstone, magma and the fillers.
    for (const name of ["dripstone_block", "pointed_dripstone", "magma_block", "water", "cave_air", "air", "lava"]) placeable.add(blockStates.normalize(blockStates.defaultState(`minecraft:${name}`)));
    expect(placeable.size).toBeGreaterThan(60);
    const rejected: string[] = [];
    for (const state of placeable) {
      try {
        toGameBlock(state);
      } catch {
        rejected.push(state);
      }
    }
    console.log(`block states toGameBlock rejects: ${rejected.join(", ") || "none"}`);
    expect(rejected.filter((state) => !KNOWN_UNMAPPED_BLOCKS.has(blockStates.info(state).name))).toEqual([]);
  });
});

function formatProperties(properties: unknown): string {
  if (!properties || typeof properties !== "object") return "";
  const entries = Object.entries(properties as Record<string, string>).map(([name, value]) => `${name}=${value}`);
  return entries.length > 0 ? `[${entries.join(",")}]` : "";
}

afterAll(() => {
  console.log(`cave oracle tests: ${(performance.now() - startedAt).toFixed(0)} ms`);
});
