// Test support: the synthetic terrain FeaturesReference.java decorates (keep both definitions identical), exposed
// as a BaseColumnSource. Rolling 58..68 terrain (grass above sea level, sand below, water up to y 62), dirt under the
// top block, stone below, bedrock at -64 and thin cave-air pockets at y 20..30 on every ninth diagonal.

import { BlockPalette, ChunkBlocks } from "../../chunk";
import type { BaseColumnSource } from "../level/base-column-source";

export function syntheticTerrainHeight(x: number, z: number): number {
  return 58 + ((((x * 7 + z * 13) % 11) + 11) % 11);
}

/** An all-land variant (64..68) for density checks; not mirrored in Java. */
export function syntheticLandHeight(x: number, z: number): number {
  return 64 + ((((x * 7 + z * 13) % 5) + 5) % 5);
}

export function syntheticBaseState(x: number, y: number, z: number, terrainHeight = syntheticTerrainHeight): string {
  if (y < -64 || y >= 320) return "minecraft:void_air";
  if (y === -64) return "minecraft:bedrock";
  const height = terrainHeight(x, z);
  if (y <= height) {
    if ((((x + z) % 9) + 9) % 9 === 0 && y >= 20 && y <= 30) return "minecraft:cave_air";
    if (y === height) return height >= 63 ? "minecraft:grass_block[snowy=false]" : "minecraft:sand";
    if (y >= height - 3) return "minecraft:dirt";
    return "minecraft:stone";
  }
  if (y <= 62) return "minecraft:water[level=0]";
  return "minecraft:air";
}

export class SyntheticWorldSource implements BaseColumnSource {
  readonly settings = { minY: -64, height: 384, seaLevel: 63 };
  readonly palette = new BlockPalette();
  generatedColumns = 0;
  private readonly columns = new Map<string, ChunkBlocks>();

  /** `biome` is used everywhere (tests switch it to the biome that lists the feature under test). */
  constructor(
    public biome: string,
    private readonly terrainHeight: (x: number, z: number) => number = syntheticTerrainHeight,
  ) {}

  generateBaseColumn(chunkX: number, chunkZ: number): ChunkBlocks {
    const key = `${chunkX},${chunkZ}`;
    const cached = this.columns.get(key);
    if (cached) return cached;
    const column = new ChunkBlocks(chunkX, chunkZ, this.settings.minY, this.settings.height, this.palette);
    for (let y = column.minY; y <= column.maxY; y++) {
      for (let localZ = 0; localZ < 16; localZ++) {
        for (let localX = 0; localX < 16; localX++) column.setState(localX, y, localZ, syntheticBaseState(chunkX * 16 + localX, y, chunkZ * 16 + localZ, this.terrainHeight));
      }
    }
    this.generatedColumns++;
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
