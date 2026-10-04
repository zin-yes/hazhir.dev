// FluidState.CODEC ({Name, Properties}) and FluidState.createLegacyBlock(), used by minecraft:spring_feature.

import type { JsonValue } from "../../../providers/json-fields";
import { asObject, requireString } from "../../../providers/json-fields";

const LEGACY_BLOCK_BY_FLUID: Record<string, { block: string; isSource: boolean }> = {
  "minecraft:water": { block: "minecraft:water", isSource: true },
  "minecraft:flowing_water": { block: "minecraft:water", isSource: false },
  "minecraft:lava": { block: "minecraft:lava", isSource: true },
  "minecraft:flowing_lava": { block: "minecraft:lava", isSource: false },
};

/**
 * The block state of FluidState.createLegacyBlock (FlowingFluid.getLegacyLevel): level 0 for a source, otherwise
 * 8 - min(amount, 8) + (falling ? 8 : 0).
 */
export function parseFluidStateAsLegacyBlock(json: JsonValue | undefined, what: string): string {
  const object = asObject(json, what);
  const rawName = requireString(object, "Name", what);
  const fluidName = rawName.includes(":") ? rawName : `minecraft:${rawName}`;
  const fluid = LEGACY_BLOCK_BY_FLUID[fluidName];
  if (!fluid) throw new Error(`${what}: unsupported fluid ${fluidName}`);
  const properties = object.Properties === undefined ? {} : (asObject(object.Properties, `${what}.Properties`) as Record<string, string>);
  const falling = String(properties.falling ?? "false") === "true";
  const amount = fluid.isSource ? 8 : Number(properties.level ?? "1");
  const level = fluid.isSource ? 0 : 8 - Math.min(amount, 8) + (falling ? 8 : 0);
  return `${fluid.block}[level=${level}]`;
}
