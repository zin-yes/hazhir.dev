import { BlockType } from "../../../blocks";
import { ORE_MATERIALS } from "./terrain-block-names";

export type CompassDirection = "north" | "south" | "east" | "west";

const STAIRS_BY_DIRECTION: Record<string, Record<CompassDirection, BlockType>> = {
  wood: {
    north: BlockType.PLANKS_STAIRS_NORTH,
    south: BlockType.PLANKS_STAIRS_SOUTH,
    east: BlockType.PLANKS_STAIRS_EAST,
    west: BlockType.PLANKS_STAIRS_WEST,
  },
  cobble: {
    north: BlockType.COBBLESTONE_STAIRS_NORTH,
    south: BlockType.COBBLESTONE_STAIRS_SOUTH,
    east: BlockType.COBBLESTONE_STAIRS_EAST,
    west: BlockType.COBBLESTONE_STAIRS_WEST,
  },
};

const SLABS_BY_STYLE: Record<string, { bottom: BlockType; top: BlockType }> = {
  wood: { bottom: BlockType.PLANKS_SLAB, top: BlockType.PLANKS_SLAB_TOP },
  stone: { bottom: BlockType.STONE_SLAB, top: BlockType.STONE_SLAB_TOP },
  cobble: { bottom: BlockType.COBBLESTONE_SLAB, top: BlockType.COBBLESTONE_SLAB_TOP },
};

/** A shaped block (stairs, slab, wall) falls back to `fullBlock` when the game has no matching shape. */
interface ShapedMaterial {
  fullBlock: BlockType;
  slabStyle?: "wood" | "stone" | "cobble";
  stairStyle?: "wood" | "cobble";
}

interface WoodSpecies {
  planks: BlockType;
  log: BlockType;
  leaves: BlockType;
  sapling: BlockType;
}

export const WOOD_SPECIES: Record<string, WoodSpecies> = {
  oak: { planks: BlockType.PLANKS, log: BlockType.LOG, leaves: BlockType.LEAVES, sapling: BlockType.SAPLING },
  spruce: { planks: BlockType.PLANKS_SPRUCE, log: BlockType.LOG_SPRUCE, leaves: BlockType.LEAVES_SPRUCE, sapling: BlockType.SAPLING },
  birch: { planks: BlockType.PLANKS_BIRCH, log: BlockType.LOG_BIRCH, leaves: BlockType.LEAVES_BIRCH, sapling: BlockType.SAPLING },
  jungle: { planks: BlockType.PLANKS_JUNGLE, log: BlockType.LOG_JUNGLE, leaves: BlockType.LEAVES_JUNGLE, sapling: BlockType.SAPLING },
  acacia: { planks: BlockType.PLANKS_ACACIA, log: BlockType.LOG_ACACIA, leaves: BlockType.LEAVES_ACACIA, sapling: BlockType.SAPLING },
  dark_oak: { planks: BlockType.PLANKS_DARK_OAK, log: BlockType.LOG_DARK_OAK, leaves: BlockType.LEAVES_DARK_OAK, sapling: BlockType.SAPLING },
  cherry: { planks: BlockType.PLANKS_CHERRY, log: BlockType.LOG_CHERRY, leaves: BlockType.LEAVES_BLOSSOM, sapling: BlockType.SAPLING },
  mangrove: { planks: BlockType.PLANKS_MANGROVE, log: BlockType.LOG_MANGROVE, leaves: BlockType.LEAVES_MANGROVE, sapling: BlockType.SAPLING },
  crimson: { planks: BlockType.PLANKS_DARK_OAK, log: BlockType.LOG_DARK_OAK, leaves: BlockType.LEAVES_DARK_OAK, sapling: BlockType.SAPLING },
  warped: { planks: BlockType.PLANKS_DARK_OAK, log: BlockType.LOG_DARK_OAK, leaves: BlockType.LEAVES_DARK_OAK, sapling: BlockType.SAPLING },
};

const STONE_AND_BRICK_MATERIALS: Record<string, ShapedMaterial> = {
  stone: { fullBlock: BlockType.STONE, slabStyle: "stone", stairStyle: "cobble" },
  smooth_stone: { fullBlock: BlockType.STONE, slabStyle: "stone", stairStyle: "cobble" },
  stone_brick: { fullBlock: BlockType.STONE_BRICKS, slabStyle: "stone", stairStyle: "cobble" },
  mossy_stone_brick: { fullBlock: BlockType.MOSSY_STONE_BRICKS, slabStyle: "stone", stairStyle: "cobble" },
  cobblestone: { fullBlock: BlockType.COBBLESTONE, slabStyle: "cobble", stairStyle: "cobble" },
  mossy_cobblestone: { fullBlock: BlockType.MOSSY_COBBLESTONE, slabStyle: "cobble", stairStyle: "cobble" },
  andesite: { fullBlock: BlockType.ANDESITE, slabStyle: "stone", stairStyle: "cobble" },
  polished_andesite: { fullBlock: BlockType.ANDESITE, slabStyle: "stone", stairStyle: "cobble" },
  diorite: { fullBlock: BlockType.DIORITE, slabStyle: "stone", stairStyle: "cobble" },
  polished_diorite: { fullBlock: BlockType.DIORITE, slabStyle: "stone", stairStyle: "cobble" },
  granite: { fullBlock: BlockType.GRANITE, slabStyle: "stone", stairStyle: "cobble" },
  polished_granite: { fullBlock: BlockType.GRANITE, slabStyle: "stone", stairStyle: "cobble" },
  cobbled_deepslate: { fullBlock: BlockType.COBBLED_DEEPSLATE, slabStyle: "stone", stairStyle: "cobble" },
  polished_deepslate: { fullBlock: BlockType.DEEPSLATE_BRICKS, slabStyle: "stone", stairStyle: "cobble" },
  deepslate_brick: { fullBlock: BlockType.DEEPSLATE_BRICKS, slabStyle: "stone", stairStyle: "cobble" },
  deepslate_tile: { fullBlock: BlockType.DEEPSLATE_BRICKS, slabStyle: "stone", stairStyle: "cobble" },
  blackstone: { fullBlock: BlockType.BLACKSTONE },
  polished_blackstone: { fullBlock: BlockType.BLACKSTONE },
  polished_blackstone_brick: { fullBlock: BlockType.BLACKSTONE },
  brick: { fullBlock: BlockType.BRICKS },
  mud_brick: { fullBlock: BlockType.MUD_BRICKS },
  sandstone: { fullBlock: BlockType.SANDSTONE },
  cut_sandstone: { fullBlock: BlockType.SANDSTONE },
  smooth_sandstone: { fullBlock: BlockType.SANDSTONE },
  red_sandstone: { fullBlock: BlockType.RED_SANDSTONE },
  cut_red_sandstone: { fullBlock: BlockType.RED_SANDSTONE },
  smooth_red_sandstone: { fullBlock: BlockType.RED_SANDSTONE },
  smooth_quartz: { fullBlock: BlockType.CALCITE },
  prismarine: { fullBlock: BlockType.PRISMARINE },
  prismarine_brick: { fullBlock: BlockType.PRISMARINE },
  dark_prismarine: { fullBlock: BlockType.PRISMARINE },
  petrified_oak: { fullBlock: BlockType.PLANKS, slabStyle: "wood", stairStyle: "wood" },
};

const COPPER_BY_OXIDATION: Record<string, BlockType> = {
  "": BlockType.TERRACOTTA_ORANGE,
  exposed: BlockType.TERRACOTTA_BROWN,
  weathered: BlockType.PRISMARINE,
  oxidized: BlockType.PRISMARINE,
};

export const DYE_COLORS = [
  "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
  "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black",
];

const TERRACOTTA_BY_COLOR: Record<string, BlockType> = {
  white: BlockType.TERRACOTTA_WHITE,
  orange: BlockType.TERRACOTTA_ORANGE,
  magenta: BlockType.TERRACOTTA_MAGENTA,
  light_blue: BlockType.TERRACOTTA_LIGHT_BLUE,
  yellow: BlockType.TERRACOTTA_YELLOW,
  lime: BlockType.TERRACOTTA_LIME,
  pink: BlockType.TERRACOTTA_PINK,
  gray: BlockType.TERRACOTTA_GRAY,
  light_gray: BlockType.TERRACOTTA_LIGHT_GRAY,
  cyan: BlockType.TERRACOTTA_CYAN,
  purple: BlockType.TERRACOTTA_PURPLE,
  blue: BlockType.TERRACOTTA_BLUE,
  brown: BlockType.TERRACOTTA_BROWN,
  green: BlockType.TERRACOTTA_GREEN,
  red: BlockType.TERRACOTTA_RED,
  black: BlockType.TERRACOTTA_BLACK,
};

const CORAL_BLOCK_BY_KIND: Record<string, BlockType> = {
  tube: BlockType.CORAL_BLUE,
  brain: BlockType.CORAL_PINK,
  bubble: BlockType.CORAL_PINK,
  fire: BlockType.CORAL_ORANGE,
  horn: BlockType.CORAL_ORANGE,
};

const WOOD_SPECIES_PATTERN = Object.keys(WOOD_SPECIES).join("|");
const DYE_COLOR_PATTERN = DYE_COLORS.join("|");

const COLORED_BLOCK_PATTERN = new RegExp(
  `^(${DYE_COLOR_PATTERN})_(wool|carpet|bed|banner|wall_banner|candle|candle_cake|stained_glass|stained_glass_pane|terracotta|glazed_terracotta|concrete|concrete_powder)$`,
);
const WOOD_BLOCK_PATTERN = new RegExp(`^(?:stripped_)?(${WOOD_SPECIES_PATTERN})_(planks|log|wood|stem|hyphae|leaves|sapling)$`);
const DROPPED_FIXTURE_PATTERN = new RegExp(
  `^(?:${WOOD_SPECIES_PATTERN}|bamboo|iron|stone|polished_blackstone|copper|exposed_copper|weathered_copper|oxidized_copper)_(door|trapdoor|fence|fence_gate|button|pressure_plate|sign|wall_sign|hanging_sign|wall_hanging_sign)$`,
);
const CUT_COPPER_MATERIAL_PATTERN = /^(?:waxed_)?(?:(exposed|weathered|oxidized)_)?cut_copper$/;
const SHAPED_BLOCK_PATTERN = /^(.+)_(stairs|slab|wall)$/;
const ORE_BLOCK_PATTERN = /^(deepslate_|nether_)?([a-z]+)_ore$/;
const COPPER_BLOCK_PATTERN = /^(?:waxed_)?(?:(exposed|weathered|oxidized)_)?(?:copper_block|cut_copper|chiseled_copper)$/;
const CORAL_PATTERN = /^(dead_)?(tube|brain|bubble|fire|horn)_coral(_block|_fan|_wall_fan)?$/;

export interface BlockStateProperties {
  [propertyName: string]: string;
}

const DROPPED_COLORED_KINDS = ["carpet", "bed", "banner", "wall_banner", "candle", "candle_cake"];

export function isDroppedFamilyBlock(blockPath: string): boolean {
  if (blockPath.startsWith("potted_")) return true;
  if (/^(light|heavy)_weighted_pressure_plate$/.test(blockPath)) return true;
  if (DROPPED_FIXTURE_PATTERN.test(blockPath)) return true;
  const coloredMatch = COLORED_BLOCK_PATTERN.exec(blockPath);
  return coloredMatch !== null && DROPPED_COLORED_KINDS.includes(coloredMatch[2]!);
}

function resolveShapedMaterial(materialName: string): ShapedMaterial | undefined {
  const woodSpecies = WOOD_SPECIES[materialName];
  if (woodSpecies) return { fullBlock: woodSpecies.planks, slabStyle: "wood", stairStyle: "wood" };
  const stoneMaterial = STONE_AND_BRICK_MATERIALS[materialName];
  if (stoneMaterial) return stoneMaterial;
  const copperMatch = CUT_COPPER_MATERIAL_PATTERN.exec(materialName);
  if (copperMatch) return { fullBlock: COPPER_BY_OXIDATION[copperMatch[1] ?? ""]! };
  return undefined;
}

function resolveShapedBlock(materialName: string, shape: string, properties: BlockStateProperties): BlockType | undefined {
  const material = resolveShapedMaterial(materialName);
  if (!material) return undefined;
  if (shape === "wall") return material.fullBlock;
  if (shape === "stairs") {
    if (!material.stairStyle) return material.fullBlock;
    const facing = (properties.facing ?? "north") as CompassDirection;
    return STAIRS_BY_DIRECTION[material.stairStyle]![facing];
  }
  const slabType = properties.type ?? "bottom";
  if (slabType === "double" || !material.slabStyle) return material.fullBlock;
  const slabs = SLABS_BY_STYLE[material.slabStyle]!;
  return slabType === "top" ? slabs.top : slabs.bottom;
}

function resolveCoralBlock(coralMatch: RegExpExecArray): BlockType | "water-plant" {
  const [, deadPrefix, coralKind, coralShape] = coralMatch;
  if (coralShape === "_block") return deadPrefix ? BlockType.CORAL_DEAD : CORAL_BLOCK_BY_KIND[coralKind!]!;
  return "water-plant";
}

/**
 * Resolves names that belong to a systematic family (dye colours, wood species, shaped materials, ores, corals).
 * Returns "water-plant" for coral plants and fans, which are water unless the state is not waterlogged.
 * Returns undefined when the name is not part of any family, so the caller can throw for unknown names.
 */
export function resolveFamilyBlock(blockPath: string, properties: BlockStateProperties): BlockType | "water-plant" | undefined {
  if (isDroppedFamilyBlock(blockPath)) return BlockType.AIR;

  const coloredMatch = COLORED_BLOCK_PATTERN.exec(blockPath);
  if (coloredMatch) {
    const color = coloredMatch[1]!;
    const kind = coloredMatch[2]!;
    if (kind === "stained_glass" || kind === "stained_glass_pane") return BlockType.GLASS;
    return TERRACOTTA_BY_COLOR[color];
  }

  const woodMatch = WOOD_BLOCK_PATTERN.exec(blockPath);
  if (woodMatch) {
    const species = WOOD_SPECIES[woodMatch[1]!]!;
    const kind = woodMatch[2]!;
    if (kind === "planks") return species.planks;
    if (kind === "leaves") return species.leaves;
    if (kind === "sapling") return species.sapling;
    return species.log;
  }

  const shapedMatch = SHAPED_BLOCK_PATTERN.exec(blockPath);
  if (shapedMatch) return resolveShapedBlock(shapedMatch[1]!, shapedMatch[2]!, properties);

  const oreMatch = ORE_BLOCK_PATTERN.exec(blockPath);
  if (oreMatch && ORE_MATERIALS.includes(oreMatch[2]!)) {
    if (oreMatch[1] === "deepslate_") return BlockType.DEEPSLATE;
    if (oreMatch[1] === "nether_") return BlockType.NETHERRACK;
    return BlockType.STONE;
  }

  const copperMatch = COPPER_BLOCK_PATTERN.exec(blockPath);
  if (copperMatch) return COPPER_BY_OXIDATION[copperMatch[1] ?? ""];

  const coralMatch = CORAL_PATTERN.exec(blockPath);
  if (coralMatch) return resolveCoralBlock(coralMatch);

  return undefined;
}
