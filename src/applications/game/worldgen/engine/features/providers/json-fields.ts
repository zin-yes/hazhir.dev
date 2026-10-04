// Small typed accessors for codec-style JSON parsing with errors that name the missing field.

import type { JsonObject, JsonValue } from "../../registry/datapack-loader";

export type { JsonObject, JsonValue };

export function asObject(json: JsonValue | undefined, what: string): JsonObject {
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw new Error(`${what} must be an object`);
  return json;
}

export function asArray(json: JsonValue | undefined, what: string): JsonValue[] {
  if (!Array.isArray(json)) throw new Error(`${what} must be a list`);
  return json;
}

export function requireNumber(object: JsonObject, field: string, what: string): number {
  const value = object[field];
  if (typeof value !== "number") throw new Error(`${what}: "${field}" must be a number`);
  return value;
}

export function optionalNumber(object: JsonObject, field: string, fallback: number): number {
  const value = object[field];
  if (value === undefined) return fallback;
  if (typeof value !== "number") throw new Error(`"${field}" must be a number`);
  return value;
}

export function requireString(object: JsonObject, field: string, what: string): string {
  const value = object[field];
  if (typeof value !== "string") throw new Error(`${what}: "${field}" must be a string`);
  return value;
}

export function optionalBoolean(object: JsonObject, field: string, fallback: boolean): boolean {
  const value = object[field];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`"${field}" must be a boolean`);
  return value;
}

/** "minecraft:count" and "count" both become "minecraft:count" (ResourceLocation default namespace). */
export function normalizeTypeId(typeId: string): string {
  return typeId.includes(":") ? typeId : `minecraft:${typeId}`;
}

export function typeOf(object: JsonObject, what: string): string {
  return normalizeTypeId(requireString(object, "type", what));
}
