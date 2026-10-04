// The symbolic block ids the terrain stage emits (one byte each), and the block state each stands for.
// The pipeline maps them to palette ids: defaultBlock / defaultFluid come from the noise settings, the rest are fixed.

export const BLOCK_AIR = 0;
export const BLOCK_DEFAULT_BLOCK = 1;
export const BLOCK_DEFAULT_FLUID = 2;
/** NoiseBasedChunkGenerator.createFluidPicker: lava fills open space below y = min(-54, seaLevel). */
export const BLOCK_LAVA = 3;
/** Ore vein fillers and ores (OreVeinifier.VeinType), only produced when ore veins are enabled. */
export const BLOCK_GRANITE = 4;
export const BLOCK_TUFF = 5;
export const BLOCK_COPPER_ORE = 6;
export const BLOCK_DEEPSLATE_IRON_ORE = 7;
export const BLOCK_RAW_COPPER_BLOCK = 8;
export const BLOCK_RAW_IRON_BLOCK = 9;

export const TERRAIN_BLOCK_SYMBOL_COUNT = 10;

export const LAVA_STATE = "minecraft:lava[level=0]";

/** Block state strings by terrain symbol; `defaultBlock` and `defaultFluid` are the noise settings states. */
export function terrainSymbolStates(defaultBlock: string, defaultFluid: string): string[] {
  const states = new Array<string>(TERRAIN_BLOCK_SYMBOL_COUNT);
  states[BLOCK_AIR] = "minecraft:air";
  states[BLOCK_DEFAULT_BLOCK] = defaultBlock;
  states[BLOCK_DEFAULT_FLUID] = defaultFluid;
  states[BLOCK_LAVA] = LAVA_STATE;
  states[BLOCK_GRANITE] = "minecraft:granite";
  states[BLOCK_TUFF] = "minecraft:tuff";
  states[BLOCK_COPPER_ORE] = "minecraft:copper_ore";
  states[BLOCK_DEEPSLATE_IRON_ORE] = "minecraft:deepslate_iron_ore";
  states[BLOCK_RAW_COPPER_BLOCK] = "minecraft:raw_copper_block";
  states[BLOCK_RAW_IRON_BLOCK] = "minecraft:raw_iron_block";
  return states;
}
