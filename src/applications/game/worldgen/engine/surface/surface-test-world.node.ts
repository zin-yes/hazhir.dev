// Test helper (Node side): the real Terralith registries and seed-1337 noise stack, loaded once per test process.

import { existsSync } from "node:fs";
import { createNoiseRouter } from "../density";
import { createRootRandomFactory, NoiseRegistry, type NoiseParameters } from "../noise";
import { loadTerralithOnVanilla, type JsonObject } from "../registry/datapack-loader";
import { createBiomeClimateLookup } from "./biome-temperature";

export const SCRATCH_ROOT =
  process.env.WORLDGEN_SCRATCH ??
  "/private/tmp/claude-501/-Users-hazhir-code-zin-yes-hazhir-dev/72290beb-a2c3-4424-af2e-7aec7d1ca7d0/scratchpad";
export const FIXTURE_DIRECTORY = `${SCRATCH_ROOT}/fixtures`;
export const HAS_WORLDGEN_DATA = existsSync(`${SCRATCH_ROOT}/Terralith`) && existsSync(`${SCRATCH_ROOT}/mc/vanilla/data`);
export const TEST_SEED = BigInt(1337);

let loadedRegistries: ReturnType<typeof loadTerralithOnVanilla> | undefined;

export function loadRegistries() {
  loadedRegistries ??= loadTerralithOnVanilla(`${SCRATCH_ROOT}/mc/vanilla/data`, `${SCRATCH_ROOT}`.concat("/Terralith"));
  return loadedRegistries;
}

export function createSeedNoiseStack(seed: bigint = TEST_SEED) {
  const { registries } = loadRegistries();
  const parametersById: Record<string, NoiseParameters> = {};
  for (const [noiseId, json] of Object.entries(registries.noise)) {
    parametersById[noiseId] = { firstOctave: json.firstOctave as number, amplitudes: json.amplitudes as number[] };
  }
  const randomFactory = createRootRandomFactory(seed);
  const noises = new NoiseRegistry(parametersById, randomFactory);
  const overworldSettings = registries.noise_settings["minecraft:overworld"]!;
  return {
    registries,
    randomFactory,
    noises,
    surfaceRule: overworldSettings.surface_rule as JsonObject,
    seaLevel: overworldSettings.sea_level as number,
    biomeClimate: createBiomeClimateLookup(registries.biome),
    createRouter: () => createNoiseRouter({ registries, noiseSettingsId: "minecraft:overworld", seed }),
  };
}
