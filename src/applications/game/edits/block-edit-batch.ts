import { BlockType } from "../blocks";

export interface BlockEdit {
  x: number;
  y: number;
  z: number;
  block: number;
}

/** Which existing blocks an edit batch is allowed to overwrite. */
export type ReplaceRule = "any" | "airOnly" | "nonAirOnly";

export interface BlockPosition {
  x: number;
  y: number;
  z: number;
}

/** What a brush does to the blocks inside its shape. */
export type BrushMode =
  | "fill"
  | "erase"
  | "fillAirOnly"
  | "replaceNonAirOnly";

const INITIAL_BATCH_CAPACITY = 1024;

/**
 * Block edits stored as parallel typed arrays, so a brush with a hundred
 * thousand cells costs four allocations instead of a hundred thousand objects.
 */
export class BlockEditBatch {
  xs: Int32Array;
  ys: Int32Array;
  zs: Int32Array;
  blocks: Uint8Array;
  length = 0;

  constructor(
    readonly replaceRule: ReplaceRule = "any",
    initialCapacity = INITIAL_BATCH_CAPACITY,
  ) {
    this.xs = new Int32Array(initialCapacity);
    this.ys = new Int32Array(initialCapacity);
    this.zs = new Int32Array(initialCapacity);
    this.blocks = new Uint8Array(initialCapacity);
  }

  static fromEdits(
    edits: ArrayLike<BlockEdit>,
    replaceRule: ReplaceRule = "any",
  ): BlockEditBatch {
    const batch = new BlockEditBatch(replaceRule, Math.max(edits.length, 1));
    for (let position = 0; position < edits.length; position++) {
      const edit = edits[position];
      batch.push(edit.x, edit.y, edit.z, edit.block);
    }
    return batch;
  }

  push(x: number, y: number, z: number, block: number) {
    if (this.length === this.xs.length) this.grow();
    this.xs[this.length] = x;
    this.ys[this.length] = y;
    this.zs[this.length] = z;
    this.blocks[this.length] = block;
    this.length++;
  }

  toEdits(): BlockEdit[] {
    const edits: BlockEdit[] = [];
    for (let position = 0; position < this.length; position++) {
      edits.push({
        x: this.xs[position],
        y: this.ys[position],
        z: this.zs[position],
        block: this.blocks[position],
      });
    }
    return edits;
  }

  private grow() {
    const capacity = this.xs.length * 2;
    const grownInts = (existing: Int32Array) => {
      const grown = new Int32Array(capacity);
      grown.set(existing);
      return grown;
    };
    this.xs = grownInts(this.xs);
    this.ys = grownInts(this.ys);
    this.zs = grownInts(this.zs);
    const grownBlocks = new Uint8Array(capacity);
    grownBlocks.set(this.blocks);
    this.blocks = grownBlocks;
  }
}

function replaceRuleFor(mode: BrushMode): ReplaceRule {
  if (mode === "fillAirOnly") return "airOnly";
  if (mode === "erase" || mode === "replaceNonAirOnly") return "nonAirOnly";
  return "any";
}

function blockForMode(mode: BrushMode, block: number): number {
  return mode === "erase" ? BlockType.AIR : block;
}

/**
 * Every block whose center lies within radius of the center block, as edits
 * that set it to the brush block. Cells run along y innermost so consecutive
 * edits mostly land in the same chunk.
 *
 * Modes: "fill" overwrites everything, "erase" turns solid blocks into air,
 * "fillAirOnly" paints only air (never overwrites what is there) and
 * "replaceNonAirOnly" repaints only non-air blocks.
 */
export function sphereEdits(
  center: BlockPosition,
  radius: number,
  block: number,
  mode: BrushMode,
): BlockEditBatch {
  const editBlock = blockForMode(mode, block);
  const reach = Math.floor(radius);
  const radiusSquared = radius * radius;
  const estimatedCells = Math.ceil((4 / 3) * Math.PI * (reach + 1) ** 3);
  const batch = new BlockEditBatch(replaceRuleFor(mode), estimatedCells);

  for (let offsetX = -reach; offsetX <= reach; offsetX++) {
    for (let offsetZ = -reach; offsetZ <= reach; offsetZ++) {
      const remaining = radiusSquared - offsetX * offsetX - offsetZ * offsetZ;
      if (remaining < 0) continue;
      let verticalReach = Math.floor(Math.sqrt(remaining));
      while ((verticalReach + 1) ** 2 <= remaining) verticalReach++;
      while (verticalReach ** 2 > remaining) verticalReach--;
      for (let offsetY = -verticalReach; offsetY <= verticalReach; offsetY++) {
        batch.push(
          center.x + offsetX,
          center.y + offsetY,
          center.z + offsetZ,
          editBlock,
        );
      }
    }
  }
  return batch;
}

/** Every block of the box between two corners, both inclusive, in the same modes as sphereEdits. */
export function boxEdits(
  firstCorner: BlockPosition,
  secondCorner: BlockPosition,
  block: number,
  mode: BrushMode,
): BlockEditBatch {
  const editBlock = blockForMode(mode, block);
  const minX = Math.min(firstCorner.x, secondCorner.x);
  const maxX = Math.max(firstCorner.x, secondCorner.x);
  const minY = Math.min(firstCorner.y, secondCorner.y);
  const maxY = Math.max(firstCorner.y, secondCorner.y);
  const minZ = Math.min(firstCorner.z, secondCorner.z);
  const maxZ = Math.max(firstCorner.z, secondCorner.z);
  const cellCount = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
  const batch = new BlockEditBatch(replaceRuleFor(mode), cellCount);

  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let y = minY; y <= maxY; y++) batch.push(x, y, z, editBlock);
    }
  }
  return batch;
}
