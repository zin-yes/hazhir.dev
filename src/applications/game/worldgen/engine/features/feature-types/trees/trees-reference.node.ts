// Test support (Node only): the recorded Java reference (fixtures/trees-reference.json.gz) written by
// fixtures/TreesReference.java.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

export interface RecordedTreeRun {
  id: string;
  seed: number;
  origin: [number, number, number];
  placed?: boolean;
  /** Flat [x, y, z, paletteIndex, ...] of every accepted WorldGenLevel.setBlock in call order. */
  writes?: number[];
  nextLong?: string;
  error?: string;
}

export interface RecordedHashSetScenario {
  /** Flat [kind, x, y, z, ...]: kind 0 adds the position, 1 is HashSet.remove, 2 is iterator().next() + remove() (x, y, z = the element popped). */
  ops: number[];
  /** java.util.HashSet iteration order (flat [x, y, z, ...]) after the first `afterOps` operations. */
  checkpoints: Array<{ afterOps: number; order: number[] }>;
}

export interface TreesReference {
  palette: string[];
  runs: RecordedTreeRun[];
  hashSetScenarios: RecordedHashSetScenario[];
}

let reference: TreesReference | undefined;

export function loadTreesReference(): TreesReference {
  reference ??= JSON.parse(gunzipSync(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "trees-reference.json.gz"))).toString()) as TreesReference;
  return reference;
}
