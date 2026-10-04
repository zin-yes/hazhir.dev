// Which chunk columns the real renderer is drawing. A column hides the LOD once every chunk holding its surface (the
// chunk y range of its trusted real surface) is meshed, and shows it again as soon as one of them unloads. Tiles
// entirely under covered columns are not drawn at all; partly covered tiles discard the covered part in the shader
// through a toroidal coverage texture centred on the camera (see writeCoverageTexels).

import { CHUNK_SIZE_BLOCKS } from "../core/lod-constants";
import { tileBoundsOf, type TileAddress } from "../core/tile-address";

interface ColumnState {
  readonly meshedChunkYs: Set<number>;
  lowestSurfaceChunkY: number | undefined;
  highestSurfaceChunkY: number | undefined;
}

const COLUMN_KEY_STRIDE = 2 ** 26;
const COLUMN_KEY_OFFSET = 2 ** 25;

function columnKeyOf(chunkX: number, chunkZ: number): number {
  return (chunkX + COLUMN_KEY_OFFSET) * COLUMN_KEY_STRIDE + (chunkZ + COLUMN_KEY_OFFSET);
}

export class RealChunkCoverage {
  private readonly columns = new Map<number, ColumnState>();
  private readonly coveredColumns = new Map<number, { chunkX: number; chunkZ: number }>();
  /** Increases whenever the covered set changes. */
  version = 0;

  private stateOf(chunkX: number, chunkZ: number): ColumnState {
    const key = columnKeyOf(chunkX, chunkZ);
    let state = this.columns.get(key);
    if (state === undefined) {
      state = { meshedChunkYs: new Set(), lowestSurfaceChunkY: undefined, highestSurfaceChunkY: undefined };
      this.columns.set(key, state);
    }
    return state;
  }

  private refresh(chunkX: number, chunkZ: number, state: ColumnState): void {
    const key = columnKeyOf(chunkX, chunkZ);
    let isCovered = state.lowestSurfaceChunkY !== undefined && state.highestSurfaceChunkY !== undefined;
    if (isCovered) {
      for (let chunkY = state.lowestSurfaceChunkY!; chunkY <= state.highestSurfaceChunkY!; chunkY++) {
        if (!state.meshedChunkYs.has(chunkY)) {
          isCovered = false;
          break;
        }
      }
    }
    const wasCovered = this.coveredColumns.has(key);
    if (isCovered && !wasCovered) this.coveredColumns.set(key, { chunkX, chunkZ });
    if (!isCovered && wasCovered) this.coveredColumns.delete(key);
    if (isCovered !== wasCovered) this.version++;
    if (state.meshedChunkYs.size === 0 && state.lowestSurfaceChunkY === undefined) this.columns.delete(key);
  }

  /** The chunk y range holding the column's trusted real surface (undefined while unknown). */
  setSurfaceChunkRange(chunkX: number, chunkZ: number, lowestChunkY: number | undefined, highestChunkY: number | undefined): void {
    const state = this.stateOf(chunkX, chunkZ);
    state.lowestSurfaceChunkY = lowestChunkY;
    state.highestSurfaceChunkY = highestChunkY;
    this.refresh(chunkX, chunkZ, state);
  }

  markMeshed(chunkX: number, chunkY: number, chunkZ: number): void {
    const state = this.stateOf(chunkX, chunkZ);
    state.meshedChunkYs.add(chunkY);
    this.refresh(chunkX, chunkZ, state);
  }

  markUnloaded(chunkX: number, chunkY: number, chunkZ: number): void {
    const state = this.columns.get(columnKeyOf(chunkX, chunkZ));
    if (state === undefined) return;
    state.meshedChunkYs.delete(chunkY);
    this.refresh(chunkX, chunkZ, state);
  }

  /** Forgets the surface range of a column whose real data was dropped. */
  forgetColumn(chunkX: number, chunkZ: number): void {
    this.setSurfaceChunkRange(chunkX, chunkZ, undefined, undefined);
  }

  isColumnCovered(chunkX: number, chunkZ: number): boolean {
    return this.coveredColumns.has(columnKeyOf(chunkX, chunkZ));
  }

  get coveredColumnCount(): number {
    return this.coveredColumns.size;
  }

  forEachCoveredColumn(visit: (chunkX: number, chunkZ: number) => void): void {
    for (const column of this.coveredColumns.values()) visit(column.chunkX, column.chunkZ);
  }

  private tileChunkRange(address: TileAddress) {
    const bounds = tileBoundsOf(address);
    return {
      firstChunkX: bounds.minX / CHUNK_SIZE_BLOCKS,
      firstChunkZ: bounds.minZ / CHUNK_SIZE_BLOCKS,
      chunksPerSide: (bounds.maxX - bounds.minX) / CHUNK_SIZE_BLOCKS,
    };
  }

  isTileFullyCovered(address: TileAddress): boolean {
    const { firstChunkX, firstChunkZ, chunksPerSide } = this.tileChunkRange(address);
    if (chunksPerSide * chunksPerSide > this.coveredColumns.size) return false;
    for (let offsetZ = 0; offsetZ < chunksPerSide; offsetZ++) {
      for (let offsetX = 0; offsetX < chunksPerSide; offsetX++) {
        if (!this.isColumnCovered(firstChunkX + offsetX, firstChunkZ + offsetZ)) return false;
      }
    }
    return true;
  }

  isTilePartiallyCovered(address: TileAddress): boolean {
    const { firstChunkX, firstChunkZ, chunksPerSide } = this.tileChunkRange(address);
    for (const column of this.coveredColumns.values()) {
      if (
        column.chunkX >= firstChunkX &&
        column.chunkX < firstChunkX + chunksPerSide &&
        column.chunkZ >= firstChunkZ &&
        column.chunkZ < firstChunkZ + chunksPerSide
      ) {
        return true;
      }
    }
    return false;
  }
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/**
 * Fills a size x size R8 texture: texel (chunkX mod size, chunkZ mod size) is 255 for covered columns within half the
 * size of the centre column. The shader only consults it for fragments within that window, so wrapping never aliases.
 */
export function writeCoverageTexels(coverage: RealChunkCoverage, centerChunkX: number, centerChunkZ: number, size: number, texels: Uint8Array): void {
  texels.fill(0);
  const halfSize = size / 2;
  coverage.forEachCoveredColumn((chunkX, chunkZ) => {
    if (Math.abs(chunkX - centerChunkX) >= halfSize || Math.abs(chunkZ - centerChunkZ) >= halfSize) return;
    texels[positiveModulo(chunkX, size) + positiveModulo(chunkZ, size) * size] = 255;
  });
}

/** Distance a fragment is moved against its face normal before the coverage lookup, so walls on a column border
 * belong to the cell they rise from. Mirrored in the LOD fragment shader. */
export const COVERAGE_NORMAL_NUDGE_BLOCKS = 0.25;

/** CPU mirror of the shader's discard test, for tests and for picking. */
export function isFragmentHiddenByCoverage(
  texels: Uint8Array,
  size: number,
  centerChunkX: number,
  centerChunkZ: number,
  worldX: number,
  worldZ: number,
  normalX: number,
  normalZ: number,
): boolean {
  const chunkX = Math.floor((worldX - normalX * COVERAGE_NORMAL_NUDGE_BLOCKS) / CHUNK_SIZE_BLOCKS);
  const chunkZ = Math.floor((worldZ - normalZ * COVERAGE_NORMAL_NUDGE_BLOCKS) / CHUNK_SIZE_BLOCKS);
  if (Math.abs(chunkX - centerChunkX) >= size / 2 || Math.abs(chunkZ - centerChunkZ) >= size / 2) return false;
  return texels[positiveModulo(chunkX, size) + positiveModulo(chunkZ, size) * size]! > 127;
}
