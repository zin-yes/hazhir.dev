// CarvingContext and CarvingMask for one carved chunk, plus the block bookkeeping the carvers need:
// which palette ids are replaceable / grass / dirt, and which palette id each terrain symbol maps to.

import type { ChunkBlocks } from "../chunk";
import { blockNameOf } from "../chunk";
import type { FunctionContext } from "../density/density-function";
import type { CarverBaseConfig } from "./carver-config";
import type { GenerationHeights } from "./value-providers";

/** The part of Aquifer the carvers use. Returns a terrain symbol, or a negative value for null (keep the block). */
export interface CarverAquifer {
  computeSubstance(context: FunctionContext, density: number): number;
}

/** SurfaceSystem.topMaterial for a chunk: the state the surface rules would give a block, if any. */
export interface TopMaterialSource {
  topMaterial(blockX: number, blockY: number, blockZ: number, hasFluid: boolean): string | undefined;
}

export type BiomeAtBlock = (blockX: number, blockY: number, blockZ: number) => string;

const REPLACEABLE_UNKNOWN = 0;
const REPLACEABLE_YES = 1;
const REPLACEABLE_NO = 2;
const GRASS_OR_MYCELIUM = 1;
const DIRT = 2;

export interface CarvingContextParams {
  chunk: ChunkBlocks;
  aquifer: CarverAquifer;
  /** Terrain symbol -> block state, e.g. terrainSymbolStates(defaultBlock, defaultFluid). */
  symbolStates: readonly string[];
  topMaterial?: TopMaterialSource;
}

export class CarvingContext implements GenerationHeights {
  readonly chunk: ChunkBlocks;
  readonly aquifer: CarverAquifer;
  readonly minGenY: number;
  readonly genDepth: number;
  readonly chunkMinBlockX: number;
  readonly chunkMinBlockZ: number;
  /** CarvingMask: index (y - minY) * 256 + localZ * 16 + localX, the same layout as the chunk. */
  readonly mask: Uint8Array;
  readonly topMaterial: TopMaterialSource | undefined;
  /** Scratch point handed to the aquifer; it never retains the context. */
  readonly point = { blockX: 0, blockY: 0, blockZ: 0 };
  /** MutableBoolean of the column loop in WorldCarver.carveEllipsoid. */
  reachedSurface = false;

  private readonly symbolPaletteIds: number[];
  private blockFlagsById = new Uint8Array(1024);
  private readonly replaceableByConfig = new Map<CarverBaseConfig, Uint8Array>();

  constructor(params: CarvingContextParams) {
    this.chunk = params.chunk;
    this.aquifer = params.aquifer;
    this.topMaterial = params.topMaterial;
    this.minGenY = params.chunk.minY;
    this.genDepth = params.chunk.height;
    this.chunkMinBlockX = params.chunk.chunkX * 16;
    this.chunkMinBlockZ = params.chunk.chunkZ * 16;
    this.mask = new Uint8Array(256 * params.chunk.height);
    this.symbolPaletteIds = params.symbolStates.map((state) => params.chunk.palette.idOf(state));
  }

  paletteIdOfSymbol(symbol: number): number {
    return this.symbolPaletteIds[symbol]!;
  }

  /** Per-config cache: 0 unknown, 1 replaceable, 2 not, indexed by palette id (config.replaceable.has(blockName)). */
  isReplaceable(config: CarverBaseConfig, paletteId: number): boolean {
    let cache = this.replaceableByConfig.get(config);
    if (cache === undefined || paletteId >= cache.length) {
      const grown = new Uint8Array(Math.max(1024, (paletteId + 1) * 2));
      if (cache !== undefined) grown.set(cache);
      cache = grown;
      this.replaceableByConfig.set(config, cache);
    }
    let verdict = cache[paletteId]!;
    if (verdict === REPLACEABLE_UNKNOWN) {
      verdict = config.replaceable.has(blockNameOf(this.chunk.palette.stateOf(paletteId))) ? REPLACEABLE_YES : REPLACEABLE_NO;
      cache[paletteId] = verdict;
    }
    return verdict === REPLACEABLE_YES;
  }

  private blockFlags(paletteId: number): number {
    if (paletteId >= this.blockFlagsById.length) {
      const grown = new Uint8Array((paletteId + 1) * 2);
      grown.set(this.blockFlagsById);
      this.blockFlagsById = grown;
    }
    // bit 7 marks "computed" so a zero flag value is cacheable.
    let flags = this.blockFlagsById[paletteId]!;
    if ((flags & 128) === 0) {
      const name = blockNameOf(this.chunk.palette.stateOf(paletteId));
      flags = 128;
      if (name === "minecraft:grass_block" || name === "minecraft:mycelium") flags |= GRASS_OR_MYCELIUM;
      if (name === "minecraft:dirt") flags |= DIRT;
      this.blockFlagsById[paletteId] = flags;
    }
    return flags;
  }

  isGrassOrMycelium(paletteId: number): boolean {
    return (this.blockFlags(paletteId) & GRASS_OR_MYCELIUM) !== 0;
  }

  isDirt(paletteId: number): boolean {
    return (this.blockFlags(paletteId) & DIRT) !== 0;
  }
}
