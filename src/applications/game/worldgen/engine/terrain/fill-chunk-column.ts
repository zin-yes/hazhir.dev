// Mirrors NoiseBasedChunkGenerator.doFill for one chunk. Without `aquifers` the material rule list is
// Aquifer.createDisabled(fluidPicker): the default block where the final density is positive, otherwise the fluid
// picker's fluid at that y, else air. With `aquifers` it is the real list: Aquifer.NoiseBasedAquifer first, then
// OreVeinifier, and null from both means the default block.

import {
  addWorkerCounter,
  endWorkerSection,
  isWorkerProfiling,
  startWorkerSection,
} from "@/applications/game/profiler/worker-recorder";
import type { DensityNode } from "../density/density-function";
import type { NoiseRouter } from "../density/router-wiring";
import type { PositionalRandomFactory } from "../random";
import { NoiseBasedAquifer, NULL_SUBSTANCE, UNRESOLVED_SUBSTANCE } from "./aquifer";
import { NoiseChunk } from "./noise-chunk";
import { CacheAllInCell } from "./noise-chunk-caches";
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
  const isProfiling = isWorkerProfiling();

  if (isProfiling) startWorkerSection("noise.wireChunk");
  let noiseChunk: NoiseChunk;
  try {
    noiseChunk = new NoiseChunk(router, {
      cellCountXZ: 4,
      firstBlockX: chunkMinBlockX,
      firstBlockZ: chunkMinBlockZ,
      minY,
      height,
      wiredRouterFields: params.aquifers ? AQUIFER_WIRED_ROUTER_FIELDS : ["finalDensity"],
    });
  } finally {
    if (isProfiling) endWorkerSection();
  }

  let aquifer: NoiseBasedAquifer | undefined;
  let oreVeinifier: OreVeinifier | undefined;
  if (params.aquifers) {
    if (isProfiling) startWorkerSection("noise.createAquifer");
    try {
      const randoms = positionalRandomsOf(params.aquifers.rootRandomFactory);
      aquifer = createAquiferForChunk(noiseChunk, router, chunkX, chunkZ, minY, height, seaLevel, randoms.aquifer);
      if (params.aquifers.oreVeins !== false) {
        const wired = noiseChunk.router;
        oreVeinifier = new OreVeinifier(wired.veinToggle!, wired.veinRidged!, wired.veinGap!, randoms.ore);
      }
    } finally {
      if (isProfiling) endWorkerSection();
    }
  }

  if (isProfiling) startWorkerSection("noise.fillCells");
  let blocks: Uint8Array;
  try {
    blocks = interpolateColumn(noiseChunk, { aquifer, oreVeinifier, minY, height, seaLevel, chunkMinBlockX, chunkMinBlockZ, isProfiling });
  } finally {
    if (isProfiling) endWorkerSection();
  }
  if (isProfiling) {
    addWorkerCounter("columnsFilled", 1);
    addWorkerCounter("cellsInterpolated", (16 / noiseChunk.cellWidth) ** 2 * noiseChunk.cellCountY);
    addWorkerCounter("blocksFilled", height * 256);
    aquifer?.drainProfileCounters();
  }
  return { blocks, aquifer };
}

interface InterpolationSettings {
  aquifer: NoiseBasedAquifer | undefined;
  oreVeinifier: OreVeinifier | undefined;
  minY: number;
  height: number;
  seaLevel: number;
  chunkMinBlockX: number;
  chunkMinBlockZ: number;
  isProfiling: boolean;
}

/** The doFill cell loops: slices of cell corners along x, cells top-down, then every block inside the cell. */
function interpolateColumn(noiseChunk: NoiseChunk, settings: InterpolationSettings): Uint8Array {
  const { aquifer, oreVeinifier, minY, height, seaLevel, chunkMinBlockX, chunkMinBlockZ, isProfiling } = settings;
  const density = noiseChunk.finalDensityForFill;
  // doFill reads the cache_all_in_cell wrapper of the final density; its values are filled when a cell is selected.
  const cellValues = density instanceof CacheAllInCell ? density.values : undefined;
  const cellWidth = noiseChunk.cellWidth;
  const cellHeight = noiseChunk.cellHeight;
  const cellsPerChunkSide = 16 / cellWidth;
  const minCellY = Math.floor(minY / cellHeight);
  const cellCountY = Math.floor(height / cellHeight);
  const blocks = new Uint8Array(height * 256);

  if (isProfiling) startWorkerSection("noise.initializeSlice");
  noiseChunk.initializeForFirstCellX();
  if (isProfiling) endWorkerSection();
  for (let cellX = 0; cellX < cellsPerChunkSide; cellX++) {
    if (isProfiling) startWorkerSection("noise.advanceSlice");
    noiseChunk.advanceCellX(cellX);
    if (isProfiling) endWorkerSection();
    for (let cellZ = 0; cellZ < cellsPerChunkSide; cellZ++) {
      for (let cellY = cellCountY - 1; cellY >= 0; cellY--) {
        noiseChunk.selectCellYZ(cellY, cellZ);
        if (aquifer === undefined) {
          fillCellWithoutAquifer(blocks, cellValues, noiseChunk, density, cellX, cellY, cellZ, minCellY, minY, seaLevel, chunkMinBlockX, chunkMinBlockZ);
        } else {
          fillCellWithAquifer(blocks, cellValues, noiseChunk, density, aquifer, oreVeinifier, cellX, cellY, cellZ, minCellY, minY, chunkMinBlockX, chunkMinBlockZ);
        }
      }
    }
    noiseChunk.swapSlices();
  }
  noiseChunk.stopInterpolation();
  return blocks;
}

/** The aquifer-free material rule for one cell's blocks (Aquifer.createDisabled with the generator's fluid picker). */
function fillCellWithoutAquifer(
  blocks: Uint8Array,
  cellValues: Float64Array | undefined,
  noiseChunk: NoiseChunk,
  density: DensityNode,
  cellX: number,
  cellY: number,
  cellZ: number,
  minCellY: number,
  minY: number,
  seaLevel: number,
  chunkMinBlockX: number,
  chunkMinBlockZ: number,
): void {
  const cellWidth = noiseChunk.cellWidth;
  const cellHeight = noiseChunk.cellHeight;
  for (let yInCell = cellHeight - 1; yInCell >= 0; yInCell--) {
    const blockY = (minCellY + cellY) * cellHeight + yInCell;
    noiseChunk.updateForY(blockY, yInCell / cellHeight);
    const rowOffset = (blockY - minY) * 256;
    const fluid = fluidAt(blockY, seaLevel);
    const cellRowStart = (cellHeight - 1 - yInCell) * cellWidth;
    for (let xInCell = 0; xInCell < cellWidth; xInCell++) {
      const localX = cellX * cellWidth + xInCell;
      noiseChunk.updateForX(chunkMinBlockX + localX, xInCell / cellWidth);
      const cellLineStart = (cellRowStart + xInCell) * cellWidth;
      for (let zInCell = 0; zInCell < cellWidth; zInCell++) {
        const localZ = cellZ * cellWidth + zInCell;
        noiseChunk.updateForZ(chunkMinBlockZ + localZ, zInCell / cellWidth);
        const densityValue = cellValues === undefined ? density.compute(noiseChunk) : cellValues[cellLineStart + zInCell]!;
        blocks[rowOffset + localZ * 16 + localX] = densityValue > 0 ? BLOCK_DEFAULT_BLOCK : fluid;
      }
    }
  }
}

/**
 * doFill's material rules (aquifer, then ore veins, then the default block) for one cell's blocks. The chunk is only
 * positioned as a context for the blocks that evaluate density functions through it (non-uniform aquifer cells and
 * vein heights); every other block is decided from the cell values and the aquifer's cached statuses alone.
 */
function fillCellWithAquifer(
  blocks: Uint8Array,
  cellValues: Float64Array | undefined,
  noiseChunk: NoiseChunk,
  density: DensityNode,
  aquifer: NoiseBasedAquifer,
  oreVeinifier: OreVeinifier | undefined,
  cellX: number,
  cellY: number,
  cellZ: number,
  minCellY: number,
  minY: number,
  chunkMinBlockX: number,
  chunkMinBlockZ: number,
): void {
  const cellWidth = noiseChunk.cellWidth;
  const cellHeight = noiseChunk.cellHeight;
  if (cellValues !== undefined && fillUniformCell(blocks, cellValues, aquifer, oreVeinifier, cellX, cellY, cellZ, cellWidth, cellHeight, minCellY, minY, chunkMinBlockX, chunkMinBlockZ)) {
    return;
  }
  const cellMayHoldVeins = oreVeinifier !== undefined && !oreVeinifier.selectedCellCannotHoldVeins();
  for (let yInCell = cellHeight - 1; yInCell >= 0; yInCell--) {
    const blockY = (minCellY + cellY) * cellHeight + yInCell;
    const rowOffset = (blockY - minY) * 256;
    const rowMayHoldVeins = cellMayHoldVeins && oreVeinifier!.mayHoldVeinAt(blockY);
    const cellRowStart = (cellHeight - 1 - yInCell) * cellWidth;
    for (let xInCell = 0; xInCell < cellWidth; xInCell++) {
      const localX = cellX * cellWidth + xInCell;
      const blockX = chunkMinBlockX + localX;
      const cellLineStart = (cellRowStart + xInCell) * cellWidth;
      for (let zInCell = 0; zInCell < cellWidth; zInCell++) {
        const localZ = cellZ * cellWidth + zInCell;
        const blockZ = chunkMinBlockZ + localZ;
        let densityValue: number;
        if (cellValues === undefined) {
          noiseChunk.moveToBlockInCell(xInCell, yInCell, zInCell);
          densityValue = density.compute(noiseChunk);
        } else {
          densityValue = cellValues[cellLineStart + zInCell]!;
        }
        let symbol = densityValue > 0 ? NULL_SUBSTANCE : aquifer.openBlockSubstanceWithoutContext(blockX, blockY, blockZ);
        if (symbol === UNRESOLVED_SUBSTANCE) {
          noiseChunk.moveToBlockInCell(xInCell, yInCell, zInCell);
          symbol = aquifer.computeSubstanceAt(noiseChunk, densityValue, blockX, blockY, blockZ);
        }
        if (symbol === NULL_SUBSTANCE) {
          symbol = BLOCK_DEFAULT_BLOCK;
          if (rowMayHoldVeins) {
            noiseChunk.moveToBlockInCell(xInCell, yInCell, zInCell);
            const vein = oreVeinifier!.compute(noiseChunk);
            if (vein !== NO_VEIN) symbol = vein;
          }
        }
        blocks[rowOffset + localZ * 16 + localX] = symbol;
      }
    }
  }
}

/**
 * The two common cells, decided without a per-block aquifer or vein call (same symbols as the block loop): fully
 * solid cells away from vein heights are the default block, and fully open cells whose origin cells all share one
 * uniform fluid status hold that status's fluid per row (lava below the lava level). Air needs no write: the block
 * array starts as air. Returns false for every other cell.
 */
function fillUniformCell(
  blocks: Uint8Array,
  cellValues: Float64Array,
  aquifer: NoiseBasedAquifer,
  oreVeinifier: OreVeinifier | undefined,
  cellX: number,
  cellY: number,
  cellZ: number,
  cellWidth: number,
  cellHeight: number,
  minCellY: number,
  minY: number,
  chunkMinBlockX: number,
  chunkMinBlockZ: number,
): boolean {
  let positiveCount = 0;
  for (let index = 0; index < cellValues.length; index++) if (cellValues[index]! > 0) positiveCount++;
  const lowestBlockY = (minCellY + cellY) * cellHeight;
  const highestBlockY = lowestBlockY + cellHeight - 1;
  const firstLocalX = cellX * cellWidth;
  const firstLocalZ = cellZ * cellWidth;
  if (positiveCount === cellValues.length) {
    const cellMayHoldVeins =
      oreVeinifier !== undefined &&
      (oreVeinifier.mayHoldVeinAt(lowestBlockY) || oreVeinifier.mayHoldVeinAt(highestBlockY)) &&
      !oreVeinifier.selectedCellCannotHoldVeins();
    if (cellMayHoldVeins) return false;
    for (let blockY = lowestBlockY; blockY <= highestBlockY; blockY++) fillCellRow(blocks, (blockY - minY) * 256, firstLocalX, firstLocalZ, cellWidth, BLOCK_DEFAULT_BLOCK);
    return true;
  }
  if (positiveCount !== 0) return false;
  const statusIndex = aquifer.sharedUniformStatusOfBox(
    chunkMinBlockX + firstLocalX,
    chunkMinBlockX + firstLocalX + cellWidth - 1,
    lowestBlockY,
    highestBlockY,
    chunkMinBlockZ + firstLocalZ,
    chunkMinBlockZ + firstLocalZ + cellWidth - 1,
  );
  if (statusIndex === -1) return false;
  for (let blockY = lowestBlockY; blockY <= highestBlockY; blockY++) {
    const symbol = aquifer.isBelowLavaLevel(blockY) ? BLOCK_LAVA : aquifer.fluidOfStatusAt(statusIndex, blockY);
    if (symbol !== BLOCK_AIR) fillCellRow(blocks, (blockY - minY) * 256, firstLocalX, firstLocalZ, cellWidth, symbol);
  }
  return true;
}

function fillCellRow(blocks: Uint8Array, rowOffset: number, firstLocalX: number, firstLocalZ: number, cellWidth: number, symbol: number): void {
  for (let localZ = firstLocalZ; localZ < firstLocalZ + cellWidth; localZ++) {
    const lineStart = rowOffset + localZ * 16 + firstLocalX;
    blocks.fill(symbol, lineStart, lineStart + cellWidth);
  }
}
