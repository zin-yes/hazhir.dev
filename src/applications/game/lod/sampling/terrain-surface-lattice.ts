// Terrain surface heights the way the noise fill builds them. Minecraft evaluates the final density only at the
// corners of 4 x 4 x 4 cells and interpolates trilinearly in between, so the surface is found on that lattice:
// per lattice column, a guided search for the cell where the density turns from solid (> 0) to air, then the exact
// top block from the linear interpolation inside that cell. Off-lattice columns (fine LOD levels) interpolate the four
// surrounding lattice columns like the noise fill does. All coordinates are Minecraft blocks.

import type { ColumnDensity } from "./column-cached-density";

const LATTICE_SPACING = 4;
const MINECRAFT_MIN_Y = -64;
const MINECRAFT_TOP_Y = 320;
const LOWEST_LEVEL = MINECRAFT_MIN_Y / LATTICE_SPACING;
const HIGHEST_LEVEL = MINECRAFT_TOP_Y / LATTICE_SPACING;
const LEVEL_COUNT = HIGHEST_LEVEL - LOWEST_LEVEL + 1;
const COLUMN_KEY_STRIDE = 2 ** 24;
const COLUMN_KEY_OFFSET = 2 ** 23;
/** Crossing level of a column that is solid all the way up. */
const SOLID_TO_THE_TOP = HIGHEST_LEVEL;
const MAX_UPWARD_STRIDE = 4;
/** Levels above a found crossing that must be air for it to count as the surface (12, 24 and 48 blocks up). */
const SKY_PROBE_OFFSETS = [3, 6, 12];
const MAXIMUM_SKY_PROBE_ROUNDS = 4;

interface LatticeColumn {
  readonly blockX: number;
  readonly blockZ: number;
  /** Densities at y = level * 4, NaN until evaluated. Index level - LOWEST_LEVEL. */
  readonly densities: Float64Array;
  /** Highest level found solid with air right above it; LOWEST_LEVEL - 1 when the column is air to the bottom. */
  crossingLevel: number;
}

function floorDivide(value: number, divisor: number): number {
  return Math.floor(value / divisor);
}

export class TerrainSurfaceLattice {
  private readonly columns = new Map<number, LatticeColumn>();

  constructor(private readonly density: ColumnDensity) {}

  /** Forget the columns of the previous tile. */
  reset(): void {
    this.columns.clear();
  }

  get columnCount(): number {
    return this.columns.size;
  }

  private columnAt(blockX: number, blockZ: number): LatticeColumn {
    const key = (blockX / LATTICE_SPACING + COLUMN_KEY_OFFSET) * COLUMN_KEY_STRIDE + (blockZ / LATTICE_SPACING + COLUMN_KEY_OFFSET);
    let column = this.columns.get(key);
    if (column === undefined) {
      column = { blockX, blockZ, densities: new Float64Array(LEVEL_COUNT).fill(Number.NaN), crossingLevel: Number.NaN };
      this.columns.set(key, column);
    }
    return column;
  }

  private densityAtLevel(column: LatticeColumn, level: number): number {
    if (level > HIGHEST_LEVEL) return -1;
    if (level < LOWEST_LEVEL) return 1;
    const index = level - LOWEST_LEVEL;
    let value = column.densities[index]!;
    if (Number.isNaN(value)) {
      value = this.density.at(column.blockX, level * LATTICE_SPACING, column.blockZ);
      column.densities[index] = value;
    }
    return value;
  }

  private isSolidAtLevel(column: LatticeColumn, level: number): boolean {
    return this.densityAtLevel(column, level) > 0;
  }

  /**
   * Climbs from a solid level with strides of up to MAX_UPWARD_STRIDE levels until it reaches air, then walks back
   * down to the highest solid level below that air.
   */
  private climbToCrossing(column: LatticeColumn, solidStartLevel: number): number {
    let solidLevel = solidStartLevel;
    let stride = 1;
    let airLevel = solidStartLevel + 1;
    while (airLevel <= HIGHEST_LEVEL && this.isSolidAtLevel(column, airLevel)) {
      solidLevel = airLevel;
      stride = Math.min(MAX_UPWARD_STRIDE, stride * 2);
      airLevel = Math.min(HIGHEST_LEVEL + 1, airLevel + stride);
    }
    if (airLevel > HIGHEST_LEVEL) return SOLID_TO_THE_TOP;
    let level = airLevel - 1;
    while (level > solidLevel && !this.isSolidAtLevel(column, level)) level--;
    return level;
  }

  /**
   * Finds the solid-to-air crossing of a lattice column near `guessY`. Above a solid guess it climbs; below an air
   * guess it descends one level at a time, because the shell above a cave can be a single level thick and a larger
   * stride would fall through it into the cave. Either way the crossing may be a cave ceiling or an overhang floor,
   * so the open sky above it is probed at a few heights and the climb resumes from any rock found there.
   */
  private resolveCrossing(column: LatticeColumn, guessY: number): void {
    if (!Number.isNaN(column.crossingLevel)) return;
    const guessLevel = Math.max(LOWEST_LEVEL, Math.min(HIGHEST_LEVEL, floorDivide(guessY, LATTICE_SPACING)));
    let crossingLevel: number;
    if (this.isSolidAtLevel(column, guessLevel)) {
      crossingLevel = this.climbToCrossing(column, guessLevel);
    } else {
      crossingLevel = guessLevel - 1;
      while (crossingLevel >= LOWEST_LEVEL && !this.isSolidAtLevel(column, crossingLevel)) crossingLevel--;
    }
    for (let attempt = 0; attempt < MAXIMUM_SKY_PROBE_ROUNDS && crossingLevel < SOLID_TO_THE_TOP; attempt++) {
      const rockAbove = SKY_PROBE_OFFSETS.map((offset) => crossingLevel + offset).find(
        (level) => level <= HIGHEST_LEVEL && this.isSolidAtLevel(column, level),
      );
      if (rockAbove === undefined) break;
      crossingLevel = this.climbToCrossing(column, rockAbove);
    }
    column.crossingLevel = crossingLevel;
  }

  /** Searches the crossing of the lattice column at (blockX, blockZ), both multiples of 4. */
  prepareLatticeColumn(blockX: number, blockZ: number, guessY: number): void {
    this.resolveCrossing(this.columnAt(blockX, blockZ), guessY);
  }

  /** Crossing-derived surface of an already prepared lattice column, as a top-face y. */
  latticeColumnTopY(blockX: number, blockZ: number): number {
    const column = this.columnAt(blockX, blockZ);
    if (Number.isNaN(column.crossingLevel)) throw new Error(`Lattice column ${blockX},${blockZ} was not prepared`);
    return this.topFaceInCell(
      column.crossingLevel,
      (level) => this.densityAtLevel(column, level),
    );
  }

  /** Highest y in the crossing cell where the linear interpolation is still solid, plus one. */
  private topFaceInCell(crossingLevel: number, densityAt: (level: number) => number): number {
    if (crossingLevel < LOWEST_LEVEL) return MINECRAFT_MIN_Y;
    if (crossingLevel >= HIGHEST_LEVEL) return MINECRAFT_TOP_Y;
    const lowerDensity = densityAt(crossingLevel);
    const upperDensity = densityAt(crossingLevel + 1);
    const solidFraction = lowerDensity / (lowerDensity - upperDensity);
    const solidBlocksInCell = Math.max(1, Math.min(LATTICE_SPACING, Math.ceil(solidFraction * LATTICE_SPACING)));
    return crossingLevel * LATTICE_SPACING + solidBlocksInCell;
  }

  /**
   * Surface top-face y of any block column. The four lattice columns around it must have been prepared; their
   * densities are interpolated bilinearly per lattice level, the crossing is searched between the lowest and highest
   * corner crossings, and the top block comes from the vertical interpolation inside the crossing cell.
   */
  topYAtBlock(blockX: number, blockZ: number): number {
    const westX = floorDivide(blockX, LATTICE_SPACING) * LATTICE_SPACING;
    const northZ = floorDivide(blockZ, LATTICE_SPACING) * LATTICE_SPACING;
    const fractionX = (blockX - westX) / LATTICE_SPACING;
    const fractionZ = (blockZ - northZ) / LATTICE_SPACING;
    if (fractionX === 0 && fractionZ === 0) return this.latticeColumnTopY(blockX, blockZ);
    const corners = [
      this.columnAt(westX, northZ),
      this.columnAt(westX + LATTICE_SPACING, northZ),
      this.columnAt(westX, northZ + LATTICE_SPACING),
      this.columnAt(westX + LATTICE_SPACING, northZ + LATTICE_SPACING),
    ] as const;
    const weights = [
      (1 - fractionX) * (1 - fractionZ),
      fractionX * (1 - fractionZ),
      (1 - fractionX) * fractionZ,
      fractionX * fractionZ,
    ] as const;
    let highestCrossing = -Infinity;
    for (const corner of corners) {
      if (Number.isNaN(corner.crossingLevel)) throw new Error(`Lattice column ${corner.blockX},${corner.blockZ} was not prepared`);
      highestCrossing = Math.max(highestCrossing, corner.crossingLevel);
    }
    const interpolatedDensityAt = (level: number): number => {
      let value = 0;
      for (let cornerIndex = 0; cornerIndex < 4; cornerIndex++) {
        if (weights[cornerIndex] === 0) continue;
        value += weights[cornerIndex]! * this.densityAtLevel(corners[cornerIndex]!, level);
      }
      return value;
    };
    let level = highestCrossing + 1;
    while (level <= HIGHEST_LEVEL && interpolatedDensityAt(level) > 0) level++;
    level--;
    while (level >= LOWEST_LEVEL && !(interpolatedDensityAt(level) > 0)) level--;
    return this.topFaceInCell(level, interpolatedDensityAt);
  }
}

export const LATTICE_CELL_BLOCKS = LATTICE_SPACING;
