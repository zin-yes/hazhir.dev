// Mirrors Heightmap.Types.WORLD_SURFACE_WG for one chunk: per column, the highest non-air block y plus one.
// Kept in sync while the surface stage rewrites blocks (ProtoChunk.setBlockState updates it too).

import type { ChunkBlocks } from "../chunk";
import type { WorldSurfaceHeightmap } from "./surface-rule-context";

export class ChunkWorldSurfaceHeightmap implements WorldSurfaceHeightmap {
  private readonly heights = new Int32Array(256);

  constructor(
    private readonly chunk: ChunkBlocks,
    private readonly isAirId: (blockId: number) => boolean,
  ) {
    for (let localZ = 0; localZ < 16; localZ++) {
      for (let localX = 0; localX < 16; localX++) {
        this.heights[localZ * 16 + localX] = this.scanDownFrom(localX, localZ, chunk.maxY) + 1;
      }
    }
  }

  private scanDownFrom(localX: number, localZ: number, startY: number): number {
    for (let y = startY; y >= this.chunk.minY; y--) {
      if (!this.isAirId(this.chunk.getId(localX, y, localZ))) return y;
    }
    return this.chunk.minY - 1;
  }

  getHeight(localX: number, localZ: number): number {
    return this.heights[localZ * 16 + localX]!;
  }

  /** Heightmap.update, called after the block at (localX, y, localZ) changed to a block with the given airness. */
  onBlockChanged(localX: number, y: number, localZ: number, isNowAir: boolean): void {
    const columnIndex = localZ * 16 + localX;
    const currentHeight = this.heights[columnIndex]!;
    if (y <= currentHeight - 2) return;
    if (!isNowAir) {
      if (y >= currentHeight) this.heights[columnIndex] = y + 1;
    } else if (currentHeight - 1 === y) {
      this.heights[columnIndex] = this.scanDownFrom(localX, localZ, y - 1) + 1;
    }
  }
}
