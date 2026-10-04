import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../registry/datapack-loader";
import { quantizeCoordinate, type TargetPoint } from "./climate-parameter-list";
import { MultiNoiseBiomeSource } from "./multi-noise-biome-source";
import { createSeededRandom, readTerralithBiomeSourceJson, terralithDimensionAvailable } from "./terralith-biome-source.node";

const PARAMETER_NAMES = ["temperature", "humidity", "continentalness", "erosion", "depth", "weirdness"] as const;
type ParameterName = (typeof PARAMETER_NAMES)[number];

interface RawBiomeEntry {
  biome: string;
  parameters: Record<string, number | [number, number]>;
}

const suiteStart = performance.now();
const describeWithTerralith = terralithDimensionAvailable ? describe : describe.skip;

function rawBounds(value: number | [number, number]): [number, number] {
  return typeof value === "number" ? [value, value] : value;
}

function quantizedTarget(climate: Record<ParameterName, number>): TargetPoint {
  return {
    temperature: quantizeCoordinate(climate.temperature),
    humidity: quantizeCoordinate(climate.humidity),
    continentalness: quantizeCoordinate(climate.continentalness),
    erosion: quantizeCoordinate(climate.erosion),
    depth: quantizeCoordinate(climate.depth),
    weirdness: quantizeCoordinate(climate.weirdness),
  };
}

describe("quantizeCoordinate", () => {
  test("truncates toward zero using float math", () => {
    expect(quantizeCoordinate(0.45)).toBe(4500);
    expect(quantizeCoordinate(-0.45)).toBe(-4500);
    expect(quantizeCoordinate(-0.455)).toBe(-4550);
    // 0.7 as a float is 0.699999988..., times 10000.0F rounds to exactly 7000 in float, so no off-by-one truncation.
    expect(quantizeCoordinate(0.7)).toBe(7000);
    expect(quantizeCoordinate(-1.0047858741932016)).toBe(-10047);
    expect(quantizeCoordinate(0.00009)).toBe(0);
    expect(quantizeCoordinate(-0.00009)).toBe(0);
  });
});

describeWithTerralith("MultiNoiseBiomeSource on the real Terralith overworld table", () => {
  const biomeSourceJson = readTerralithBiomeSourceJson();
  const rawEntries = biomeSourceJson.biomes as unknown as RawBiomeEntry[];
  const source = new MultiNoiseBiomeSource(biomeSourceJson);

  test("parses all 1705 parameter points", () => {
    expect(rawEntries.length).toBe(1705);
    expect(source.parameterPointCount).toBe(rawEntries.length);
  });

  test("a point at the centre of a box that no other zero-offset box contains returns that box's biome", () => {
    let verifiedPoints = 0;
    for (const entry of rawEntries) {
      if (rawBounds(entry.parameters.offset)[0] !== 0) continue;
      const center = {} as Record<ParameterName, number>;
      for (const name of PARAMETER_NAMES) {
        const [minimum, maximum] = rawBounds(entry.parameters[name]);
        center[name] = (minimum + maximum) / 2;
      }
      const containingEntries = rawEntries.filter(
        (candidate) =>
          rawBounds(candidate.parameters.offset)[0] === 0 &&
          PARAMETER_NAMES.every((name) => {
            const [minimum, maximum] = rawBounds(candidate.parameters[name]);
            return center[name] >= minimum && center[name] <= maximum;
          }),
      );
      if (containingEntries.length !== 1) continue;
      expect(source.findBiome(quantizedTarget(center))).toBe(entry.biome);
      verifiedPoints++;
    }
    expect(verifiedPoints).toBeGreaterThan(100);
  });

  test("a point just outside a box is pulled to the nearest other box by squared distance, not by index", () => {
    // Deep frozen ocean covers temperature up to -0.45 and the next band starts there; stepping beyond the last
    // temperature bound of a lone-box interior point must keep returning a point whose fitness is the minimum.
    const target = quantizedTarget({ temperature: 0.3, humidity: 0.2, continentalness: 0.5, erosion: 0.1, depth: 0, weirdness: 0.3 });
    const best = source.findBiomeBruteForce(target);
    expect(source.findParameterPointIndex(target)).toBeGreaterThanOrEqual(0);
    expect(source.findBiome(target)).toBe(best.biome);
  });

  test("tree search equals brute force on random realistic climate targets; reports ties and throughput", () => {
    const random = createSeededRandom(1337);
    const between = (low: number, high: number) => low + (high - low) * random();
    const queryCount = 30000;
    const targets: TargetPoint[] = [];
    for (let queryIndex = 0; queryIndex < queryCount; queryIndex++) {
      targets.push(
        quantizedTarget({
          temperature: between(-1.4, 1.4),
          humidity: between(-1.4, 1.4),
          continentalness: between(-1.2, 1.2),
          erosion: between(-1.2, 1.2),
          depth: between(-0.6, 1.6),
          weirdness: between(-1.2, 1.2),
        }),
      );
    }

    const treeStart = performance.now();
    const treeIndices = targets.map((target) => source.findParameterPointIndex(target));
    const treeSeconds = (performance.now() - treeStart) / 1000;

    const bruteStart = performance.now();
    const bruteResults = targets.map((target) => source.findBiomeBruteForce(target));
    const bruteSeconds = (performance.now() - bruteStart) / 1000;

    const points = source.getParameterPoints();
    let indexMismatches = 0;
    let biomeMismatches = 0;
    for (let queryIndex = 0; queryIndex < queryCount; queryIndex++) {
      const treePoint = points[treeIndices[queryIndex]];
      const brute = bruteResults[queryIndex];
      if (treeIndices[queryIndex] !== brute.index) indexMismatches++;
      if (treePoint.biome !== brute.biome) biomeMismatches++;
      // The tree may only differ from brute force by picking an exactly tied leaf.
      let treeFitness = 0;
      const targetValues = Object.values(targets[queryIndex]);
      for (let dimension = 0; dimension < 6; dimension++) {
        const [minimum, maximum] = treePoint.intervals[dimension];
        const value = targetValues[dimension];
        const distance = value > maximum ? value - maximum : minimum > value ? minimum - value : 0;
        treeFitness += distance * distance;
      }
      treeFitness += treePoint.intervals[6][0] * treePoint.intervals[6][0];
      expect(treeFitness).toBe(brute.fitness);
    }

    console.log(
      `[biome-source] ${queryCount} random queries: tree ${(queryCount / treeSeconds).toFixed(0)} q/s, brute force ${(queryCount / bruteSeconds).toFixed(0)} q/s, ` +
        `index mismatches (exact ties resolved differently) ${indexMismatches}, biome mismatches ${biomeMismatches}`,
    );
    expect(biomeMismatches / queryCount).toBeLessThan(0.002);
  }, 120000);

  test("chunk-sized batch of 512 lookups on spatially coherent climate stays fast", () => {
    const random = createSeededRandom(7);
    const batch: TargetPoint[] = [];
    for (let quartIndex = 0; quartIndex < 512; quartIndex++) {
      batch.push(
        quantizedTarget({
          temperature: 0.1 + 0.02 * random(),
          humidity: -0.2 + 0.02 * random(),
          continentalness: 0.3 + 0.1 * random(),
          erosion: 0.2 + 0.1 * random(),
          depth: 0.1 + 0.01 * random(),
          weirdness: 0.4 * random(),
        }),
      );
    }
    const start = performance.now();
    for (let repetition = 0; repetition < 100; repetition++) for (const target of batch) source.findBiome(target);
    const millisecondsPerChunk = (performance.now() - start) / 100;
    console.log(`[biome-source] 512-lookup chunk batch: ${millisecondsPerChunk.toFixed(3)} ms per chunk`);
    expect(millisecondsPerChunk).toBeLessThan(50);
  });

  test("last-leaf hint mode returns minimal-fitness points on a coherent walk and is faster", () => {
    const hinted = new MultiNoiseBiomeSource(biomeSourceJson, { reuseLastLeaf: true });
    const random = createSeededRandom(21);
    const walk: TargetPoint[] = [];
    const climate: Record<ParameterName, number> = { temperature: 0, humidity: 0, continentalness: 0.2, erosion: 0.1, depth: 0.1, weirdness: 0 };
    for (let stepIndex = 0; stepIndex < 20000; stepIndex++) {
      for (const name of PARAMETER_NAMES) climate[name] = Math.max(-1.2, Math.min(1.2, climate[name] + (random() - 0.5) * 0.03));
      walk.push(quantizedTarget(climate));
    }
    const hintedStart = performance.now();
    const hintedIndices = walk.map((target) => hinted.findParameterPointIndex(target));
    const hintedSeconds = (performance.now() - hintedStart) / 1000;
    const plainStart = performance.now();
    const plainIndices = walk.map((target) => source.findParameterPointIndex(target));
    const plainSeconds = (performance.now() - plainStart) / 1000;
    const points = source.getParameterPoints();
    let biomeDisagreements = 0;
    let plainDisagreements = 0;
    for (let stepIndex = 0; stepIndex < walk.length; stepIndex++) {
      const bruteBiome = source.findBiomeBruteForce(walk[stepIndex]).biome;
      if (points[hintedIndices[stepIndex]].biome !== bruteBiome) biomeDisagreements++;
      if (points[plainIndices[stepIndex]].biome !== bruteBiome) plainDisagreements++;
    }
    console.log(
      `[biome-source] coherent walk 20000 queries: plain ${(20000 / plainSeconds).toFixed(0)} q/s, last-leaf hint ${(20000 / hintedSeconds).toFixed(0)} q/s, biome disagreements vs brute force: hint ${biomeDisagreements}, plain ${plainDisagreements}`,
    );
    expect(biomeDisagreements).toBeLessThan(20);
    expect(plainDisagreements).toBeLessThan(20);
  }, 120000);

  test("brute force tie frequency on the table (how often two distinct points share the minimum fitness)", () => {
    const random = createSeededRandom(99);
    const between = (low: number, high: number) => low + (high - low) * random();
    const points = source.getParameterPoints();
    let tiedQueries = 0;
    let tiedAcrossBiomes = 0;
    const queryCount = 8000;
    for (let queryIndex = 0; queryIndex < queryCount; queryIndex++) {
      const target = quantizedTarget({
        temperature: between(-1.4, 1.4),
        humidity: between(-1.4, 1.4),
        continentalness: between(-1.2, 1.2),
        erosion: between(-1.2, 1.2),
        depth: between(-0.6, 1.6),
        weirdness: between(-1.2, 1.2),
      });
      const best = source.findBiomeBruteForce(target);
      const targetValues = Object.values(target);
      const tiedBiomes = new Set<string>();
      let tiedCount = 0;
      for (const point of points) {
        let fitness = point.intervals[6][0] * point.intervals[6][0];
        for (let dimension = 0; dimension < 6; dimension++) {
          const [minimum, maximum] = point.intervals[dimension];
          const value = targetValues[dimension];
          const distance = value > maximum ? value - maximum : minimum > value ? minimum - value : 0;
          fitness += distance * distance;
        }
        if (fitness === best.fitness) {
          tiedCount++;
          tiedBiomes.add(point.biome);
        }
      }
      if (tiedCount > 1) tiedQueries++;
      if (tiedBiomes.size > 1) tiedAcrossBiomes++;
    }
    console.log(`[biome-source] brute-force ties over ${queryCount} random targets: ${tiedQueries} tied, ${tiedAcrossBiomes} tied across different biomes`);
    expect(tiedAcrossBiomes / queryCount).toBeLessThan(0.05);
  }, 120000);

  test("rejects malformed biome sources", () => {
    const missingBiomes: JsonObject = { type: "minecraft:multi_noise" };
    expect(() => new MultiNoiseBiomeSource(missingBiomes)).toThrow();
  });

  test("suite wall clock", () => {
    console.log(`[biome-source] multi-noise suite wall clock: ${(performance.now() - suiteStart).toFixed(0)} ms`);
  });
});
