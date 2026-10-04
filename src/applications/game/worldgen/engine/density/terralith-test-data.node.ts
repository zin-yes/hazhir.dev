// Node-only test helper: the merged vanilla + Terralith registries, the seed-1337 router, and the Java reference
// vectors recorded by fixtures/DensityReference.java. Tests skip when the scratch datapacks are absent.

import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { type DatapackLoadResult, loadTerralithOnVanilla } from "../registry/datapack-loader";
import { createNoiseRouter } from "./noise-router";
import type { NoiseRouter } from "./router-wiring";

const WORLDGEN_SCRATCH_ROOT =
  process.env.WORLDGEN_SCRATCH ??
  "/private/tmp/claude-501/-Users-hazhir-code-zin-yes-hazhir-dev/72290beb-a2c3-4424-af2e-7aec7d1ca7d0/scratchpad";

export const TEST_SEED = BigInt(1337);
export const GROUND_TRUTH_FIXTURE_DIRECTORY = `${WORLDGEN_SCRATCH_ROOT}/fixtures`;
export const TERRALITH_DATA_AVAILABLE =
  existsSync(`${WORLDGEN_SCRATCH_ROOT}/Terralith`) && existsSync(`${WORLDGEN_SCRATCH_ROOT}/mc/vanilla/data`);

let loadedDatapacks: DatapackLoadResult | undefined;
let overworldRouter: NoiseRouter | undefined;

export function loadTerralithDatapacks(): DatapackLoadResult {
  loadedDatapacks ??= loadTerralithOnVanilla(`${WORLDGEN_SCRATCH_ROOT}/mc/vanilla/data`, `${WORLDGEN_SCRATCH_ROOT}/Terralith`);
  return loadedDatapacks;
}

/** The seed-1337 Terralith overworld router, built once per test process. */
export function loadOverworldRouter(): NoiseRouter {
  overworldRouter ??= createNoiseRouter({
    registries: loadTerralithDatapacks().registries,
    noiseSettingsId: "minecraft:overworld",
    seed: TEST_SEED,
  });
  return overworldRouter;
}

/** Reads a gzipped JSON fixture whose non-finite doubles were written as "Infinity" / "-Infinity" / "NaN" strings. */
export function readReferenceVectors<T>(fixtureUrl: URL): T {
  const text = gunzipSync(readFileSync(fixtureUrl)).toString("utf8");
  return JSON.parse(text, (_key, value) => {
    if (value === "Infinity") return Number.POSITIVE_INFINITY;
    if (value === "-Infinity") return Number.NEGATIVE_INFINITY;
    if (value === "NaN") return Number.NaN;
    return value;
  }) as T;
}
