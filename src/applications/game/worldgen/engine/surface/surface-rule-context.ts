// Mirrors SurfaceRules.Context: the per-column and per-block state the surface conditions read, with the
// lazily refreshed values the Java class keeps behind its lastUpdate stamps.

import type { BiomeAtBlock } from "./surface-types";

// Stamps come from one counter shared by every context so condition caches compiled once per seed can never
// see a stamp value that an earlier chunk's context already used.
let nextStamp = 0;

const PRELIMINARY_SURFACE_CELL_BITS = 4;
export const NO_WATER_HEIGHT = -2147483648;
const HOW_FAR_BELOW_PRELIMINARY_SURFACE_TO_BUILD = 8;

export interface SurfaceContextServices {
  readonly minY: number;
  readonly height: number;
  getSurfaceDepth(blockX: number, blockZ: number): number;
  getSurfaceSecondary(blockX: number, blockZ: number): number;
  getPreliminarySurfaceLevel(blockX: number, blockZ: number): number;
  isColdEnoughToSnow(biomeId: string, blockX: number, blockY: number, blockZ: number): boolean;
}

export interface WorldSurfaceHeightmap {
  /** Highest non-air block y plus one, or minY for an empty column (Heightmap.getHeight). */
  getHeight(localX: number, localZ: number): number;
}

export class SurfaceRuleContext {
  /**
   * Per biome condition of generated rules: 1 when one of its biomes occurs in the chunks around this one, 0 when the
   * condition can only be false here (biomeAt picks among quart cells of those chunks). Empty: every condition runs.
   */
  biomeConditionPossible: Uint8Array = new Uint8Array(0);
  lastUpdateXZ = 0;
  lastUpdateY = 0;
  blockX = 0;
  blockY = 0;
  blockZ = 0;
  surfaceDepth = 0;
  waterHeight = NO_WATER_HEIGHT;
  stoneDepthAbove = 0;
  stoneDepthBelow = 0;

  private secondaryStamp = -1;
  private secondaryValue = 0;
  private minSurfaceLevelStamp = -1;
  private minSurfaceLevelValue = 0;
  private biomeStamp = -1;
  private biomeValue = "";
  private cornerCellX = Number.NaN;
  private cornerCellZ = Number.NaN;
  private readonly cornerLevels = [0, 0, 0, 0];

  constructor(
    private readonly services: SurfaceContextServices,
    private readonly heightmap: WorldSurfaceHeightmap,
    private readonly biomeAt: BiomeAtBlock,
  ) {}

  get minGenY(): number {
    return this.services.minY;
  }

  get genDepth(): number {
    return this.services.height;
  }

  updateXZ(blockX: number, blockZ: number): void {
    this.lastUpdateXZ = ++nextStamp;
    this.lastUpdateY = ++nextStamp;
    this.blockX = blockX;
    this.blockZ = blockZ;
    this.surfaceDepth = this.services.getSurfaceDepth(blockX, blockZ);
  }

  updateY(stoneDepthAbove: number, stoneDepthBelow: number, waterHeight: number, blockX: number, blockY: number, blockZ: number): void {
    this.lastUpdateY = ++nextStamp;
    this.blockX = blockX;
    this.blockY = blockY;
    this.blockZ = blockZ;
    this.waterHeight = waterHeight;
    this.stoneDepthBelow = stoneDepthBelow;
    this.stoneDepthAbove = stoneDepthAbove;
  }

  getBiome(): string {
    if (this.biomeStamp !== this.lastUpdateY) {
      this.biomeStamp = this.lastUpdateY;
      this.biomeValue = this.biomeAt(this.blockX, this.blockY, this.blockZ);
    }
    return this.biomeValue;
  }

  isColdEnoughToSnow(): boolean {
    return this.services.isColdEnoughToSnow(this.getBiome(), this.blockX, this.blockY, this.blockZ);
  }

  getSurfaceSecondary(): number {
    if (this.secondaryStamp !== this.lastUpdateXZ) {
      this.secondaryStamp = this.lastUpdateXZ;
      this.secondaryValue = this.services.getSurfaceSecondary(this.blockX, this.blockZ);
    }
    return this.secondaryValue;
  }

  getMinSurfaceLevel(): number {
    if (this.minSurfaceLevelStamp !== this.lastUpdateXZ) {
      this.minSurfaceLevelStamp = this.lastUpdateXZ;
      const cellX = this.blockX >> PRELIMINARY_SURFACE_CELL_BITS;
      const cellZ = this.blockZ >> PRELIMINARY_SURFACE_CELL_BITS;
      if (cellX !== this.cornerCellX || cellZ !== this.cornerCellZ) {
        this.cornerCellX = cellX;
        this.cornerCellZ = cellZ;
        const blockXOfCell = cellX << PRELIMINARY_SURFACE_CELL_BITS;
        const blockZOfCell = cellZ << PRELIMINARY_SURFACE_CELL_BITS;
        const cellSize = 1 << PRELIMINARY_SURFACE_CELL_BITS;
        this.cornerLevels[0] = this.services.getPreliminarySurfaceLevel(blockXOfCell, blockZOfCell);
        this.cornerLevels[1] = this.services.getPreliminarySurfaceLevel(blockXOfCell + cellSize, blockZOfCell);
        this.cornerLevels[2] = this.services.getPreliminarySurfaceLevel(blockXOfCell, blockZOfCell + cellSize);
        this.cornerLevels[3] = this.services.getPreliminarySurfaceLevel(blockXOfCell + cellSize, blockZOfCell + cellSize);
      }
      const deltaX = Math.fround((this.blockX & 15) / 16);
      const deltaZ = Math.fround((this.blockZ & 15) / 16);
      const alongX0 = this.cornerLevels[0]! + deltaX * (this.cornerLevels[1]! - this.cornerLevels[0]!);
      const alongX1 = this.cornerLevels[2]! + deltaX * (this.cornerLevels[3]! - this.cornerLevels[2]!);
      const interpolatedLevel = Math.floor(alongX0 + deltaZ * (alongX1 - alongX0));
      this.minSurfaceLevelValue = interpolatedLevel + this.surfaceDepth - HOW_FAR_BELOW_PRELIMINARY_SURFACE_TO_BUILD;
    }
    return this.minSurfaceLevelValue;
  }

  /** SteepMaterialCondition: a 4 block drop to a neighbouring column along z, or else along x. */
  isSteep(): boolean {
    const localX = this.blockX & 15;
    const localZ = this.blockZ & 15;
    const northHeight = this.heightmap.getHeight(localX, Math.max(localZ - 1, 0));
    const southHeight = this.heightmap.getHeight(localX, Math.min(localZ + 1, 15));
    if (southHeight >= northHeight + 4) return true;
    const westHeight = this.heightmap.getHeight(Math.max(localX - 1, 0), localZ);
    const eastHeight = this.heightmap.getHeight(Math.min(localX + 1, 15), localZ);
    return westHeight >= eastHeight + 4;
  }
}
