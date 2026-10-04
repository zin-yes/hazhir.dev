// What the decoration stage needs from the base terrain pipeline (engine/pipeline's OverworldGenerator satisfies it
// structurally): undecorated chunk columns plus biome lookups, and optionally the carvers' masks.

import type { ChunkBlocks } from "../../chunk";
import type { CarvingMask, CarvingStep } from "../core/carving-mask";

export interface BaseColumnSource {
  readonly settings: { readonly minY: number; readonly height: number; readonly seaLevel: number };
  /** Terrain, surface (and later carvers) for one chunk column. Treated as read-only. All columns share one palette. */
  generateBaseColumn(chunkX: number, chunkZ: number): ChunkBlocks;
  /** The noise biome at quart resolution (ChunkAccess.getNoiseBiome). */
  rawBiomeAtQuart(quartX: number, quartY: number, quartZ: number): string;
  /** LevelReader.getBiome: BiomeManager-zoomed biome at a block. */
  biomeAt(blockX: number, blockY: number, blockZ: number): string;
  /** Optional: the distinct biomes stored in a chunk's sections (otherwise derived from rawBiomeAtQuart). */
  chunkBiomes?(chunkX: number, chunkZ: number): Iterable<string>;
  /** Optional: carving masks written by the carvers stage (ProtoChunk.getOrCreateCarvingMask). */
  carvingMask?(chunkX: number, chunkZ: number, step: CarvingStep): CarvingMask | undefined;
}

/** The biomes a chunk's sections hold: every quart cell of the column (ChunkAccess section palettes). */
export function collectChunkBiomes(source: BaseColumnSource, chunkX: number, chunkZ: number, into: Set<string>): void {
  if (source.chunkBiomes) {
    for (const biome of source.chunkBiomes(chunkX, chunkZ)) into.add(biome);
    return;
  }
  const minQuartY = source.settings.minY >> 2;
  const quartYCount = source.settings.height >> 2;
  for (let quartY = minQuartY; quartY < minQuartY + quartYCount; quartY++) {
    for (let quartZ = chunkZ * 4; quartZ < chunkZ * 4 + 4; quartZ++) {
      for (let quartX = chunkX * 4; quartX < chunkX * 4 + 4; quartX++) into.add(source.rawBiomeAtQuart(quartX, quartY, quartZ));
    }
  }
}
