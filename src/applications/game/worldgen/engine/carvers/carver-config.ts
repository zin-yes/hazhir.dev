// Configured carvers as data: the JSON of a `configured_carver` registry entry (CarverConfiguration,
// CaveCarverConfiguration, CanyonCarverConfiguration) turned into samplers and a replaceable block set.

import type { JsonObject, JsonValue, TagRegistry } from "../registry/datapack-loader";
import {
  type FloatProvider,
  type HeightProvider,
  parseFloatProvider,
  parseHeightProvider,
  parseVerticalAnchor,
  type VerticalAnchor,
} from "./value-providers";

export interface CarverBaseConfig {
  /** Float, as in ProbabilityFeatureConfiguration. */
  probability: number;
  y: HeightProvider;
  yScale: FloatProvider;
  lavaLevel: VerticalAnchor;
  /** Block names (no properties) the carver may replace. */
  replaceable: ReadonlySet<string>;
}

export interface CaveCarverConfig extends CarverBaseConfig {
  kind: "cave";
  horizontalRadiusMultiplier: FloatProvider;
  verticalRadiusMultiplier: FloatProvider;
  floorLevel: FloatProvider;
}

export interface CanyonShapeConfig {
  distanceFactor: FloatProvider;
  thickness: FloatProvider;
  widthSmoothness: number;
  horizontalRadiusFactor: FloatProvider;
  verticalRadiusDefaultFactor: number;
  verticalRadiusCenterFactor: number;
}

export interface CanyonCarverConfig extends CarverBaseConfig {
  kind: "canyon";
  verticalRotation: FloatProvider;
  shape: CanyonShapeConfig;
}

export type CarverConfig = CaveCarverConfig | CanyonCarverConfig;

function requireField(object: JsonObject, field: string, carverId: string): JsonValue {
  const value = object[field];
  if (value === undefined) throw new Error(`Configured carver ${carverId} is missing "${field}"`);
  return value;
}

function parseBlockSet(value: JsonValue, blockTags: TagRegistry, carverId: string): Set<string> {
  const entries = Array.isArray(value) ? value : [value];
  const names = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== "string") throw new Error(`Configured carver ${carverId} has a non-string replaceable entry`);
    if (entry.startsWith("#")) {
      const tagMembers = blockTags[entry.slice(1)];
      if (tagMembers === undefined) throw new Error(`Configured carver ${carverId} references unknown block tag ${entry}`);
      for (const member of tagMembers) names.add(member);
    } else {
      names.add(entry);
    }
  }
  return names;
}

export function parseConfiguredCarver(carverId: string, json: JsonObject, blockTags: TagRegistry): CarverConfig {
  const type = String(json.type).replace(/^minecraft:/, "");
  const config = requireField(json, "config", carverId) as JsonObject;
  const base: CarverBaseConfig = {
    probability: Math.fround(requireField(config, "probability", carverId) as number),
    y: parseHeightProvider(requireField(config, "y", carverId)),
    yScale: parseFloatProvider(requireField(config, "yScale", carverId)),
    lavaLevel: parseVerticalAnchor(requireField(config, "lava_level", carverId)),
    replaceable: parseBlockSet(requireField(config, "replaceable", carverId), blockTags, carverId),
  };
  if (type === "cave") {
    return {
      ...base,
      kind: "cave",
      horizontalRadiusMultiplier: parseFloatProvider(requireField(config, "horizontal_radius_multiplier", carverId)),
      verticalRadiusMultiplier: parseFloatProvider(requireField(config, "vertical_radius_multiplier", carverId)),
      floorLevel: parseFloatProvider(requireField(config, "floor_level", carverId)),
    };
  }
  if (type === "canyon") {
    const shape = requireField(config, "shape", carverId) as JsonObject;
    return {
      ...base,
      kind: "canyon",
      verticalRotation: parseFloatProvider(requireField(config, "vertical_rotation", carverId)),
      shape: {
        distanceFactor: parseFloatProvider(requireField(shape, "distance_factor", carverId)),
        thickness: parseFloatProvider(requireField(shape, "thickness", carverId)),
        widthSmoothness: requireField(shape, "width_smoothness", carverId) as number,
        horizontalRadiusFactor: parseFloatProvider(requireField(shape, "horizontal_radius_factor", carverId)),
        verticalRadiusDefaultFactor: Math.fround(requireField(shape, "vertical_radius_default_factor", carverId) as number),
        verticalRadiusCenterFactor: Math.fround(requireField(shape, "vertical_radius_center_factor", carverId) as number),
      },
    };
  }
  throw new Error(`Unsupported carver type ${String(json.type)} in ${carverId}`);
}

/** Carver ids of one biome for the `air` carving step (1.20.6: `carvers` is {air: [...]}, older data used a bare list). */
export function readBiomeAirCarverIds(biomeJson: JsonObject): string[] {
  const carvers = biomeJson.carvers;
  if (carvers === undefined || carvers === null) return [];
  const airEntries = Array.isArray(carvers) ? carvers : (carvers as JsonObject).air;
  if (airEntries === undefined) return [];
  const entries = Array.isArray(airEntries) ? airEntries : [airEntries];
  return entries.map((entry) => {
    if (typeof entry !== "string" || entry.startsWith("#")) {
      throw new Error(`Unsupported biome carver entry ${JSON.stringify(entry)}`);
    }
    return entry.includes(":") ? entry : `minecraft:${entry}`;
  });
}
