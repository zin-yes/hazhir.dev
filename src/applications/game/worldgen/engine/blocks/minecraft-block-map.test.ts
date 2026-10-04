import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BLOCK_TEXTURES,
  BlockType,
  NON_COLLIDABLE_BLOCKS,
  Texture,
  getBlockLightLevel,
  getDirection,
  getWaterLevel,
  isCrossBlock,
  isSlab,
  isStairs,
  isTopSlab,
  isWater,
} from "../../../blocks";
import { isIntentionallyDroppedBlock, toGameBlock } from "./minecraft-block-map";
import { CENSUS_BLOCK_NAMES } from "./minecraft-block-names.fixture";

let startedAtMs = 0;
const TEXTURE_DIRECTORY = fileURLToPath(new URL("../../../../../../public/game", import.meta.url));
const EMPTY_SPACE_NAMES = ["air", "cave_air", "void_air", "light", "structure_void", "barrier"];
const HIGHEST_ALLOWED_BLOCK_ID = 229;

const censusBlockStates = CENSUS_BLOCK_NAMES.map((blockName) => `minecraft:${blockName}`);

beforeAll(() => {
  startedAtMs = performance.now();
});

afterAll(() => {
  console.log(`minecraft-block-map.test.ts wall-clock: ${(performance.now() - startedAtMs).toFixed(0)} ms`);
});

describe("toGameBlock over the worldgen block census", () => {
  test("every census name maps without throwing", () => {
    expect(censusBlockStates.length).toBeGreaterThan(600);
    const failures: string[] = [];
    for (const blockState of censusBlockStates) {
      try {
        toGameBlock(blockState);
      } catch {
        failures.push(blockState);
      }
    }
    expect(failures).toEqual([]);
  });

  test("a name maps to air only when it is empty space or explicitly listed as dropped", () => {
    const undocumentedAir = censusBlockStates.filter((blockState) => {
      const blockName = blockState.slice("minecraft:".length);
      return (
        toGameBlock(blockState) === BlockType.AIR &&
        !EMPTY_SPACE_NAMES.includes(blockName) &&
        !isIntentionallyDroppedBlock(blockName)
      );
    });
    expect(undocumentedAir).toEqual([]);
  });

  test("unknown or foreign-namespace blocks throw instead of becoming stone", () => {
    expect(() => toGameBlock("minecraft:definitely_not_a_block")).toThrow();
    expect(() => toGameBlock("terralith:volcanic_rock")).toThrow();
    expect(() => toGameBlock("minecraft:oak_stairs_but_not_really")).toThrow();
    expect(() => toGameBlock("minecraft:copper_golem_ore")).toThrow();
  });

  test("every mapped block has all of its texture files in public/game and a one-byte id", () => {
    const mappedBlocks = new Set(censusBlockStates.map((blockState) => toGameBlock(blockState)));
    const textureFileNames = Object.values(Texture);
    const missingTextureFiles: string[] = [];
    for (const gameBlock of mappedBlocks) {
      expect(gameBlock).toBeLessThanOrEqual(HIGHEST_ALLOWED_BLOCK_ID);
      const textureIndices = Object.values(BLOCK_TEXTURES[gameBlock] ?? {});
      expect(textureIndices.length).toBeGreaterThan(0);
      for (const textureIndex of textureIndices) {
        const textureFileName = textureFileNames[textureIndex]!;
        if (!existsSync(join(TEXTURE_DIRECTORY, textureFileName))) {
          missingTextureFiles.push(`${BlockType[gameBlock]} -> ${textureFileName}`);
        }
      }
    }
    expect(mappedBlocks.size).toBeGreaterThan(100);
    expect(missingTextureFiles).toEqual([]);
  });
});

describe("water and lava", () => {
  test("source water, with or without a level property, is the game's source block", () => {
    expect(toGameBlock("minecraft:water")).toBe(BlockType.WATER);
    expect(toGameBlock("minecraft:water[level=0]")).toBe(BlockType.WATER);
  });

  test("flowing levels 1 to 7 invert into the game's level scale (higher is closer to the source)", () => {
    for (let minecraftLevel = 1; minecraftLevel <= 7; minecraftLevel++) {
      const gameBlock = toGameBlock(`minecraft:water[level=${minecraftLevel}]`);
      expect(isWater(gameBlock)).toBe(true);
      expect(getWaterLevel(gameBlock)).toBe(8 - minecraftLevel);
    }
    expect(toGameBlock("minecraft:water[level=1]")).toBe(BlockType.WATER_LEVEL_7);
    expect(toGameBlock("minecraft:water[level=7]")).toBe(BlockType.WATER_LEVEL_1);
  });

  test("falling water levels 8 to 15 become the falling water block", () => {
    for (let minecraftLevel = 8; minecraftLevel <= 15; minecraftLevel++) {
      expect(toGameBlock(`minecraft:water[level=${minecraftLevel}]`)).toBe(BlockType.WATER_FALLING);
    }
  });

  test("aquatic plants and waterlogged see-through blocks leave water, not holes", () => {
    for (const aquaticName of ["seagrass", "tall_seagrass", "kelp", "kelp_plant", "bubble_column"]) {
      expect(toGameBlock(`minecraft:${aquaticName}`)).toBe(BlockType.WATER);
    }
    expect(toGameBlock("minecraft:lantern[hanging=false,waterlogged=true]")).toBe(BlockType.WATER);
    expect(toGameBlock("minecraft:sea_pickle[pickles=2,waterlogged=true]")).toBe(BlockType.WATER);
    expect(toGameBlock("minecraft:sea_pickle[pickles=2,waterlogged=false]")).toBe(BlockType.AIR);
    expect(toGameBlock("minecraft:oak_slab[type=bottom,waterlogged=true]")).toBe(BlockType.PLANKS_SLAB);
  });

  test("lava is a bright block you can walk into", () => {
    for (const lavaState of ["minecraft:lava", "minecraft:lava[level=0]", "minecraft:lava[level=5]"]) {
      const gameBlock = toGameBlock(lavaState);
      expect(gameBlock).toBe(BlockType.LAVA);
      expect(getBlockLightLevel(gameBlock)).toBe(15);
      expect(NON_COLLIDABLE_BLOCKS).toContain(gameBlock);
    }
  });
});

describe("ores and veins", () => {
  const oreMaterials = ["coal", "copper", "diamond", "emerald", "gold", "iron", "lapis", "redstone"];

  test("ores become the stone they sit in", () => {
    for (const material of oreMaterials) {
      expect(toGameBlock(`minecraft:${material}_ore`)).toBe(BlockType.STONE);
      expect(toGameBlock(`minecraft:deepslate_${material}_ore`)).toBe(BlockType.DEEPSLATE);
    }
  });

  test("vein filler blocks become the host rock of their vein", () => {
    expect(toGameBlock("minecraft:raw_iron_block")).toBe(BlockType.TUFF);
    expect(toGameBlock("minecraft:raw_copper_block")).toBe(BlockType.GRANITE);
    expect(toGameBlock("minecraft:infested_deepslate[axis=y]")).toBe(BlockType.DEEPSLATE);
  });
});

describe("shapes and species", () => {
  test("stairs keep their facing in the game's stair direction", () => {
    const expectedDirections = { north: "NORTH", south: "SOUTH", east: "EAST", west: "WEST" } as const;
    for (const [facing, direction] of Object.entries(expectedDirections)) {
      for (const material of ["oak", "spruce", "cobblestone", "stone_brick", "deepslate_tile"]) {
        const gameBlock = toGameBlock(`minecraft:${material}_stairs[facing=${facing},half=bottom,shape=straight]`);
        expect(isStairs(gameBlock)).toBe(true);
        expect(getDirection(gameBlock)).toBe(direction);
      }
    }
  });

  test("slabs keep bottom and top, and double slabs become the full block", () => {
    expect(toGameBlock("minecraft:oak_slab[type=bottom]")).toBe(BlockType.PLANKS_SLAB);
    expect(toGameBlock("minecraft:oak_slab[type=top]")).toBe(BlockType.PLANKS_SLAB_TOP);
    expect(toGameBlock("minecraft:stone_slab[type=double]")).toBe(BlockType.STONE);
    expect(toGameBlock("minecraft:spruce_slab[type=double]")).toBe(BlockType.PLANKS_SPRUCE);
    const sandstoneSlab = toGameBlock("minecraft:sandstone_slab[type=bottom]");
    expect(isSlab(sandstoneSlab)).toBe(false);
    expect(sandstoneSlab).toBe(BlockType.SANDSTONE);
    expect(isTopSlab(toGameBlock("minecraft:cobblestone_slab[type=top]"))).toBe(true);
  });

  test("snow layers: thin layer, slab up to four layers, full block above", () => {
    expect(toGameBlock("minecraft:snow[layers=1]")).toBe(BlockType.SNOW_LAYER);
    expect(toGameBlock("minecraft:snow[layers=3]")).toBe(BlockType.SNOW_SLAB);
    expect(toGameBlock("minecraft:snow[layers=4]")).toBe(BlockType.SNOW_SLAB);
    expect(toGameBlock("minecraft:snow[layers=5]")).toBe(BlockType.SNOW_BLOCK);
    expect(toGameBlock("minecraft:snow[layers=8]")).toBe(BlockType.SNOW_BLOCK);
    expect(toGameBlock("minecraft:powder_snow")).toBe(BlockType.SNOW_BLOCK);
    expect(NON_COLLIDABLE_BLOCKS).toContain(BlockType.SNOW_LAYER);
  });

  test("logs ignore axis and each species gets its own block and leaves", () => {
    for (const axis of ["x", "y", "z"]) {
      expect(toGameBlock(`minecraft:oak_log[axis=${axis}]`)).toBe(BlockType.LOG);
      expect(toGameBlock(`minecraft:stripped_dark_oak_log[axis=${axis}]`)).toBe(BlockType.LOG_DARK_OAK);
    }
    const speciesLeaves = ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "cherry", "azalea", "mangrove"].map(
      (species) => toGameBlock(`minecraft:${species}_leaves[distance=1,persistent=false]`),
    );
    expect(new Set(speciesLeaves).size).toBe(speciesLeaves.length);
  });

  test("grass block keeps its snowy variant and double plants use the plant model", () => {
    expect(toGameBlock("minecraft:grass_block[snowy=false]")).toBe(BlockType.GRASS);
    expect(toGameBlock("minecraft:grass_block[snowy=true]")).toBe(BlockType.GRASS_SNOWY);
    for (const half of ["lower", "upper"]) {
      expect(isCrossBlock(toGameBlock(`minecraft:sunflower[half=${half}]`))).toBe(true);
      expect(isCrossBlock(toGameBlock(`minecraft:tall_grass[half=${half}]`))).toBe(true);
    }
    expect(toGameBlock("minecraft:pointed_dripstone[vertical_direction=up,thickness=tip]")).toBe(
      BlockType.POINTED_DRIPSTONE_UP,
    );
  });
});
