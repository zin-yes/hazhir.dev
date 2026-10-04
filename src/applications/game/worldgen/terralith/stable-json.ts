// Deterministic minified JSON: object keys are sorted recursively, array order is preserved.

import type { JsonValue } from "../engine/registry/datapack-loader";

function sortKeysRecursively(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortKeysRecursively);
  if (value !== null && typeof value === "object") {
    const sorted: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeysRecursively(value[key]!);
    return sorted;
  }
  return value;
}

export function stringifyStableJson(value: JsonValue): string {
  return JSON.stringify(sortKeysRecursively(value));
}
