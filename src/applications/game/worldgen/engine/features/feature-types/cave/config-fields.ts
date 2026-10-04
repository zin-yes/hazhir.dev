// Codec details of the cave feature configs that the shared JSON helpers do not cover.

import type { FeatureParser } from "../../feature/feature-parser";
import { asObject, type JsonObject, type JsonValue, requireNumber } from "../../providers/json-fields";

/** Codec.INT / Codec.intRange over JsonOps: a JSON number such as 2.25 decodes by truncation (Number.intValue). */
export function requireInt(object: JsonObject, field: string, what: string): number {
  return Math.trunc(requireNumber(object, field, what));
}

export function optionalInt(object: JsonObject, field: string, fallback: number): number {
  const value = object[field];
  if (value === undefined) return fallback;
  if (typeof value !== "number") throw new Error(`"${field}" must be a number`);
  return Math.trunc(value);
}

/**
 * BlockState.CODEC: properties the block does not define are ignored (Terralith writes `axis` on andesite, for
 * example), so they must not leak into the state string.
 */
export function parseBlockStateIgnoringUnknownProperties(json: JsonValue | undefined, parser: FeatureParser, what: string): string {
  const object = asObject(json, what);
  if (object.Properties === undefined || typeof object.Name !== "string") return parser.blockState(json, what);
  const qualifiedName = object.Name.includes(":") ? object.Name : `minecraft:${object.Name}`;
  const knownProperties = parser.blockStates.defaultProperties(qualifiedName);
  const properties = asObject(object.Properties, `${what}.Properties`);
  const retained: JsonObject = {};
  for (const [propertyName, value] of Object.entries(properties)) {
    if (propertyName in knownProperties) retained[propertyName] = value;
  }
  return parser.blockState({ Name: object.Name, Properties: retained }, what);
}
