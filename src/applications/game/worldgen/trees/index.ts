/**
 * Registry of every tree, bush and cactus shape builder, plus the worst-case extents callers need to
 * reserve around a trunk position when stamping shapes across chunk borders.
 */
import { ACACIA_SPECIES } from "./acacia";
import { BAOBAB_SPECIES } from "./baobab";
import { BIG_OAK_SPECIES } from "./big-oak";
import { BIRCH_SPECIES } from "./birch";
import { BUSH_AUTUMN_SPECIES, BUSH_OAK_SPECIES, BUSH_SPRUCE_SPECIES, HEATH_MAT_SPECIES } from "./bush";
import { BARREL_CACTUS_SPECIES, SAGUARO_SPECIES } from "./cactus";
import { CHERRY_SPECIES } from "./cherry";
import { DEAD_TREE_SPECIES } from "./dead-tree";
import { JUNGLE_GIANT_SPECIES, JUNGLE_SPECIES } from "./jungle";
import { KRUMMHOLZ_SPECIES } from "./krummholz";
import { MANGROVE_SPECIES } from "./mangrove";
import { OAK_SPECIES, TALL_OAK_SPECIES } from "./oak";
import { PALM_SPECIES } from "./palm";
import { REDWOOD_SPECIES } from "./redwood";
import { PINE_SPECIES, SPRUCE_SPECIES } from "./spruce";
import type { TreeSpecies, TreeSpeciesName } from "./tree-types";

export type { TreeBlockWriter, TreeBuildOptions, TreeSpecies, TreeSpeciesName } from "./tree-types";

export const TREE_SPECIES: Record<TreeSpeciesName, TreeSpecies> = {
  oak: OAK_SPECIES,
  tall_oak: TALL_OAK_SPECIES,
  big_oak: BIG_OAK_SPECIES,
  birch: BIRCH_SPECIES,
  spruce: SPRUCE_SPECIES,
  pine: PINE_SPECIES,
  krummholz: KRUMMHOLZ_SPECIES,
  acacia: ACACIA_SPECIES,
  baobab: BAOBAB_SPECIES,
  jungle: JUNGLE_SPECIES,
  jungle_giant: JUNGLE_GIANT_SPECIES,
  palm: PALM_SPECIES,
  mangrove: MANGROVE_SPECIES,
  redwood: REDWOOD_SPECIES,
  cherry: CHERRY_SPECIES,
  dead: DEAD_TREE_SPECIES,
  bush_oak: BUSH_OAK_SPECIES,
  bush_spruce: BUSH_SPRUCE_SPECIES,
  bush_autumn: BUSH_AUTUMN_SPECIES,
  heath_mat: HEATH_MAT_SPECIES,
  saguaro: SAGUARO_SPECIES,
  barrel_cactus: BARREL_CACTUS_SPECIES,
};

const ALL_TREE_SPECIES = Object.values(TREE_SPECIES);

export const MAX_TREE_FOOTPRINT_RADIUS = Math.max(...ALL_TREE_SPECIES.map((species) => species.footprintRadius));
export const MAX_TREE_HEIGHT = Math.max(...ALL_TREE_SPECIES.map((species) => species.maxHeight));
