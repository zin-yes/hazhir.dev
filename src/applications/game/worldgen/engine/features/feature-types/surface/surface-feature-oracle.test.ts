// Compares the surface feature types with the real 1.20.6 classes (fixtures/surface-reference.json.gz, recorded by
// fixtures/SurfaceReference.java): final block writes, the placed flag and the random state after placement for
// freeze_top_layer, iceberg, blue_ice, ice_spike, forest_rock and desert_well on synthetic scenario terrain whose
// biome changes every 8 columns, plus Biome.getTemperature (float bits) for every overworld biome.
// The terrain and biome functions below mirror SurfaceReference.java: keep them identical.

import { afterAll, describe, expect, test } from "bun:test";
import { BlockStateCatalog, BlockTagIndex, SurvivalRules } from "../../../block-state";
import { toGameBlock } from "../../../blocks/minecraft-block-map";
import { BlockPalette, ChunkBlocks } from "../../../chunk";
import { XoroshiroRandomSource } from "../../../random";
import { BiomeTemperatureSampler, createBiomeClimateLookup } from "../../../surface/biome-temperature";
import { BlockPos } from "../../core/block-pos";
import { WorldgenRandom } from "../../core/worldgen-random";
import { FeatureDecorator } from "../../decoration/feature-decorator";
import { FeatureResolver } from "../../feature/feature-parser";
import { type FeatureChunkGenerator, FeatureTypeRegistry } from "../../feature/feature-type";
import type { BaseColumnSource } from "../../level/base-column-source";
import { DecorationRegion } from "../../level/decoration-region";
import { loadTerralithDatapacks } from "../../testing/feature-fixtures.node";
import { CORE_FEATURE_TYPES } from "../index";
import { SURFACE_FEATURE_TYPES } from "./index";
import { loadSurfaceReference, type SurfaceReferenceCase } from "./surface-reference.node";

const startedAt = performance.now();
const reference = loadSurfaceReference();
const datapacks = loadTerralithDatapacks();

interface Scenario {
  readonly base: number;
  readonly heightScale: number;
  readonly kind: "land" | "ocean" | "snowfield" | "desert";
}

const SCENARIOS: Record<string, Scenario> = {
  land: { base: 66, heightScale: 1, kind: "land" },
  mountain: { base: 95, heightScale: 1, kind: "land" },
  mixed: { base: 62, heightScale: 3, kind: "land" },
  ocean: { base: 38, heightScale: 1, kind: "ocean" },
  shallow_ocean: { base: 54, heightScale: 1, kind: "ocean" },
  snowfield: { base: 66, heightScale: 1, kind: "snowfield" },
  desert: { base: 66, heightScale: 1, kind: "desert" },
};

function floorMod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function surfaceHeight(scenario: Scenario, x: number, z: number): number {
  return scenario.base + scenario.heightScale * (floorMod(x * 7 + z * 13, 11) + floorMod(x * 3 - z * 5, 7));
}

function surfaceBlock(scenario: Scenario, x: number, z: number): string {
  const variant = floorMod(x * 5 + z * 11, 13);
  switch (scenario.kind) {
    case "snowfield":
      return floorMod(x + z * 3, 19) === 0 ? "minecraft:packed_ice" : "minecraft:snow_block";
    case "desert":
      return "minecraft:sand";
    case "ocean":
      return variant < 6 ? "minecraft:gravel" : "minecraft:sand";
    default:
      switch (variant) {
        case 0:
        case 1:
          return "minecraft:snow_block";
        case 2:
          return "minecraft:packed_ice";
        case 3:
          return "minecraft:ice";
        case 4:
          return "minecraft:sand";
        case 5:
          return "minecraft:oak_leaves[distance=1,persistent=true]";
        case 7:
          return "minecraft:podzol";
        case 8:
          return "minecraft:mycelium";
        case 9:
          return "minecraft:dirt";
        case 10:
          return "minecraft:stone";
        case 11:
          return "minecraft:gravel";
        default:
          return "minecraft:grass_block";
      }
  }
}

function subsurfaceBlock(scenario: Scenario): string {
  switch (scenario.kind) {
    case "desert":
      return "minecraft:sandstone";
    case "ocean":
      return "minecraft:gravel";
    case "snowfield":
      return "minecraft:snow_block";
    default:
      return "minecraft:dirt";
  }
}

function scenarioBlock(scenario: Scenario, x: number, y: number, z: number): string {
  if (y < -64 || y >= 320) return "minecraft:void_air";
  if (y === -64) return "minecraft:bedrock";
  const height = surfaceHeight(scenario, x, z);
  if (y <= height) {
    if (scenario.kind === "desert" && floorMod(x + 2 * z, 29) === 0 && (y === height - 1 || y === height - 2)) return "minecraft:cave_air";
    if (y === height) return surfaceBlock(scenario, x, z);
    if (y >= height - 3) return subsurfaceBlock(scenario);
    return "minecraft:stone";
  }
  if (scenario.kind === "ocean" && y >= 50 && y <= 62 && floorMod(x * 3 + z * 5, 7) === 0) return "minecraft:packed_ice";
  if (y <= 62) {
    if (y === 62 && height < 62 && floorMod(x * 3 + z * 7, 10) === 0) return "minecraft:kelp[age=5]";
    return "minecraft:water[level=0]";
  }
  if (y === height + 1 && scenario.kind === "land" && floorMod(x + z, 17) === 0) return "minecraft:snow[layers=3]";
  return "minecraft:air";
}

class ScenarioSource implements BaseColumnSource {
  readonly settings = { minY: -64, height: 384, seaLevel: 63 };
  readonly palette = new BlockPalette();
  private readonly columns = new Map<string, ChunkBlocks>();

  constructor(
    private readonly scenario: Scenario,
    private readonly biomeNames: readonly string[],
  ) {}

  generateBaseColumn(chunkX: number, chunkZ: number): ChunkBlocks {
    const key = `${chunkX},${chunkZ}`;
    let column = this.columns.get(key);
    if (!column) {
      column = new ChunkBlocks(chunkX, chunkZ, this.settings.minY, this.settings.height, this.palette);
      for (let y = column.minY; y <= column.maxY; y++) {
        for (let localZ = 0; localZ < 16; localZ++) {
          for (let localX = 0; localX < 16; localX++) column.setState(localX, y, localZ, scenarioBlock(this.scenario, chunkX * 16 + localX, y, chunkZ * 16 + localZ));
        }
      }
      this.columns.set(key, column);
    }
    return column;
  }

  rawBiomeAtQuart(): string {
    return this.biomeNames[0]!;
  }

  biomeAt(blockX: number, _blockY: number, blockZ: number): string {
    return this.biomeNames[floorMod((blockX >> 3) * 5 + (blockZ >> 3) * 3, this.biomeNames.length)]!;
  }
}

const featureTypes = new FeatureTypeRegistry([...CORE_FEATURE_TYPES, ...SURFACE_FEATURE_TYPES]);
const blockStates = new BlockStateCatalog({ strict: true });
const blockTags = new BlockTagIndex(datapacks.blockTags);
const survival = new SurvivalRules(blockStates);
const resolver = new FeatureResolver({ registries: datapacks.registries, blockStates, featureTypes, strict: true });
const temperatureSampler = new BiomeTemperatureSampler(createBiomeClimateLookup(datapacks.registries.biome));
const generator: FeatureChunkGenerator = {
  minY: -64,
  genDepth: 384,
  seaLevel: 63,
  biomeHasFeature: () => true,
  biomeTemperature: (biomeId, x, y, z) => temperatureSampler.getTemperature(biomeId, x, y, z),
};
const sourcesByScenario = new Map<string, ScenarioSource>();

function sourceOf(scenarioName: string): ScenarioSource {
  let source = sourcesByScenario.get(scenarioName);
  if (!source) {
    source = new ScenarioSource(SCENARIOS[scenarioName]!, reference.biomes);
    sourcesByScenario.set(scenarioName, source);
  }
  return source;
}

interface CaseOutcome {
  placed: boolean;
  nextLong: string;
  writes: Map<string, string>;
}

function runCase(testCase: SurfaceReferenceCase): CaseOutcome {
  const [originX, originY, originZ] = testCase.origin;
  const source = sourceOf(testCase.scenario);
  const region = new DecorationRegion({ source, seed: BigInt(1337), centerChunkX: originX >> 4, centerChunkZ: originZ >> 4, blockStates, blockTags, survival });
  const random = new WorldgenRandom(new XoroshiroRandomSource(BigInt(testCase.seed)));
  const placed = resolver.configuredFeature(testCase.feature).place(region, generator, random, new BlockPos(originX, originY, originZ));
  const writes = new Map<string, string>();
  for (const patch of region.extractPatches()) {
    for (let position = 0; position < patch.indices.length; position++) {
      const index = patch.indices[position]!;
      const x = patch.chunkX * 16 + (index & 15);
      const z = patch.chunkZ * 16 + ((index >> 4) & 15);
      const y = Math.floor(index / 256) + region.minY;
      writes.set(`${x},${y},${z}`, region.blockPalette!.stateOf(patch.paletteIds[position]!));
    }
  }
  return { placed, nextLong: random.nextLong().toString(), writes };
}

function describeMismatch(testCase: SurfaceReferenceCase, outcome: CaseOutcome): string | undefined {
  const expected = new Map<string, string>();
  for (const [x, y, z, state] of testCase.writes!) expected.set(`${x},${y},${z}`, state);
  const label = `${testCase.feature} ${testCase.scenario} seed ${testCase.seed} at ${testCase.origin.join(",")}`;
  if (outcome.placed !== testCase.placed) return `${label}: placed ${outcome.placed} vs ${testCase.placed}`;
  for (const [position, state] of expected) {
    if (outcome.writes.get(position) !== state) return `${label}: ${position} is ${outcome.writes.get(position)} vs ${state} (${outcome.writes.size} vs ${expected.size} writes)`;
  }
  if (outcome.writes.size !== expected.size) {
    const extra = [...outcome.writes.keys()].find((position) => !expected.has(position));
    return `${label}: extra write at ${extra} (${outcome.writes.size} vs ${expected.size} writes)`;
  }
  if (outcome.nextLong !== testCase.nextLong) return `${label}: random state differs after placement`;
  return undefined;
}

function featureCases(featureId: string): SurfaceReferenceCase[] {
  return reference.cases.filter((testCase) => testCase.feature === featureId);
}

function expectFeatureMatchesJava(featureId: string): { cases: number; placedCases: number; writes: number } {
  const cases = featureCases(featureId);
  const mismatches: string[] = [];
  let placedCases = 0;
  let writes = 0;
  for (const testCase of cases) {
    expect(testCase.error).toBeUndefined();
    const outcome = runCase(testCase);
    const mismatch = describeMismatch(testCase, outcome);
    if (mismatch) mismatches.push(mismatch);
    if (testCase.placed) placedCases++;
    writes += testCase.writes!.length;
  }
  expect(mismatches.slice(0, 5)).toEqual([]);
  return { cases: cases.length, placedCases, writes };
}

describe("freeze_top_layer inside the real decoration step loop", () => {
  test("a snowy_plains origin decorated by FeatureDecorator gets snow layers through the default generator temperature", () => {
    const source = new ScenarioSource(SCENARIOS.land!, ["minecraft:snowy_plains"]);
    const decorator = new FeatureDecorator({
      source,
      seed: BigInt(1337),
      registries: datapacks.registries,
      blockTags: datapacks.blockTags,
      possibleBiomes: ["minecraft:snowy_plains"],
      featureTypes,
    });
    const region = decorator.createRegion(3, -7);
    const trace: Array<{ featureKey: string; placed: boolean }> = [];
    decorator.decorateInRegion(region, trace);
    expect(trace.find((entry) => entry.featureKey === "minecraft:freeze_top_layer")?.placed).toBe(true);
    expect(decorator.diagnostics.placementErrors.get("minecraft:freeze_top_layer")).toBeUndefined();
    let snowLayers = 0;
    for (const patch of region.extractPatches()) {
      for (const paletteId of patch.paletteIds) {
        const state = region.blockPalette!.stateOf(paletteId);
        if (state === "minecraft:snow[layers=1]") snowLayers++;
      }
    }
    expect(snowLayers).toBeGreaterThan(100);
  });
});

describe("Biome.getTemperature against the real classes", () => {
  test("every overworld biome matches bit for bit below and above y 80, with and without the frozen modifier", () => {
    const biomeCount = reference.temperatures.length;
    expect(biomeCount).toBeGreaterThan(100);
    const mismatches: string[] = [];
    const floatView = new Float32Array(1);
    const bitsView = new Int32Array(floatView.buffer);
    const biomesWithFrozenModifier = new Set<string>();
    for (const entry of reference.temperatures) {
      if (datapacks.registries.biome[entry.biome]?.temperature_modifier === "frozen") biomesWithFrozenModifier.add(entry.biome);
      reference.temperaturePoints.forEach(([x, y, z], pointIndex) => {
        floatView[0] = temperatureSampler.getTemperature(entry.biome, x, y, z);
        if (bitsView[0] !== entry.temperatureBits[pointIndex]) mismatches.push(`${entry.biome} at ${x},${y},${z}: ${bitsView[0]} vs ${entry.temperatureBits[pointIndex]}`);
      });
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(biomesWithFrozenModifier.size).toBeGreaterThanOrEqual(2);
    expect(reference.temperaturePoints.filter(([, y]) => y > 80).length).toBeGreaterThanOrEqual(8);
  });
});

describe("surface feature types against the real classes", () => {
  test("freeze_top_layer places the same ice and snow layers on every scenario", () => {
    const summary = expectFeatureMatchesJava("minecraft:freeze_top_layer");
    expect(summary.cases).toBeGreaterThanOrEqual(40);
    expect(summary.writes).toBeGreaterThan(5000);
    const snowWrites = featureCases("minecraft:freeze_top_layer").flatMap((testCase) => testCase.writes!.map((write) => write[3]));
    expect(snowWrites.some((state) => state === "minecraft:snow[layers=1]")).toBe(true);
    expect(snowWrites.some((state) => state === "minecraft:ice")).toBe(true);
    expect(snowWrites.some((state) => state === "minecraft:grass_block[snowy=true]")).toBe(true);
    expect(snowWrites.some((state) => state === "minecraft:podzol[snowy=true]")).toBe(true);
  });

  test("iceberg_packed and iceberg_blue build the same icebergs", () => {
    const packed = expectFeatureMatchesJava("minecraft:iceberg_packed");
    const blue = expectFeatureMatchesJava("minecraft:iceberg_blue");
    expect(packed.placedCases + blue.placedCases).toBeGreaterThanOrEqual(60);
    expect(packed.writes + blue.writes).toBeGreaterThan(30000);
  });

  test("blue_ice grows the same blue ice clusters and rejects the same origins", () => {
    const summary = expectFeatureMatchesJava("minecraft:blue_ice");
    expect(summary.placedCases).toBeGreaterThanOrEqual(30);
    expect(summary.cases - summary.placedCases).toBeGreaterThanOrEqual(30);
  });

  test("ice_spike builds the same spikes and rejects the same origins", () => {
    const summary = expectFeatureMatchesJava("minecraft:ice_spike");
    expect(summary.placedCases).toBeGreaterThanOrEqual(15);
    expect(summary.cases - summary.placedCases).toBeGreaterThanOrEqual(10);
  });

  test("forest_rock (vanilla and Terralith cherry rock) builds the same blobs", () => {
    const vanilla = expectFeatureMatchesJava("minecraft:forest_rock");
    const terralith = expectFeatureMatchesJava("terralith:cherry/rock");
    expect(vanilla.placedCases + terralith.placedCases).toBeGreaterThanOrEqual(40);
    expect(vanilla.writes + terralith.writes).toBeGreaterThan(300);
  });

  test("desert_well builds the same wells and rejects the same origins", () => {
    const summary = expectFeatureMatchesJava("minecraft:desert_well");
    expect(summary.placedCases).toBeGreaterThanOrEqual(10);
    expect(summary.cases - summary.placedCases).toBeGreaterThanOrEqual(30);
  });

  test("every block state the features wrote in Java is a known game block", () => {
    const writtenStates = new Set<string>();
    for (const testCase of reference.cases) for (const write of testCase.writes ?? []) writtenStates.add(write[3]);
    expect(writtenStates.size).toBeGreaterThanOrEqual(10);
    const unmappedStates = [...writtenStates].filter((state) => {
      try {
        toGameBlock(state);
        return false;
      } catch {
        return true;
      }
    });
    expect(unmappedStates).toEqual([]);
  });
});

afterAll(() => {
  console.log(`surface feature oracle tests: ${(performance.now() - startedAt).toFixed(0)} ms (${reference.cases.length} Java cases)`);
});
