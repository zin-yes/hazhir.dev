// Mirrors net.minecraft.core.BlockPos (immutable) and BlockPos.MutableBlockPos for ported feature code.
// Level APIs take plain (x, y, z) numbers; these classes are conveniences for code that walks positions.

import type { Direction } from "./direction";

export interface BlockPosLike {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export class BlockPos implements BlockPosLike {
  constructor(
    readonly x: number,
    readonly y: number,
    readonly z: number,
  ) {}

  static of(position: BlockPosLike): BlockPos {
    return new BlockPos(position.x, position.y, position.z);
  }

  offset(deltaX: number, deltaY: number, deltaZ: number): BlockPos {
    return new BlockPos((this.x + deltaX) | 0, (this.y + deltaY) | 0, (this.z + deltaZ) | 0);
  }

  relative(direction: Direction, distance = 1): BlockPos {
    return this.offset(direction.stepX * distance, direction.stepY * distance, direction.stepZ * distance);
  }

  above(distance = 1): BlockPos {
    return this.offset(0, distance, 0);
  }

  below(distance = 1): BlockPos {
    return this.offset(0, -distance, 0);
  }

  atY(y: number): BlockPos {
    return new BlockPos(this.x, y, this.z);
  }

  mutable(): MutableBlockPos {
    return new MutableBlockPos(this.x, this.y, this.z);
  }

  equals(other: BlockPosLike): boolean {
    return this.x === other.x && this.y === other.y && this.z === other.z;
  }

  toString(): string {
    return `BlockPos{x=${this.x}, y=${this.y}, z=${this.z}}`;
  }
}

export class MutableBlockPos implements BlockPosLike {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  setWithOffset(origin: BlockPosLike, deltaX: number, deltaY: number, deltaZ: number): this {
    return this.set((origin.x + deltaX) | 0, (origin.y + deltaY) | 0, (origin.z + deltaZ) | 0);
  }

  setY(y: number): this {
    this.y = y;
    return this;
  }

  move(direction: Direction, distance = 1): this {
    return this.set(this.x + direction.stepX * distance, this.y + direction.stepY * distance, this.z + direction.stepZ * distance);
  }

  mutable(): MutableBlockPos {
    return new MutableBlockPos(this.x, this.y, this.z);
  }

  immutable(): BlockPos {
    return new BlockPos(this.x, this.y, this.z);
  }
}

/** SectionPos.blockToSectionCoord / ChunkPos from a block coordinate. */
export function blockToChunkCoordinate(blockCoordinate: number): number {
  return blockCoordinate >> 4;
}
