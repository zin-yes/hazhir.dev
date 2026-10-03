// Adapts a chunk's block array to the tree builders' writer contract. One
// instance is reused for every tree; only the origin changes.

import { BlockType } from "@/applications/game/blocks";
import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "@/applications/game/config";
import type { TreeBlockWriter } from "../trees/tree-types";
import { IS_LEAF, IS_PLANT, IS_SOIL } from "./block-classes";

const X_STRIDE = CHUNK_HEIGHT * CHUNK_LENGTH;
const Y_STRIDE = CHUNK_LENGTH;

export class ChunkTreeWriter implements TreeBlockWriter {
  private originLocalX = 0;
  private originLocalZ = 0;
  private originLocalY = 0;

  constructor(
    private readonly blocks: Uint8Array,
    private readonly chunkWorldX: number,
    private readonly chunkWorldY: number,
    private readonly chunkWorldZ: number,
  ) {}

  /** `baseY` is the world y of the first block above the ground. */
  setOrigin(worldX: number, baseY: number, worldZ: number): void {
    this.originLocalX = worldX - this.chunkWorldX;
    this.originLocalY = baseY - this.chunkWorldY;
    this.originLocalZ = worldZ - this.chunkWorldZ;
  }

  placeLog(dx: number, dy: number, dz: number, block: BlockType): void {
    const index = this.indexOf(dx, dy, dz);
    if (index < 0) return;
    const existing = this.blocks[index];
    if (existing === BlockType.AIR || IS_LEAF[existing] || IS_PLANT[existing] || existing === BlockType.WATER) {
      this.blocks[index] = block;
    }
  }

  placeLeaf(dx: number, dy: number, dz: number, block: BlockType): void {
    const index = this.indexOf(dx, dy, dz);
    if (index < 0) return;
    const existing = this.blocks[index];
    if (existing === BlockType.AIR || IS_PLANT[existing]) this.blocks[index] = block;
  }

  placeGround(dx: number, dz: number, block: BlockType): void {
    const index = this.indexOf(dx, -1, dz);
    if (index < 0) return;
    if (IS_SOIL[this.blocks[index]]) this.blocks[index] = block;
  }

  private indexOf(dx: number, dy: number, dz: number): number {
    const localX = this.originLocalX + dx;
    const localY = this.originLocalY + dy;
    const localZ = this.originLocalZ + dz;
    if (
      localX < 0 || localX >= CHUNK_WIDTH ||
      localY < 0 || localY >= CHUNK_HEIGHT ||
      localZ < 0 || localZ >= CHUNK_LENGTH
    ) {
      return -1;
    }
    return localX * X_STRIDE + localY * Y_STRIDE + localZ;
  }
}
