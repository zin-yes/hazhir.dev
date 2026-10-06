// Interns block state strings ("minecraft:stone", "minecraft:oak_log[axis=y]") as small integers.
// Id 0 is always air. State strings list properties sorted by name, the way Minecraft prints them.

import { defineHotCounter, noteHot } from "../profiling/hot-counters";

export const AIR_STATE = "minecraft:air";

const PALETTE_LOOKUPS = defineHotCounter("palette.idLookups");
const PALETTE_STATES_ADDED = defineHotCounter("palette.statesAdded");

export interface ParsedBlockState {
  name: string;
  properties: Record<string, string>;
}

export function formatBlockState(name: string, properties?: Record<string, string>): string {
  if (!properties) return name;
  const propertyNames = Object.keys(properties).sort();
  if (propertyNames.length === 0) return name;
  return `${name}[${propertyNames.map((propertyName) => `${propertyName}=${properties[propertyName]}`).join(",")}]`;
}

export function parseBlockState(state: string): ParsedBlockState {
  const bracketIndex = state.indexOf("[");
  if (bracketIndex === -1) return { name: state, properties: {} };
  const properties: Record<string, string> = {};
  for (const pair of state.slice(bracketIndex + 1, -1).split(",")) {
    const separatorIndex = pair.indexOf("=");
    properties[pair.slice(0, separatorIndex)] = pair.slice(separatorIndex + 1);
  }
  return { name: state.slice(0, bracketIndex), properties };
}

export function blockNameOf(state: string): string {
  const bracketIndex = state.indexOf("[");
  return bracketIndex === -1 ? state : state.slice(0, bracketIndex);
}

export class BlockPalette {
  private readonly states: string[] = [AIR_STATE];
  private readonly idsByState = new Map<string, number>([[AIR_STATE, 0]]);

  idOf(state: string): number {
    noteHot(PALETTE_LOOKUPS);
    const existing = this.idsByState.get(state);
    if (existing !== undefined) return existing;
    noteHot(PALETTE_STATES_ADDED);
    const created = this.states.length;
    this.states.push(state);
    this.idsByState.set(state, created);
    return created;
  }

  stateOf(id: number): string {
    return this.states[id]!;
  }

  get size(): number {
    return this.states.length;
  }
}
