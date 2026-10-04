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
    const blocks = this.chunk.blocks;
    const minY = this.chunk.minY;
    for (let y = startY, index = (startY - minY) * 256 + localZ * 16 + localX; y >= minY; y--, index -= 256) {
      const blockId = blocks[index]!;
      // Palette id 0 is always minecraft:air.
      if (blockId !== 0 && !this.isAirId(blockId)) return y;
    }
    return minY - 1;
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
