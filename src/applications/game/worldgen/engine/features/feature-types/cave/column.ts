// Mirrors net.minecraft.world.level.levelgen.Column (Range, Ray, Line) and Column.scan.

import type { BlockPosLike } from "../../core/block-pos";

/** Floor and ceiling are the first blocks that stop the column, or undefined where it is open. */
export class Column {
  private constructor(
    readonly floor: number | undefined,
    readonly ceiling: number | undefined,
  ) {
    if (floor !== undefined && ceiling !== undefined && ceiling - floor - 1 < 0) {
      throw new Error(`Column of negative height: C(${ceiling}-${floor})`);
    }
  }

  /** Column.create(floor, ceiling). */
  static create(floor: number | undefined, ceiling: number | undefined): Column {
    return new Column(floor, ceiling);
  }

  /** Range.height(): only closed columns have a height. */
  get height(): number | undefined {
    return this.floor !== undefined && this.ceiling !== undefined ? this.ceiling - this.floor - 1 : undefined;
  }

  withFloor(floor: number | undefined): Column {
    return Column.create(floor, this.ceiling);
  }

  isRange(): boolean {
    return this.floor !== undefined && this.ceiling !== undefined;
  }

  /**
   * Column.scan: from `origin` (which must satisfy `insideColumn`) walk up and down while `insideColumn` holds, for at
   * most `searchRange - 1` steps, and report an edge where `isEdge` holds. Undefined when origin is not inside.
   */
  static scan(
    stateAt: (x: number, y: number, z: number) => string,
    origin: BlockPosLike,
    searchRange: number,
    insideColumn: (state: string) => boolean,
    isEdge: (state: string) => boolean,
  ): Column | undefined {
    if (!insideColumn(stateAt(origin.x, origin.y, origin.z))) return undefined;
    const scanDirection = (step: 1 | -1): number | undefined => {
      let y = origin.y;
      for (let distance = 1; distance < searchRange && insideColumn(stateAt(origin.x, y, origin.z)); distance++) y += step;
      return isEdge(stateAt(origin.x, y, origin.z)) ? y : undefined;
    };
    const ceiling = scanDirection(1);
    const floor = scanDirection(-1);
    return Column.create(floor, ceiling);
  }
}
