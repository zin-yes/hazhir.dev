// FeatureSorter on the real Terralith overworld biome set, against the order recorded from the real classes.

import { afterAll, expect, test } from "bun:test";
import { loadFeaturesReference, loadTerralithDatapacks } from "../testing/feature-fixtures.node";
import { BiomeFeatureIndex, DECORATION_STEPS, possibleBiomesOfDimension } from "./biome-features";
import { buildFeaturesPerStep, FeatureOrderCycleError } from "./feature-sorter";

const startedAt = performance.now();
const reference = loadFeaturesReference();
const datapacks = loadTerralithDatapacks();

test("possible biomes come out of the dimension's parameter list in BiomeSource order", () => {
  const possibleBiomes = possibleBiomesOfDimension(datapacks.overworldDimension!);
  expect(possibleBiomes.length).toBeGreaterThan(100);
  expect(possibleBiomes).toEqual(reference.possibleBiomes);
});

test("per-step feature order and indices match FeatureSorter.buildFeaturesPerStep exactly", () => {
  const biomeFeatures = new BiomeFeatureIndex(datapacks.registries.biome);
  const possibleBiomes = possibleBiomesOfDimension(datapacks.overworldDimension!);
  const steps = buildFeaturesPerStep(possibleBiomes, (biome) => biomeFeatures.stepsOf(biome));
  expect(steps.length).toBe(DECORATION_STEPS.length);
  expect(steps.map((step) => step.features)).toEqual(reference.featuresPerStep);

  // Every feature a possible biome lists is present in that step, and each biome's own order is preserved.
  for (const biome of possibleBiomes) {
    biomeFeatures.stepsOf(biome).forEach((stepFeatures, step) => {
      let previousIndex = -1;
      for (const featureKey of stepFeatures) {
        const index = steps[step]!.indexOf.get(featureKey);
        expect(index).toBeDefined();
        expect(index!).toBeGreaterThan(previousIndex);
        previousIndex = index!;
      }
    });
  }
  for (const step of steps) step.features.forEach((featureKey, index) => expect(step.indexOf.get(featureKey)).toBe(index));
});

test("contradictory biome orders are reported as a cycle", () => {
  const orders: Record<string, string[][]> = { first: [["a:x", "a:y"]], second: [["a:y", "a:x"]] };
  expect(() => buildFeaturesPerStep(["first", "second"], (biome) => orders[biome]!)).toThrow(FeatureOrderCycleError);
});

afterAll(() => console.log(`feature-sorter tests: ${(performance.now() - startedAt).toFixed(0)} ms`));
