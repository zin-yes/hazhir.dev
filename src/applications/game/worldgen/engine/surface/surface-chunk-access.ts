// Block reads and writes for one chunk during the surface stage (the BlockColumn of SurfaceSystem.buildSurface):
// out-of-range reads are air, out-of-range writes are dropped, and writes keep the world surface heightmap current.

import { blockNameOf, type ChunkBlocks } from "../chunk";
import { ChunkWorldSurfaceHeightmap } from "./world-surface-heightmap";

export const BLOCK_KIND_UNKNOWN = 0;
export const BLOCK_KIND_AIR = 1;
export const BLOCK_KIND_FLUID = 2;
export const BLOCK_KIND_SOLID = 3;
export type BlockKind = 0 | 1 | 2 | 3;

export class SurfaceChunkAccess {
  readonly heightmap: ChunkWorldSurfaceHeightmap;
  private readonly kindsById: BlockKind[] = [];
  private readonly namesById: string[] = [];

  constructor(readonly chunk: ChunkBlocks) {
    this.heightmap = new ChunkWorldSurfaceHeightmap(chunk, (blockId) => this.kindOf(blockId) === BLOCK_KIND_AIR);
  }

  get minY(): number {
    return this.chunk.minY;
  }

  nameOf(blockId: number): string {
    let name = this.namesById[blockId];
    if (name === undefined) {
      name = blockNameOf(this.chunk.palette.stateOf(blockId));
      this.namesById[blockId] = name;
    }
    return name;
  }

  /** Air, fluid or solid, where "solid" means any block that is neither air nor a fluid (SurfaceSystem.isStone). */
  kindOf(blockId: number): BlockKind {
    let kind = this.kindsById[blockId] ?? BLOCK_KIND_UNKNOWN;
    if (kind === BLOCK_KIND_UNKNOWN) {
      const name = this.nameOf(blockId);
      if (name === "minecraft:air" || name === "minecraft:cave_air" || name === "minecraft:void_air") kind = BLOCK_KIND_AIR;
      else if (name === "minecraft:water" || name === "minecraft:lava") kind = BLOCK_KIND_FLUID;
      else kind = BLOCK_KIND_SOLID;
      this.kindsById[blockId] = kind;
    }
    return kind;
  }

  idOf(state: string): number {
    return this.chunk.palette.idOf(state);
  }

  getBlockId(localX: number, y: number, localZ: number): number {
    return y < this.chunk.minY || y > this.chunk.maxY ? 0 : this.chunk.getId(localX, y, localZ);
  }

  setBlockId(localX: number, y: number, localZ: number, blockId: number): void {
    if (y < this.chunk.minY || y > this.chunk.maxY) return;
    this.chunk.setId(localX, y, localZ, blockId);
    this.heightmap.onBlockChanged(localX, y, localZ, this.kindOf(blockId) === BLOCK_KIND_AIR);
  }
}
