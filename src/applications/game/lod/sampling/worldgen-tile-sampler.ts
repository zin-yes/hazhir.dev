// Samples one LOD tile surface straight from the world generator's noise: exact noise-fill heights on the 4-block
// density lattice, the climate biome at the surface and the surface rules for the top block. Cells covered by real
// chunk data are taken from the overlay and never sampled. A coarser tile of the same area (the hint) seeds every
// height search, which is what makes refining a tile cheaper than sampling it cold.

import { addWorkerCounter, endWorkerSection, isWorkerProfiling, startWorkerSection } from "../../profiler/worker-recorder";
import { GAME_Y_OFFSET } from "../../worldgen/constants";
import { cellSizeOfLevel, NO_WATER, TILE_CELLS, tileSizeOfLevel } from "../core/lod-constants";
import type { TileAddress } from "../core/tile-address";
import { cellIndexOf, createTileSurface, type TileSurface } from "../data/tile-surface";
import type { SeedWorldgenContext } from "./seed-worldgen-context";
import { SurfaceMaterialSampler } from "./surface-material-sampler";
import { LATTICE_CELL_BLOCKS, TerrainSurfaceLattice } from "./terrain-surface-lattice";

export interface TileSamplingHint {
  readonly address: TileAddress;
  readonly surface: TileSurface;
}

export interface RealSurfaceOverlay {
  readonly surface: TileSurface;
  /** 1 for cells whose values come from real chunk data. */
  readonly coveredCells: Uint8Array;
}

export interface TileSamplingStatistics {
  sampledCells: number;
  overlayCells: number;
  latticeColumns: number;
  densityEvaluations: number;
  biomeLookups: number;
  ruleEvaluations: number;
}

export interface SampledTile {
  surface: TileSurface;
  statistics: TileSamplingStatistics;
}

/**
 * Searches start this far above the guessed surface: descending from air finds the topmost surface, while climbing
 * out of rock can stop under the roof of a cave.
 */
const GUESS_HEADROOM_BLOCKS = 8;
const QUART_KEY_STRIDE = 2 ** 24;
const QUART_KEY_OFFSET = 2 ** 23;

function sampleOffsetWithinCell(cellSize: number): number {
  return Math.floor(cellSize / 2);
}

function profiledSection<Result>(isProfiling: boolean, name: string, work: () => Result): Result {
  if (!isProfiling) return work();
  startWorkerSection(name);
  try {
    return work();
  } finally {
    endWorkerSection();
  }
}

export class WorldgenTileSampler {
  private readonly lattice: TerrainSurfaceLattice;
  private readonly materials: SurfaceMaterialSampler;

  constructor(private readonly context: SeedWorldgenContext) {
    this.lattice = new TerrainSurfaceLattice(context.density);
    this.materials = new SurfaceMaterialSampler(context);
  }

  sample(address: TileAddress, hint?: TileSamplingHint, overlay?: RealSurfaceOverlay): SampledTile {
    const isProfiling = isWorkerProfiling();
    const evaluationsBefore = this.context.density.evaluations;
    const ruleEvaluationsBefore = this.materials.ruleEvaluations;
    const cellSize = cellSizeOfLevel(address.level);
    const originX = address.tileX * tileSizeOfLevel(address.level);
    const originZ = address.tileZ * tileSizeOfLevel(address.level);
    const sampleOffset = sampleOffsetWithinCell(cellSize);
    const sampleXOf = (cellX: number) => originX + cellX * cellSize + sampleOffset;
    const sampleZOf = (cellZ: number) => originZ + cellZ * cellSize + sampleOffset;
    const surface = createTileSurface();
    const minecraftTopY = new Int16Array(TILE_CELLS * TILE_CELLS);
    const needsSampling = new Uint8Array(TILE_CELLS * TILE_CELLS);
    let sampledCells = 0;
    for (let index = 0; index < needsSampling.length; index++) {
      const covered = overlay !== undefined && overlay.coveredCells[index] === 1;
      needsSampling[index] = covered ? 0 : 1;
      if (!covered) sampledCells++;
    }

    const guessFromHint = (blockX: number, blockZ: number): number | undefined => {
      if (hint === undefined) return undefined;
      const hintCellSize = cellSizeOfLevel(hint.address.level);
      const hintOriginX = hint.address.tileX * tileSizeOfLevel(hint.address.level);
      const hintOriginZ = hint.address.tileZ * tileSizeOfLevel(hint.address.level);
      const hintCellX = Math.floor((blockX - hintOriginX) / hintCellSize);
      const hintCellZ = Math.floor((blockZ - hintOriginZ) / hintCellSize);
      if (hintCellX < 0 || hintCellZ < 0 || hintCellX >= TILE_CELLS || hintCellZ >= TILE_CELLS) return undefined;
      return hint.surface.heights[cellIndexOf(hintCellX, hintCellZ)]! - GAME_Y_OFFSET;
    };

    const biomeByQuart = new Map<number, string>();
    let biomeLookups = 0;
    const quartKeyOf = (blockX: number, blockZ: number) => ((blockX >> 2) + QUART_KEY_OFFSET) * QUART_KEY_STRIDE + ((blockZ >> 2) + QUART_KEY_OFFSET);

    this.lattice.reset();
    let previousGuessY = this.context.settings.seaLevel;
    // Each lattice column is the origin of one quart column, so its biome is looked up right after its height search,
    // while the column memos of the climate functions still hold this column.
    const prepareLatticeColumn = (blockX: number, blockZ: number) => {
      const quartKey = quartKeyOf(blockX, blockZ);
      if (biomeByQuart.has(quartKey)) return;
      const guessY = (guessFromHint(blockX, blockZ) ?? previousGuessY) + GUESS_HEADROOM_BLOCKS;
      this.lattice.prepareLatticeColumn(blockX, blockZ, guessY);
      const topY = this.lattice.latticeColumnTopY(blockX, blockZ);
      previousGuessY = topY;
      biomeLookups++;
      biomeByQuart.set(quartKey, this.context.biomeSource.findBiome(this.context.climateSampler.sample(blockX >> 2, (topY - 1) >> 2, blockZ >> 2)));
    };

    profiledSection(isProfiling, "lod.sample.heights", () => {
      const isOnLattice = cellSize >= 2 * LATTICE_CELL_BLOCKS;
      for (let cellZ = 0; cellZ < TILE_CELLS; cellZ++) {
        for (let cellX = 0; cellX < TILE_CELLS; cellX++) {
          if (needsSampling[cellIndexOf(cellX, cellZ)] === 0) continue;
          const blockX = sampleXOf(cellX);
          const blockZ = sampleZOf(cellZ);
          if (isOnLattice) {
            prepareLatticeColumn(blockX, blockZ);
            continue;
          }
          const westX = Math.floor(blockX / LATTICE_CELL_BLOCKS) * LATTICE_CELL_BLOCKS;
          const northZ = Math.floor(blockZ / LATTICE_CELL_BLOCKS) * LATTICE_CELL_BLOCKS;
          prepareLatticeColumn(westX, northZ);
          prepareLatticeColumn(westX + LATTICE_CELL_BLOCKS, northZ);
          prepareLatticeColumn(westX, northZ + LATTICE_CELL_BLOCKS);
          prepareLatticeColumn(westX + LATTICE_CELL_BLOCKS, northZ + LATTICE_CELL_BLOCKS);
        }
      }
      for (let cellZ = 0; cellZ < TILE_CELLS; cellZ++) {
        for (let cellX = 0; cellX < TILE_CELLS; cellX++) {
          const index = cellIndexOf(cellX, cellZ);
          if (needsSampling[index] === 0) {
            minecraftTopY[index] = overlay!.surface.heights[index]! - GAME_Y_OFFSET;
            continue;
          }
          minecraftTopY[index] = this.lattice.topYAtBlock(sampleXOf(cellX), sampleZOf(cellZ));
        }
      }
    });

    const biomeAt = (blockX: number, blockZ: number): string => {
      const biome = biomeByQuart.get(quartKeyOf(blockX, blockZ));
      if (biome === undefined) throw new Error(`No biome for quart of ${blockX},${blockZ}`);
      return biome;
    };

    profiledSection(isProfiling, "lod.sample.materials", () => {
      const heightAt = (cellX: number, cellZ: number) =>
        minecraftTopY[cellIndexOf(Math.max(0, Math.min(TILE_CELLS - 1, cellX)), Math.max(0, Math.min(TILE_CELLS - 1, cellZ)))]!;
      for (let cellZ = 0; cellZ < TILE_CELLS; cellZ++) {
        for (let cellX = 0; cellX < TILE_CELLS; cellX++) {
          const index = cellIndexOf(cellX, cellZ);
          if (needsSampling[index] === 0) {
            surface.heights[index] = overlay!.surface.heights[index]!;
            surface.topBlocks[index] = overlay!.surface.topBlocks[index]!;
            surface.sideBlocks[index] = overlay!.surface.sideBlocks[index]!;
            surface.waterLevels[index] = overlay!.surface.waterLevels[index]!;
            continue;
          }
          const blockX = sampleXOf(cellX);
          const blockZ = sampleZOf(cellZ);
          const topY = minecraftTopY[index]!;
          const spanX = (Math.min(TILE_CELLS - 1, cellX + 1) - Math.max(0, cellX - 1)) * cellSize;
          const spanZ = (Math.min(TILE_CELLS - 1, cellZ + 1) - Math.max(0, cellZ - 1)) * cellSize;
          const slopeX = (heightAt(cellX + 1, cellZ) - heightAt(cellX - 1, cellZ)) / spanX;
          const slopeZ = (heightAt(cellX, cellZ + 1) - heightAt(cellX, cellZ - 1)) / spanZ;
          const material = this.materials.sample(blockX, blockZ, topY, slopeX, slopeZ, biomeAt(blockX, blockZ));
          const isFrozenSea = material.waterSurfaceY === undefined && topY < this.context.settings.seaLevel;
          surface.heights[index] = (isFrozenSea ? this.context.settings.seaLevel : topY) + GAME_Y_OFFSET;
          surface.topBlocks[index] = material.topBlock;
          surface.sideBlocks[index] = material.sideBlock;
          surface.waterLevels[index] = material.waterSurfaceY === undefined ? NO_WATER : material.waterSurfaceY + GAME_Y_OFFSET;
        }
      }
    });

    const statistics: TileSamplingStatistics = {
      sampledCells,
      overlayCells: TILE_CELLS * TILE_CELLS - sampledCells,
      latticeColumns: this.lattice.columnCount,
      densityEvaluations: this.context.density.evaluations - evaluationsBefore,
      biomeLookups,
      ruleEvaluations: this.materials.ruleEvaluations - ruleEvaluationsBefore,
    };
    if (isProfiling) {
      addWorkerCounter("lodCellsSampled", statistics.sampledCells);
      addWorkerCounter("lodOverlayCells", statistics.overlayCells);
      addWorkerCounter("lodLatticeColumns", statistics.latticeColumns);
      addWorkerCounter("lodDensityEvaluations", statistics.densityEvaluations);
      addWorkerCounter("lodBiomeLookups", statistics.biomeLookups);
      addWorkerCounter("lodSurfaceRuleEvaluations", statistics.ruleEvaluations);
    }
    return { surface, statistics };
  }
}
