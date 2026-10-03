// Contracts for biome data: what the surface looks like and what grows there.

import type { BlockType } from "@/applications/game/blocks";
import type { TreeSpeciesName } from "../trees/tree-types";

export enum BiomeId {
  DeepOcean,
  Ocean,
  WarmOcean,
  FrozenOcean,
  Beach,
  ColdBeach,
  RockyShore,
  River,
  FrozenRiver,
  MangroveSwamp,
  Swamp,
  Bog,
  Plains,
  Meadow,
  Forest,
  BirchForest,
  AutumnForest,
  CherryGrove,
  OldGrowthForest,
  Shrubland,
  RedwoodForest,
  Taiga,
  SnowyTaiga,
  Tundra,
  SnowyPlains,
  Glacier,
  Savanna,
  SavannaWoodland,
  Steppe,
  Desert,
  RedDesert,
  Badlands,
  Canyon,
  SaltFlat,
  Jungle,
  Rainforest,
  AlpineMeadow,
  SubalpineForest,
  SnowyPeaks,
  RockyPeaks,
  HighlandMoor,
  VolcanicSlopes,
  VolcanicCrater,
}

export interface TreeSpawn {
  species: TreeSpeciesName;
  /** Relative chance against the other spawns of the same biome. */
  weight: number;
  /** Paints the canopy, for example autumn colors on an oak. */
  leafVariant?: BlockType;
}

export interface GroundCoverEntry {
  block: BlockType;
  /** Chance per column, inside a patch when a patch is defined. */
  chance: number;
  /** Restricts the plant to clumps: noise at this block scale must exceed the threshold. */
  patch?: { scale: number; threshold: number };
  /** -1 thrives in open ground, +1 thrives under dense canopy. */
  shadeAffinity?: number;
}

export type StrataStyle = "badlands" | "canyon";

export interface BiomeDefinition {
  id: BiomeId;
  name: string;
  topBlock: BlockType;
  /** Blocks directly under the top block, including the top block itself in `topDepth`. */
  topDepth: number;
  fillerBlock: BlockType;
  fillerDepth: number;
  /** Exposed where terrain is too steep to hold soil. */
  rockBlock: BlockType;
  shallowWaterFloor: BlockType;
  deepWaterFloor: BlockType;
  strataStyle?: StrataStyle;
  trees: TreeSpawn[];
  /** Chance that a candidate planting spot (one per 5x5 area) grows something. */
  treeDensity: number;
  groundCover: GroundCoverEntry[];
}
