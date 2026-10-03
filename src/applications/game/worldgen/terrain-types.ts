// Shape of the data the terrain model produces for one world column.

import type { ClimateSample } from "./climate";

export type IslandKind = "none" | "atoll" | "cay" | "temperate" | "polar";

export interface TerrainSample {
  /** Height of the highest solid block's top face. */
  height: number;
  /** Water fills every block below this height. Zero when the column is dry. */
  waterLevel: number;
  climate: ClimateSample;
  mountainMask: number;
  riverValleyWeight: number;
  riverChannelWeight: number;
  fjordWeight: number;
  canyonWeight: number;
  mesaWeight: number;
  volcanoWeight: number;
  craterWeight: number;
  islandKind: IslandKind;
  lakeWeight: number;
}
