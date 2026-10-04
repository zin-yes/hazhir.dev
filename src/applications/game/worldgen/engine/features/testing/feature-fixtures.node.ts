// Test support (Node only): the recorded Java reference (fixtures/features-reference.json.gz) and the merged
// vanilla + Terralith datapack registries the reference was recorded with.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { type DatapackLoadResult, loadTerralithOnVanilla } from "../../registry/datapack-loader";

export interface RecordedDraws {
  nextLong: string;
  nextInt16a: number;
  nextInt16b: number;
  nextFloat: number;
  nextDouble: number;
  nextBoolean: boolean;
  nextInt: number;
  nextInt5: number;
  nextInt1000: number;
  nextGaussian: number;
}

export interface RecordedPlacedFeatureRun {
  id: string;
  step: number;
  featureIndex: number;
  biome: string;
  positions?: Array<[number, number, number]>;
  nextLongAfterPositions?: string;
  positionsError?: string;
  placed?: boolean;
  writes?: Array<[number, number, number, string]>;
  nextLongAfterPlacement?: string;
  placementError?: string;
}

export interface FeaturesReference {
  seeding: {
    worldSeed: string;
    minBlockX: number;
    minBlockZ: number;
    decorationSeed: string;
    featureSeeds: Array<RecordedDraws & { step: number; featureIndex: number }>;
    gaussianLeak: { first: number; afterReseed: number; next: number };
    forkNextLong: string;
  };
  possibleBiomes: string[];
  featuresPerStep: string[][];
  biomeInfoNoise: Array<[number, number, number, number]>;
  legacyNormalNoise: Array<[number, number, number, number, number]>;
  placedFeatureRuns: RecordedPlacedFeatureRun[];
}

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const SCRATCH_DIRECTORY =
  process.env.WORLDGEN_SCRATCH ?? "/private/tmp/claude-501/-Users-hazhir-code-zin-yes-hazhir-dev/72290beb-a2c3-4424-af2e-7aec7d1ca7d0/scratchpad";

let reference: FeaturesReference | undefined;
let datapacks: DatapackLoadResult | undefined;

export function loadFeaturesReference(): FeaturesReference {
  reference ??= JSON.parse(gunzipSync(readFileSync(join(MODULE_DIRECTORY, "..", "fixtures", "features-reference.json.gz"))).toString()) as FeaturesReference;
  return reference;
}

export function loadTerralithDatapacks(): DatapackLoadResult {
  datapacks ??= loadTerralithOnVanilla(join(SCRATCH_DIRECTORY, "mc", "vanilla", "data"), join(SCRATCH_DIRECTORY, "Terralith"));
  return datapacks;
}
