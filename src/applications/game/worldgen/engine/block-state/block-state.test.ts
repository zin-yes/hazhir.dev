// Checks the generated block table and the survival rules against the probe recorded from the real 1.20.6 classes
// (fixtures/block-state-reference.json.gz, written by ../features/fixtures/FeaturesReference.java).

import { afterAll, describe, expect, test } from "bun:test";
import { blockNameOf } from "../chunk";
import { BlockStateCatalog, UnknownBlockError } from "./block-state-catalog";
import { compactFlags, readRecordedBlocks } from "./generate-block-state-table.node";
import { SurvivalRules, type SurvivalLevel } from "./survival";

const startedAt = performance.now();
const recordedBlocks = readRecordedBlocks();
const allBlockNames = Object.keys(recordedBlocks);

function flagsOf(catalog: BlockStateCatalog, state: string): string {
  const info = catalog.info(state);
  const fluidLetter = { empty: "", water: "W", flowing_water: "F", lava: "L", flowing_lava: "G" }[info.fluid];
  return `${info.isAir ? "A" : ""}${info.blocksMotion ? "M" : ""}${info.isSolid ? "S" : ""}${info.isReplaceable ? "R" : ""}${fluidLetter}`;
}

describe("BlockStateCatalog", () => {
  const catalog = new BlockStateCatalog({ strict: true });

  test("every registered block's default state, partial state and recorded variants classify as in Java", () => {
    expect(allBlockNames.length).toBeGreaterThanOrEqual(1000);
    let checkedStates = 0;
    for (const [name, recorded] of Object.entries(recordedBlocks)) {
      expect(flagsOf(catalog, recorded.default)).toBe(compactFlags(recorded.flags));
      expect(flagsOf(catalog, name)).toBe(compactFlags(recorded.flags));
      for (const [state, flags] of Object.entries(recorded.variants ?? {})) {
        expect(`${state} ${flagsOf(catalog, state)}`).toBe(`${state} ${compactFlags(flags)}`);
        checkedStates++;
      }
      expect(catalog.info(recorded.default).isLeaves).toBe(Boolean(recorded.leaves));
      expect(catalog.info(recorded.default).isDoublePlant).toBe(Boolean(recorded.doublePlant));
    }
    expect(checkedStates).toBeGreaterThan(50);
  });

  test("production-shaped facts the heightmaps and predicates depend on", () => {
    expect(catalog.info("minecraft:water[level=0]").fluid).toBe("water");
    expect(catalog.info("minecraft:water[level=3]").fluid).toBe("flowing_water");
    expect(catalog.info("minecraft:water[level=3]").fluidAmount).toBe(5);
    expect(catalog.info("minecraft:oak_leaves[distance=7,persistent=false,waterlogged=true]").fluid).toBe("water");
    expect(catalog.info("minecraft:oak_leaves[distance=7,persistent=false,waterlogged=true]").isLeaves).toBe(true);
    expect(catalog.info("minecraft:sea_pickle[pickles=2,waterlogged=false]").fluid).toBe("empty");
    expect(catalog.info("minecraft:short_grass").blocksMotion).toBe(false);
    expect(catalog.info("minecraft:short_grass").isReplaceable).toBe(true);
    expect(catalog.info("minecraft:snow[layers=8]").blocksMotion).toBe(false);
    expect(catalog.info("minecraft:grass_block[snowy=true]").blocksMotion).toBe(true);
    expect(catalog.info("minecraft:cave_air").isAir).toBe(true);
    expect(catalog.normalize("minecraft:tall_grass")).toBe("minecraft:tall_grass[half=lower]");
    expect(catalog.withProperty("minecraft:tall_grass", "half", "upper")).toBe("minecraft:tall_grass[half=upper]");
  });

  test("unknown block names throw in strict mode and fall back to a counted solid block otherwise", () => {
    expect(() => catalog.info("minecraft:not_a_block")).toThrow(UnknownBlockError);
    const lenient = new BlockStateCatalog();
    const fallback = lenient.info("terralith:imaginary_stone");
    expect(fallback.known).toBe(false);
    expect(fallback.blocksMotion).toBe(true);
    lenient.info("terralith:imaginary_stone[a=b]");
    expect(lenient.unknownBlockCounts.get("terralith:imaginary_stone")).toBe(2);
  });
});

describe("SurvivalRules", () => {
  const catalog = new BlockStateCatalog({ strict: true });
  const rules = new SurvivalRules(catalog);
  const origin = { x: 0, y: 64, z: 0 };

  function levelWith(neighbors: Array<[number, number, number, string]>, rawBrightness: number): SurvivalLevel {
    return {
      getBlockState(x, y, z) {
        for (const [neighborX, neighborY, neighborZ, state] of neighbors) {
          if (x === neighborX && y === neighborY && z === neighborZ) return state;
        }
        return "minecraft:air";
      },
      getRawBrightness: () => rawBrightness,
    };
  }

  test("reproduces the recorded probe for every block state and every single-neighbor placement", () => {
    let mismatches: string[] = [];
    let comparisons = 0;
    const defaultStates = allBlockNames.map((name) => recordedBlocks[name]!.default);
    for (const recorded of Object.values(recordedBlocks)) {
      for (const [state, probe] of Object.entries(recorded.survival)) {
        const airResult = probe.air === true;
        const survivesAlone = rules.canSurvive(state, levelWith([], 15), origin.x, origin.y, origin.z);
        comparisons++;
        if (survivesAlone !== airResult) mismatches.push(`${state} in air`);
        const directions: Array<[keyof typeof probe, number, number, number]> = [
          ["below", 0, -1, 0],
          ["above", 0, 1, 0],
          ["north", 0, 0, -1],
        ];
        for (const [probeName, offsetX, offsetY, offsetZ] of directions) {
          const differing = new Set((probe[probeName] as string[] | undefined) ?? []);
          if (differing.size === 0 && probe.air === true && Object.keys(probe).length === 1) continue;
          for (const neighborState of defaultStates) {
            const expected = differing.has(blockNameOf(neighborState)) ? !airResult : airResult;
            const level = levelWith([[origin.x + offsetX, origin.y + offsetY, origin.z + offsetZ, neighborState]], 15);
            comparisons++;
            if (rules.canSurvive(state, level, origin.x, origin.y, origin.z) !== expected) {
              mismatches.push(`${state} with ${probeName} ${neighborState}: expected ${expected}`);
            }
          }
        }
        for (const [probeName, extraNeighbor, brightness] of [
          ["belowWithWaterBesideIt", [1, 63, 0, "minecraft:water[level=0]"], 15],
          ["belowInDarkness", undefined, 0],
        ] as const) {
          if (!probe.below) continue;
          const differing = new Set(probe[probeName] ?? probe.below);
          for (const neighborState of defaultStates) {
            const neighbors: Array<[number, number, number, string]> = [[0, 63, 0, neighborState]];
            if (extraNeighbor) neighbors.push([...extraNeighbor]);
            const expected = differing.has(blockNameOf(neighborState)) ? !airResult : airResult;
            comparisons++;
            if (rules.canSurvive(state, levelWith(neighbors, brightness), 0, 64, 0) !== expected) {
              mismatches.push(`${state} ${probeName} ${neighborState}: expected ${expected}`);
            }
          }
        }
      }
    }
    if (mismatches.length > 0) mismatches = mismatches.slice(0, 20);
    expect(mismatches).toEqual([]);
    expect(comparisons).toBeGreaterThan(1_000_000);
  });

  test("hand-ported multi-neighbor rules (CactusBlock, SugarCaneBlock, DoublePlantBlock, wall attachment)", () => {
    const sand: [number, number, number, string] = [0, 63, 0, "minecraft:sand"];
    expect(rules.canSurvive("minecraft:cactus", levelWith([sand], 0), 0, 64, 0)).toBe(true);
    expect(rules.canSurvive("minecraft:cactus", levelWith([sand, [1, 64, 0, "minecraft:stone"]], 0), 0, 64, 0)).toBe(false);
    expect(rules.canSurvive("minecraft:cactus", levelWith([sand, [0, 65, 0, "minecraft:water[level=0]"]], 0), 0, 64, 0)).toBe(false);
    expect(rules.canSurvive("minecraft:sugar_cane", levelWith([sand], 0), 0, 64, 0)).toBe(false);
    expect(rules.canSurvive("minecraft:sugar_cane", levelWith([sand, [0, 63, -1, "minecraft:water[level=0]"]], 0), 0, 64, 0)).toBe(true);
    const lowerHalf: [number, number, number, string] = [0, 63, 0, "minecraft:tall_grass[half=lower]"];
    expect(rules.canSurvive("minecraft:tall_grass[half=upper]", levelWith([lowerHalf], 0), 0, 64, 0)).toBe(true);
    expect(rules.canSurvive("minecraft:tall_grass[half=upper]", levelWith([[0, 63, 0, "minecraft:tall_grass[half=upper]"]], 0), 0, 64, 0)).toBe(false);
    expect(rules.canSurvive("minecraft:cocoa[age=0,facing=east]", levelWith([[1, 64, 0, "minecraft:jungle_log[axis=y]"]], 0), 0, 64, 0)).toBe(true);
    expect(rules.canSurvive("minecraft:cocoa[age=0,facing=east]", levelWith([[0, 64, -1, "minecraft:jungle_log[axis=y]"]], 0), 0, 64, 0)).toBe(false);
    expect(rules.canSurvive("minecraft:wall_torch[facing=east]", levelWith([[-1, 64, 0, "minecraft:stone"]], 0), 0, 64, 0)).toBe(true);
    const water: [number, number, number, string] = [0, 64, 0, "minecraft:water[level=0]"];
    expect(rules.canSurvive("minecraft:tall_seagrass[half=lower]", levelWith([water, [0, 63, 0, "minecraft:sand"]], 0), 0, 64, 0)).toBe(true);
    expect(rules.canSurvive("minecraft:tall_seagrass[half=lower]", levelWith([water, [0, 63, 0, "minecraft:magma_block"]], 0), 0, 64, 0)).toBe(false);
  });
});

afterAll(() => {
  console.log(`block-state tests: ${(performance.now() - startedAt).toFixed(0)} ms`);
});
