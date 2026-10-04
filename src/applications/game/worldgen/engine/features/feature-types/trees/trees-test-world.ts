// Test support: the synthetic terrain TreesReference.java places trees on (keep both definitions identical),
// exposed as a BaseColumnSource. Flat 8x8 plateaus 1-3 blocks apart at y 66..69 (grass over dirt over stone), a sandy
// shallow at y 58 (water up to y 62) west of x = 40, bedrock at -64, cave air pockets at y 20..30 on every ninth
// diagonal, short grass / tall grass / poppies on the plateaus, sparse floating stone pillars, a two block thick
// stone and dirt slab floating over x >= 72, z <= -120 (root systems grow above it and hang roots under it), and mud in a
// third of the shallow's columns.

import { BlockPalette, ChunkBlocks } from "../../../chunk";
import type { BaseColumnSource } from "../../level/base-column-source";

function floorMod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function treesTerrainHeight(x: number, z: number): number {
  if (x < 40) return 58;
  return 66 + floorMod((x >> 3) * 3 + (z >> 3) * 5, 4);
}

export function treesBaseState(x: number, y: number, z: number): string {
  if (y < -64 || y >= 320) return "minecraft:void_air";
  if (y === -64) return "minecraft:bedrock";
  const height = treesTerrainHeight(x, z);
  if (y <= height) {
    if (floorMod(x + z, 9) === 0 && y >= 20 && y <= 30) return "minecraft:cave_air";
    if (y === height) {
      if (height >= 63) return "minecraft:grass_block[snowy=false]";
      return floorMod(x + z, 3) === 0 ? "minecraft:mud" : "minecraft:sand";
    }
    if (y >= height - 3) return "minecraft:dirt";
    return "minecraft:stone";
  }
  if (height >= 63) {
    if (floorMod(x * 11 + z * 7, 211) === 0 && y >= height + 3 && y <= height + 14) return "minecraft:stone";
    if (x >= 72 && z <= -120 && y === height + 3) return "minecraft:stone";
    if (x >= 72 && z <= -120 && y === height + 4) return "minecraft:dirt";
    if (y === height + 1) {
      if (floorMod(x * 5 + z * 3, 13) === 0) return "minecraft:tall_grass[half=lower]";
      if (floorMod(x * 3 + z * 5, 7) === 0) return "minecraft:short_grass";
      if (floorMod(x + z * 3, 17) === 0) return "minecraft:poppy";
    }
    if (y === height + 2 && floorMod(x * 5 + z * 3, 13) === 0) return "minecraft:tall_grass[half=upper]";
  }
  if (y <= 62) return "minecraft:water[level=0]";
  return "minecraft:air";
}

export class TreesTestWorldSource implements BaseColumnSource {
  readonly settings = { minY: -64, height: 384, seaLevel: 63 };
  readonly palette = new BlockPalette();
  private readonly columns = new Map<string, ChunkBlocks>();

  constructor(private readonly biome = "minecraft:forest") {}

  generateBaseColumn(chunkX: number, chunkZ: number): ChunkBlocks {
    const key = `${chunkX},${chunkZ}`;
    const cached = this.columns.get(key);
    if (cached) return cached;
    const column = new ChunkBlocks(chunkX, chunkZ, this.settings.minY, this.settings.height, this.palette);
    for (let y = column.minY; y <= column.maxY; y++) {
      for (let localZ = 0; localZ < 16; localZ++) {
        for (let localX = 0; localX < 16; localX++) column.setState(localX, y, localZ, treesBaseState(chunkX * 16 + localX, y, chunkZ * 16 + localZ));
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
