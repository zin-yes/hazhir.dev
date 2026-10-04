// A pipeline stage mutates one 16x16 full-height column in place. Stages run in list order; the default list is
// the vanilla order NoiseBasedChunkGenerator uses for the base terrain: fill noise (with aquifers and ore veins), then buildSurface (biomes are
// resolved lazily through context.rawBiomeAtQuart / context.biomeAt), then the carvers. Features splice into
// this list later (see OverworldGenerator.stages).

import type { CarverAquifer } from "../carvers";
import type { ChunkBlocks } from "../chunk";
import type { NoiseRouter } from "../density";
import type { WorldgenRegistries } from "../registry/datapack-loader";
import type { OverworldSettings } from "./noise-settings-reader";

export interface ColumnStageContext {
  readonly chunkX: number;
  readonly chunkZ: number;
  readonly seed: bigint;
  readonly settings: OverworldSettings;
  readonly registries: WorldgenRegistries;
  /** The seeded, uncached noise router (stages wire their own NoiseChunk caches from it). */
  readonly router: NoiseRouter;
  /** Set by the noise fill stage when aquifers are enabled, so the carver stage reuses the fill's aquifer for this column. */
  aquifer?: CarverAquifer;
  /** Set by the carvers stage: the air carving mask of this column (layout of ChunkBlocks, 1 = carved). */
  carvingMask?: Uint8Array;
  rawBiomeAtQuart(quartX: number, quartY: number, quartZ: number): string;
  biomeAt(blockX: number, blockY: number, blockZ: number): string;
}

export interface ColumnStage {
  readonly name: string;
  run(column: ChunkBlocks, context: ColumnStageContext): void;
}
