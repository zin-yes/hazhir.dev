// Test support: the layered synthetic world CaveReference.java runs the real feature classes on (keep both
// definitions identical): a rolling surface 52..65 over a sea at y 62, dry and flooded caverns, a lava-floored deep
// cavern and a mixed block pool (stone variants, deepslate, terracotta, netherrack, ...) so ore targets, replace
// blobs and dripstone columns all have material to work on.

import type { BlockStateCatalog } from "../../../../block-state";
import { BlockPalette, ChunkBlocks } from "../../../../chunk";
import type { BaseColumnSource } from "../../../level/base-column-source";

const MIN_Y = -64;
const HEIGHT = 384;

function floorMod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function caveWorldSurfaceHeight(x: number, z: number): number {
  return 52 + floorMod(x * 7 + z * 13, 14);
}

const UPPER_POOL_BLOCKS = [
  ...Array<string>(6).fill("stone"), "granite", "diorite", "andesite", "tuff", "calcite", "basalt", "smooth_basalt", "blackstone", "netherrack",
  "yellow_terracotta", "terracotta", "orange_terracotta", "red_terracotta", "brown_terracotta", "red_sand", "dirt", "coarse_dirt", "gravel", "sand",
  "dripstone_block", "deepslate", "mossy_cobblestone", "crimson_nylium", "podzol",
];
const LOWER_POOL_BLOCKS = [
  ...Array<string>(8).fill("deepslate"), "tuff", "tuff", "calcite", "smooth_basalt", "blackstone", "basalt", "stone", "lava", "dripstone_block", "netherrack",
];

export function cellKind(x: number, z: number): number {
  return floorMod((x >> 3) * 7 + (z >> 3) * 11, 6);
}

export function upperCavernFloor(x: number, z: number): number {
  return 8 + floorMod(x * 7 + z * 3, 4);
}

export function upperCavernCeiling(x: number, z: number): number {
  return upperCavernFloor(x, z) + 7 + floorMod(x * 5 + z * 11, 6);
}

export function deepCavernFloor(x: number, z: number): number {
  return -40 + floorMod(x * 3 + z * 5, 3);
}

export function deepCavernCeiling(x: number, z: number): number {
  return deepCavernFloor(x, z) + 6 + floorMod(x + z * 7, 5);
}

/** Block names (default state) of the layered world; mirrors CaveReference.baseState. */
export function caveWorldBlockName(x: number, y: number, z: number): string {
  if (y < MIN_Y || y >= MIN_Y + HEIGHT) return "void_air";
  if (y === MIN_Y) return "bedrock";
  const surface = caveWorldSurfaceHeight(x, z);
  if (y > surface) return y <= 62 ? "water" : "air";
  const kind = cellKind(x, z);
  if (kind === 2 || kind === 3 || kind === 4) {
    const floor = upperCavernFloor(x, z);
    if (y > floor && y < upperCavernCeiling(x, z)) return kind === 4 && y <= floor + 3 ? "water" : "cave_air";
  }
  if (kind === 1 || kind === 3) {
    const floor = deepCavernFloor(x, z);
    if (y > floor && y < deepCavernCeiling(x, z)) return y <= floor + 1 ? "lava" : "cave_air";
  }
  if (y === surface) return surface >= 63 ? "grass_block" : "sand";
  if (y >= surface - 3) return "dirt";
  const index = (x >> 1) * 31 + (y >> 1) * 17 + (z >> 1) * 13 + (x >> 3) * (z >> 3) * 5;
  const pool = y < 0 ? LOWER_POOL_BLOCKS : UPPER_POOL_BLOCKS;
  return pool[floorMod(index, pool.length)]!;
}

export class CaveWorldSource implements BaseColumnSource {
  readonly settings = { minY: MIN_Y, height: HEIGHT, seaLevel: 63 };
  readonly palette = new BlockPalette();
  private readonly columns = new Map<string, ChunkBlocks>();
  private readonly defaultStateByBlockName = new Map<string, string>();

  constructor(
    private readonly blockStates: BlockStateCatalog,
    private readonly biome = "minecraft:plains",
  ) {}

  /** Normalized state of the undecorated world at a position. */
  baseStateAt(x: number, y: number, z: number): string {
    const blockName = caveWorldBlockName(x, y, z);
    let state = this.defaultStateByBlockName.get(blockName);
    if (state === undefined) {
      state = this.blockStates.normalize(this.blockStates.defaultState(`minecraft:${blockName}`));
      this.defaultStateByBlockName.set(blockName, state);
    }
    return state;
  }

  generateBaseColumn(chunkX: number, chunkZ: number): ChunkBlocks {
    const key = `${chunkX},${chunkZ}`;
    const cached = this.columns.get(key);
    if (cached) return cached;
    const column = new ChunkBlocks(chunkX, chunkZ, MIN_Y, HEIGHT, this.palette);
    for (let y = MIN_Y; y < MIN_Y + HEIGHT; y++) {
      for (let localZ = 0; localZ < 16; localZ++) {
        for (let localX = 0; localX < 16; localX++) column.setState(localX, y, localZ, this.baseStateAt(chunkX * 16 + localX, y, chunkZ * 16 + localZ));
      }
    }
    this.columns.set(key, column);
    return column;
  }

  rawBiomeAtQuart(): string {
    return this.biome;
  }

  biomeAt(): string {
    return this.biome;
  }
}
