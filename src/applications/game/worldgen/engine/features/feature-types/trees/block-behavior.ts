// Block behavior the catalog does not carry, recorded from the real 1.20.6 classes (see fixtures/TreesReference.java):
// BlockState.isSolidRender (huge mushrooms) and the directions from which BlockState.updateShape removes an
// unsupported block (the neighbor updates along the faces of a placed tree).

import { blockNameOf } from "../../../chunk";
import type { WorldGenLevel } from "../../level/world-gen-level";
import { SOLID_RENDER_TABLE, UPDATE_SHAPE_AIR_TABLE } from "./block-behavior.generated";

type VariantTable = Record<string, readonly [defaultValue: number, variants?: Record<string, number>]>;

/** The table value of a state: its variant entry when its differing properties are listed, else the block default. */
function lookupStateValue(level: WorldGenLevel, table: VariantTable, state: string): number | undefined {
  const name = blockNameOf(state);
  const entry = table[name];
  if (entry === undefined) return undefined;
  const [defaultValue, variants] = entry;
  if (variants === undefined) return defaultValue;
  const defaults = level.blockStates.defaultProperties(name);
  const properties = level.blockStates.propertiesOf(state);
  const differing = Object.keys(properties)
    .filter((key) => defaults[key] !== properties[key] && !(key === "waterlogged" && properties[key] === "true"))
    .sort()
    .map((key) => `${key}=${properties[key]}`)
    .join(",");
  return (differing === "" ? undefined : variants[differing]) ?? defaultValue;
}

export function isSolidRender(level: WorldGenLevel, x: number, y: number, z: number): boolean {
  return lookupStateValue(level, SOLID_RENDER_TABLE, level.getBlockState(x, y, z)) === 1;
}

/** Bit mask over Direction ordinals; 0 for blocks that do not break when unsupported. */
export function updateShapeAirMask(level: WorldGenLevel, state: string): number {
  return lookupStateValue(level, UPDATE_SHAPE_AIR_TABLE, state) ?? 0;
}
