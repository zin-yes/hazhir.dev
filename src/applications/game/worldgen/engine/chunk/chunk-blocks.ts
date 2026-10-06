// Block storage for one 16x16 column over the full world height, shared by every generation stage.
// Layout: index = (y - minY) * 256 + localZ * 16 + localX, values are BlockPalette ids.

import { defineHotCounter, noteHot, noteHotAmount } from "../profiling/hot-counters";
import { BlockPalette } from "./block-palette";

const COLUMNS_ALLOCATED = defineHotCounter("chunkBlocks.columnsAllocated");
const COLUMN_BYTES_ALLOCATED = defineHotCounter("chunkBlocks.bytesAllocated");

export const CHUNK_COLUMN_SIZE = 16;
const LAYER_SIZE = CHUNK_COLUMN_SIZE * CHUNK_COLUMN_SIZE;

export class ChunkBlocks {
  readonly blocks: Uint16Array;

  constructor(
    readonly chunkX: number,
    readonly chunkZ: number,
    readonly minY: number,
    readonly height: number,
    readonly palette: BlockPalette,
  ) {
    this.blocks = new Uint16Array(LAYER_SIZE * height);
    noteHot(COLUMNS_ALLOCATED);
    noteHotAmount(COLUMN_BYTES_ALLOCATED, this.blocks.byteLength);
  }

  get maxY(): number {
    return this.minY + this.height - 1;
  }

  indexOf(localX: number, y: number, localZ: number): number {
    return (y - this.minY) * LAYER_SIZE + localZ * CHUNK_COLUMN_SIZE + localX;
  }

  isInside(localX: number, y: number, localZ: number): boolean {
    return localX >= 0 && localX < CHUNK_COLUMN_SIZE && localZ >= 0 && localZ < CHUNK_COLUMN_SIZE && y >= this.minY && y <= this.maxY;
  }

  getId(localX: number, y: number, localZ: number): number {
    return this.blocks[this.indexOf(localX, y, localZ)]!;
  }

  setId(localX: number, y: number, localZ: number, id: number): void {
    this.blocks[this.indexOf(localX, y, localZ)] = id;
  }

  getState(localX: number, y: number, localZ: number): string {
    return this.palette.stateOf(this.getId(localX, y, localZ));
  }

  setState(localX: number, y: number, localZ: number, state: string): void {
    this.setId(localX, y, localZ, this.palette.idOf(state));
  }
}
