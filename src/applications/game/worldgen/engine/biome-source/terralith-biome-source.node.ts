// Test helper (Node side): reads the real Terralith overworld multi_noise biome source JSON.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonObject } from "../registry/datapack-loader";

const DEFAULT_TERRALITH_PACK_ROOT =
  "/private/tmp/claude-501/-Users-hazhir-code-zin-yes-hazhir-dev/72290beb-a2c3-4424-af2e-7aec7d1ca7d0/scratchpad/Terralith";

export const TERRALITH_OVERWORLD_JSON_PATH = join(
  process.env.TERRALITH_PACK_ROOT ?? DEFAULT_TERRALITH_PACK_ROOT,
  "data",
  "minecraft",
  "dimension",
  "overworld.json",
);

export const terralithDimensionAvailable = existsSync(TERRALITH_OVERWORLD_JSON_PATH);

export function readTerralithBiomeSourceJson(): JsonObject {
  const dimension = JSON.parse(readFileSync(TERRALITH_OVERWORLD_JSON_PATH, "utf8")) as JsonObject;
  return (dimension.generator as JsonObject).biome_source as JsonObject;
}

/** Small deterministic PRNG (mulberry32) so test failures are reproducible. */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
