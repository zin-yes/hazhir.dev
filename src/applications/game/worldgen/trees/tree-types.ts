/**
 * Contracts shared by every tree, bush and cactus shape builder.
 * Builders are pure: they know nothing about chunks and only emit placements
 * through a TreeBlockWriter, relative to the trunk base column.
 */
import type { BlockType } from "@/applications/game/blocks";

export interface TreeBlockWriter {
  /**
   * dx/dz are offsets from the trunk base column, dy is relative to the first block ABOVE the ground
   * (dy = 0 is the trunk's lowest block). May be negative (roots reach into water or ground).
   * Logs may replace air, leaves, plants and water; they must NOT replace solid terrain.
   */
  placeLog(dx: number, dy: number, dz: number, block: BlockType): void;
  /** Only fills air and replaceable plants; never replaces logs or terrain. */
  placeLeaf(dx: number, dy: number, dz: number, block: BlockType): void;
  /** Overwrites the ground block under (dx, dz); used for podzol, moss and coarse dirt patches. Only replaces natural soil. */
  placeGround(dx: number, dz: number, block: BlockType): void;
}

export interface TreeBuildOptions {
  /** Deterministic [0, 1) stream provided by the caller, seeded per tree position. */
  random: () => number;
  /** 0.35 to 1.3. Stunting near altitude, treeline or drought; scales trunk height and canopy size. */
  heightScale: number;
  /**
   * Optional leaf override (for example LEAVES_AUTUMN_RED on an oak). Species that support it paint
   * roughly 80 percent of their leaves with the override in coherent 2x2x2 patches and keep the rest
   * in their natural leaf block. Bush "bush_autumn" uses it as its only leaf block.
   * Species that do not list leafVariant support (conifers, palm, acacia, tropical, cactus) ignore it.
   */
  leafVariant?: BlockType;
}

export type TreeSpeciesName =
  | "oak"
  | "tall_oak"
  | "big_oak"
  | "birch"
  | "spruce"
  | "pine"
  | "krummholz"
  | "acacia"
  | "baobab"
  | "jungle"
  | "jungle_giant"
  | "palm"
  | "mangrove"
  | "redwood"
  | "cherry"
  | "dead"
  | "bush_oak"
  | "bush_spruce"
  | "bush_autumn"
  | "heath_mat"
  | "saguaro"
  | "barrel_cactus";

export interface TreeSpecies {
  name: TreeSpeciesName;
  /** Maximum horizontal extent from the trunk base column in blocks, including ground patches. A true upper bound. */
  footprintRadius: number;
  /** Maximum blocks above ground including canopy, at heightScale 1.3. A true upper bound. */
  maxHeight: number;
  build(writer: TreeBlockWriter, options: TreeBuildOptions): void;
}
