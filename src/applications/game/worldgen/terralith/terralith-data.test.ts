import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonObject } from "../engine/registry/datapack-loader";
import { loadTerralithOnVanilla } from "../engine/registry/datapack-loader";
import { compileTerralithData } from "./compile-data";
import { loadTerralithRegistries } from "./load-terralith-registries";

const testStartedAtMs = performance.now();
const scratchDirectory = process.env.WORLDGEN_SCRATCH;

function biomeSourceEntries(overworldDimension: JsonObject): { biome: string; parameters: JsonObject }[] {
  return ((overworldDimension.generator as JsonObject).biome_source as JsonObject).biomes as { biome: string; parameters: JsonObject }[];
}

describe("committed Terralith data", () => {
  const { registries, overworldDimension, blockTags } = loadTerralithRegistries();

  test("every biome of the overworld biome source is in the biome table with its generation fields", () => {
    const entries = biomeSourceEntries(overworldDimension);
    expect(entries.length).toBeGreaterThan(1000);
    for (const entry of entries) {
      const biome = registries.biome[entry.biome];
      expect(biome).toBeDefined();
      expect(typeof biome!.temperature).toBe("number");
      expect(Array.isArray(biome!.features)).toBe(true);
    }
    expect(Object.keys(registries.biome).length).toBeGreaterThan(100);
    expect(registries.biome["minecraft:frozen_ocean"]!.temperature_modifier).toBe("frozen");
    expect(registries.biome["minecraft:frozen_ocean"]!.temperature).toBe(0);
    expect(registries.biome["minecraft:plains"]!.temperature_modifier).toBeUndefined();
    expect(registries.biome["minecraft:plains"]!.temperature).toBe(0.8);
  });

  test("every feature and carver a biome lists resolves, and every configured feature a placed feature points at exists", () => {
    const missing: string[] = [];
    for (const [biomeId, biome] of Object.entries(registries.biome)) {
      for (const stepFeatures of biome.features as string[][]) {
        for (const placedId of stepFeatures) {
          const placed = registries.placed_feature[placedId];
          if (placed === undefined) missing.push(`${biomeId} -> placed ${placedId}`);
          else if (typeof placed.feature === "string" && registries.configured_feature[placed.feature] === undefined) {
            missing.push(`${placedId} -> configured ${placed.feature}`);
          }
        }
      }
      for (const carverId of (biome.carvers as { air?: string[] }).air ?? []) {
        if (registries.configured_carver[carverId] === undefined) missing.push(`${biomeId} -> carver ${carverId}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("block tags referenced by carvers are resolvable", () => {
    for (const carver of Object.values(registries.configured_carver)) {
      const replaceable = (carver.config as JsonObject).replaceable;
      if (typeof replaceable === "string" && replaceable.startsWith("#")) {
        expect(blockTags[replaceable.slice(1)]?.length).toBeGreaterThan(0);
      }
    }
  });

  test("the density functions and noise settings carry the overworld router", () => {
    const router = registries.noise_settings["minecraft:overworld"]!.noise_router as JsonObject;
    for (const field of ["final_density", "continents", "erosion", "temperature", "vegetation", "ridges", "depth"]) {
      expect(router[field]).toBeDefined();
    }
    expect(Object.keys(registries.density_function).length).toBeGreaterThan(20);
    expect(Object.keys(registries.noise).length).toBeGreaterThan(100);
  });
});

describe.skipIf(!scratchDirectory || !existsSync(join(scratchDirectory, "Terralith")))("compiled data freshness", () => {
  test("compiling the datapacks again reproduces the committed files byte for byte", () => {
    const loaded = loadTerralithOnVanilla(join(scratchDirectory!, "mc/vanilla/data"), join(scratchDirectory!, "Terralith"));
    const { files } = compileTerralithData(loaded);
    expect(Object.keys(files).length).toBeGreaterThanOrEqual(10);
    for (const [fileName, text] of Object.entries(files)) {
      expect(readFileSync(join(import.meta.dir, "data", fileName), "utf8") === text).toBe(true);
    }
  });
});

afterAll(() => {
  console.log(`terralith-data.test.ts took ${(performance.now() - testStartedAtMs).toFixed(0)} ms`);
});
