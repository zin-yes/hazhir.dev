// Test support (Node only): the recorded Java reference (fixtures/ground-reference.json.gz) written by
// fixtures/GroundReference.java.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

export interface RecordedGroundRun {
  feature: string;
  scenario: number;
  originIndex: number;
  featureIndex: number;
  placed?: boolean;
  nextLong?: string;
  /** Flat [dx, dy, dz, stateIndex, ...] relative to the origin: the final block written at each position. */
  writes?: number[];
  error?: string;
}

export interface GroundReference {
  step: number;
  palette: string[];
  featureIds: string[];
  /** Per scenario: [x, y, z] origins. */
  origins: number[][][];
  states: string[];
  terrainSamples: Array<[number, number, number, number, number]>;
  runs: RecordedGroundRun[];
  hashSetOrders: Array<{ inserted: number[]; order: number[] }>;
}

let reference: GroundReference | undefined;

export function loadGroundReference(): GroundReference {
  const directory = dirname(fileURLToPath(import.meta.url));
  reference ??= JSON.parse(gunzipSync(readFileSync(join(directory, "..", "fixtures", "ground-reference.json.gz"))).toString()) as GroundReference;
  return reference;
}
