// Mirrors NoiseBasedChunkGenerator.doFill for one chunk. Without `aquifers` the material rule list is
// Aquifer.createDisabled(fluidPicker): the default block where the final density is positive, otherwise the fluid
// picker's fluid at that y, else air. With `aquifers` it is the real list: Aquifer.NoiseBasedAquifer first, then
// OreVeinifier, and null from both means the default block.

import type { NoiseRouter } from "../density/router-wiring";
import type { PositionalRandomFactory } from "../random";
import { NoiseBasedAquifer, NULL_SUBSTANCE } from "./aquifer";
import { NoiseChunk } from "./noise-chunk";
import { NO_VEIN, OreVeinifier } from "./ore-veinifier";
import { getPreliminarySurfaceLevelCache } from "./preliminary-surface-level";
import { BLOCK_AIR, BLOCK_DEFAULT_BLOCK, BLOCK_DEFAULT_FLUID, BLOCK_LAVA } from "./terrain-blocks";

export {
  BLOCK_AIR,
  BLOCK_COPPER_ORE,
  BLOCK_DEEPSLATE_IRON_ORE,
  BLOCK_DEFAULT_BLOCK,
  BLOCK_DEFAULT_FLUID,
  BLOCK_GRANITE,
  BLOCK_LAVA,
  BLOCK_RAW_COPPER_BLOCK,
  BLOCK_RAW_IRON_BLOCK,
  BLOCK_TUFF,
} from "./terrain-blocks";

const LAVA_LEVEL = -54;
const CELL_COUNT_XZ = 4;
const CELL_HEIGHT = 4;

/** Router functions the aquifer and the ore veins read, wired into the chunk's caches like Java wires them all. */
const AQUIFER_WIRED_ROUTER_FIELDS = [
  "finalDensity",
  "barrier",
  "fluidLevelFloodedness",
  "fluidLevelSpread",
  "lava",
  "erosion",
  "depth",
  "veinToggle",
  "veinRidged",
  "veinGap",
] as const;

export interface AquiferFillOptions {
  /** Root factory of the seed (createRootRandomFactory); RandomState forks the aquifer and ore randoms from it. */
  rootRandomFactory: PositionalRandomFactory;
  /** noise_settings `ore_veins_enabled`, default true. */
  oreVeins?: boolean;
}

interface SeedPositionalRandoms {
  aquifer: PositionalRandomFactory;
  ore: PositionalRandomFactory;
}

const positionalRandomsByRoot = new WeakMap<PositionalRandomFactory, SeedPositionalRandoms>();

function positionalRandomsOf(rootRandomFactory: PositionalRandomFactory): SeedPositionalRandoms {
  let randoms = positionalRandomsByRoot.get(rootRandomFactory);
  if (randoms === undefined) {
    randoms = {
      aquifer: rootRandomFactory.fromHashOf("minecraft:aquifer").forkPositional(),
      ore: rootRandomFactory.fromHashOf("minecraft:ore").forkPositional(),
    };
    positionalRandomsByRoot.set(rootRandomFactory, randoms);
  }
  return randoms;
}

function createAquiferForChunk(
  noiseChunk: NoiseChunk,
  router: NoiseRouter,
  chunkX: number,
  chunkZ: number,
  minY: number,
  height: number,
  seaLevel: number,
  aquiferRandom: PositionalRandomFactory,
): NoiseBasedAquifer {
  const wired = noiseChunk.router;
  const surfaceLevels = getPreliminarySurfaceLevelCache(router, minY, height, CELL_HEIGHT);
  return new NoiseBasedAquifer({
    chunkX,
    chunkZ,
    minY,
    height,
    seaLevel,
    barrier: wired.barrier!,
    fluidLevelFloodedness: wired.fluidLevelFloodedness!,
    fluidLevelSpread: wired.fluidLevelSpread!,
    lava: wired.lava!,
    erosion: wired.erosion!,
    depth: wired.depth!,
    positionalRandomFactory: aquiferRandom,
    preliminarySurfaceLevel: (blockX, blockZ) => surfaceLevels.get(blockX, blockZ),
  });
}

export interface ChunkAquiferParams {
  router: NoiseRouter;
  chunkX: number;
  chunkZ: number;
  minY: number;
  height: number;
  seaLevel: number;
  rootRandomFactory: PositionalRandomFactory;
}

/**
 * The aquifer of a chunk outside the fill loop (what the carvers query through NoiseChunk.aquifer()). Answers match
 * the aquifer used while filling the same chunk, because every cache it keeps is deterministic.
 */
export function createChunkAquifer(params: ChunkAquiferParams): NoiseBasedAquifer {
  const { router, chunkX, chunkZ, minY, height, seaLevel, rootRandomFactory } = params;
  const noiseChunk = new NoiseChunk(router, {
    cellCountXZ: CELL_COUNT_XZ,
    firstBlockX: chunkX * 16,
    firstBlockZ: chunkZ * 16,
    minY,
    height,
    wiredRouterFields: AQUIFER_WIRED_ROUTER_FIELDS,
  });
  return createAquiferForChunk(noiseChunk, router, chunkX, chunkZ, minY, height, seaLevel, positionalRandomsOf(rootRandomFactory).aquifer);
}

export interface FillChunkColumnParams {
  router: NoiseRouter;
  chunkX: number;
  chunkZ: number;
  minY: number;
  height: number;
  seaLevel: number;
  /** Enables aquifers and ore veins. Omitted: the aquifer-disabled fluid rule, without veins. */
  aquifers?: AquiferFillOptions;
}

export interface FilledChunkColumn {
  /** Terrain symbols indexed (y - minY) * 256 + localZ * 16 + localX. */
  blocks: Uint8Array;
  /** The aquifer used for the fill, for the carvers; undefined on the aquifer-disabled path. */
  aquifer: NoiseBasedAquifer | undefined;
}

/** Aquifer.FluidStatus.at(y) for the global fluid picker: `y < level ? fluid : air`. */
function fluidAt(blockY: number, seaLevel: number): number {
  if (blockY < Math.min(LAVA_LEVEL, seaLevel)) return BLOCK_LAVA;
  return blockY < seaLevel ? BLOCK_DEFAULT_FLUID : BLOCK_AIR;
}

/** Returns block ids indexed (y - minY) * 256 + localZ * 16 + localX. */
export function fillChunkColumn(params: FillChunkColumnParams): Uint8Array {
  return fillChunkColumnDetailed(params).blocks;
}

export function fillChunkColumnDetailed(params: FillChunkColumnParams): FilledChunkColumn {
  const { router, chunkX, chunkZ, minY, height, seaLevel } = params;
  const chunkMinBlockX = chunkX * 16;
  const chunkMinBlockZ = chunkZ * 16;
  const noiseChunk = new NoiseChunk(router, {
    cellCountXZ: 4,
    firstBlockX: chunkMinBlockX,
    firstBlockZ: chunkMinBlockZ,
    minY,
    height,
    wiredRouterFields: params.aquifers ? AQUIFER_WIRED_ROUTER_FIELDS : ["finalDensity"],
  });
  let aquifer: NoiseBasedAquifer | undefined;
  let oreVeinifier: OreVeinifier | undefined;
  if (params.aquifers) {
    const randoms = positionalRandomsOf(params.aquifers.rootRandomFactory);
    aquifer = createAquiferForChunk(noiseChunk, router, chunkX, chunkZ, minY, height, seaLevel, randoms.aquifer);
    if (params.aquifers.oreVeins !== false) {
      const wired = noiseChunk.router;
      oreVeinifier = new OreVeinifier(wired.veinToggle!, wired.veinRidged!, wired.veinGap!, randoms.ore);
    }
  }
  const density = noiseChunk.finalDensityForFill;
  const cellWidth = noiseChunk.cellWidth;
  const cellHeight = noiseChunk.cellHeight;
  const cellsPerChunkSide = 16 / cellWidth;
  const minCellY = Math.floor(minY / cellHeight);
  const cellCountY = Math.floor(height / cellHeight);
  const blocks = new Uint8Array(height * 256);

  noiseChunk.initializeForFirstCellX();
  for (let cellX = 0; cellX < cellsPerChunkSide; cellX++) {
    noiseChunk.advanceCellX(cellX);
    for (let cellZ = 0; cellZ < cellsPerChunkSide; cellZ++) {
      for (let cellY = cellCountY - 1; cellY >= 0; cellY--) {
        noiseChunk.selectCellYZ(cellY, cellZ);
        for (let yInCell = cellHeight - 1; yInCell >= 0; yInCell--) {
          const blockY = (minCellY + cellY) * cellHeight + yInCell;
          noiseChunk.updateForY(blockY, yInCell / cellHeight);
          const rowOffset = (blockY - minY) * 256;
          for (let xInCell = 0; xInCell < cellWidth; xInCell++) {
            const localX = cellX * cellWidth + xInCell;
            noiseChunk.updateForX(chunkMinBlockX + localX, xInCell / cellWidth);
            for (let zInCell = 0; zInCell < cellWidth; zInCell++) {
              const localZ = cellZ * cellWidth + zInCell;
              noiseChunk.updateForZ(chunkMinBlockZ + localZ, zInCell / cellWidth);
              const densityValue = density.compute(noiseChunk);
              let symbol: number;
              if (aquifer === undefined) {
                symbol = densityValue > 0 ? BLOCK_DEFAULT_BLOCK : fluidAt(blockY, seaLevel);
              } else {
                symbol = aquifer.computeSubstance(noiseChunk, densityValue);
                if (symbol === NULL_SUBSTANCE) {
                  symbol = oreVeinifier === undefined ? NO_VEIN : oreVeinifier.compute(noiseChunk);
                  if (symbol === NO_VEIN) symbol = BLOCK_DEFAULT_BLOCK;
                }
              }
              blocks[rowOffset + localZ * 16 + localX] = symbol;
            }
          }
        }
      }
    }
    noiseChunk.swapSlices();
  }
  noiseChunk.stopInterpolation();
  return { blocks, aquifer };
}
