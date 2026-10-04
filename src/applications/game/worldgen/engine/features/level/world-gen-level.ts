// The level view features and placement modifiers see: the subset of net.minecraft.world.level.WorldGenLevel
// (WorldGenRegion) that worldgen features use, with positions as plain block coordinates.

import type { BlockStateCatalog, BlockStateInfo, BlockTagIndex, SurvivalLevel, SurvivalRules } from "../../block-state";
import type { CarvingMask, CarvingStep } from "../core/carving-mask";
import type { HeightmapType } from "../core/heightmap";

export const VOID_AIR_STATE = "minecraft:void_air";

export interface WorldGenLevel extends SurvivalLevel {
  readonly seed: bigint;
  readonly minY: number;
  readonly height: number;
  readonly seaLevel: number;
  readonly blockStates: BlockStateCatalog;
  readonly blockTags: BlockTagIndex;
  readonly survival: SurvivalRules;

  /** Profiling: setBlock calls that wrote a block so far (absent on levels that do not count). */
  readonly blockWriteCount?: number;
  /** Profiling: reports and resets the level's own traffic counters. */
  flushProfileCounters?(): void;

  /** Normalized state string; void air outside the build height. */
  getBlockState(x: number, y: number, z: number): string;
  getBlockInfo(x: number, y: number, z: number): BlockStateInfo;
  /**
   * WorldGenRegion.setBlock: false (and no change) when the position is outside the writable chunks.
   * Writes outside the build height are accepted and ignored, as ProtoChunk does. `flags` is accepted for
   * fidelity with ported code and has no effect during worldgen.
   */
  setBlock(x: number, y: number, z: number, state: string, flags?: number): boolean;
  /** WorldGenRegion.ensureCanWrite: the chunk is within the write radius of the decorated chunk. */
  ensureCanWrite(x: number, y: number, z: number): boolean;
  /** LevelReader.isEmptyBlock: the block is air (air, cave air or void air). */
  isEmptyBlock(x: number, y: number, z: number): boolean;
  isOutsideBuildHeight(y: number): boolean;
  /** WorldGenRegion.getHeight: first free y above the highest block matching the heightmap type. */
  getHeight(type: HeightmapType, x: number, z: number): number;
  /** LevelReader.getBiome: the BiomeManager (fiddled zoom) biome at a block position. */
  getBiome(x: number, y: number, z: number): string;
  /** ProtoChunk.getOrCreateCarvingMask; an empty mask when the carvers stage provided none. */
  getCarvingMask(chunkX: number, chunkZ: number, step: CarvingStep): CarvingMask;
}
