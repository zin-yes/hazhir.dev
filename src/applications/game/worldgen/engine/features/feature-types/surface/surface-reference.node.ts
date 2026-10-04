// Test support (Node only): the recorded Java reference (fixtures/surface-reference.json.gz).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

export interface SurfaceReferenceCase {
  feature: string;
  scenario: string;
  seed: string;
  origin: [number, number, number];
  placed?: boolean;
  nextLong?: string;
  writes?: Array<[number, number, number, string]>;
  error?: string;
}

export interface SurfaceReference {
  biomes: string[];
  temperaturePoints: Array<[number, number, number]>;
  temperatures: Array<{ biome: string; temperatureBits: number[] }>;
  cases: SurfaceReferenceCase[];
}

let reference: SurfaceReference | undefined;

export function loadSurfaceReference(): SurfaceReference {
  const directory = dirname(fileURLToPath(import.meta.url));
  reference ??= JSON.parse(gunzipSync(readFileSync(join(directory, "fixtures", "surface-reference.json.gz"))).toString()) as SurfaceReference;
  return reference;
}
