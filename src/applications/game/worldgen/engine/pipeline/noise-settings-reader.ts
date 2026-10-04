// Reads the parts of a noise_settings entry the pipeline needs, plus the overworld dimension's generator link.

import { formatBlockState } from "../chunk";
import type { JsonObject, JsonValue, WorldgenRegistries } from "../registry/datapack-loader";

export interface OverworldSettings {
  noiseSettingsId: string;
  minY: number;
  height: number;
  seaLevel: number;
  defaultBlock: string;
  defaultFluid: string;
  surfaceRule: JsonObject;
}

export const LAVA_STATE = "minecraft:lava[level=0]";

/** A noise_settings BlockState object (`{Name, Properties?}`) as a state string like "minecraft:water[level=0]". */
export function blockStateJsonToString(blockStateJson: JsonValue | undefined, fieldName: string): string {
  if (typeof blockStateJson !== "object" || blockStateJson === null || Array.isArray(blockStateJson)) {
    throw new Error(`noise settings "${fieldName}" must be a block state object`);
  }
  const name = blockStateJson.Name;
  if (typeof name !== "string") throw new Error(`noise settings "${fieldName}" has no Name`);
  const properties = blockStateJson.Properties as Record<string, string> | undefined;
  return formatBlockState(name, properties);
}

export function readOverworldSettings(registries: WorldgenRegistries, overworldDimension: JsonObject): OverworldSettings {
  const generator = overworldDimension.generator as JsonObject | undefined;
  const settingsReference = generator?.settings;
  if (typeof settingsReference !== "string") {
    throw new Error("overworld dimension generator.settings must be a registry id string");
  }
  const noiseSettingsId = settingsReference.includes(":") ? settingsReference : `minecraft:${settingsReference}`;
  const settings = registries.noise_settings[noiseSettingsId];
  if (settings === undefined) throw new Error(`Unknown noise settings "${noiseSettingsId}"`);
  const noise = settings.noise as JsonObject;
  if (noise.size_horizontal !== 1 || noise.size_vertical !== 1) {
    throw new Error("Only size_horizontal = 1 and size_vertical = 1 (4x4x4 cells) are supported by the terrain stage");
  }
  return {
    noiseSettingsId,
    minY: noise.min_y as number,
    height: noise.height as number,
    seaLevel: settings.sea_level as number,
    defaultBlock: blockStateJsonToString(settings.default_block, "default_block"),
    defaultFluid: blockStateJsonToString(settings.default_fluid, "default_fluid"),
    surfaceRule: settings.surface_rule as JsonObject,
  };
}
