// Mirrors net.minecraft.core.Direction (order, offsets, names) and Direction.Axis.

export type AxisName = "x" | "y" | "z";

export class Direction {
  private constructor(
    readonly ordinal: number,
    readonly name: string,
    readonly stepX: number,
    readonly stepY: number,
    readonly stepZ: number,
    readonly axis: AxisName,
    private readonly oppositeOrdinal: number,
  ) {}

  static readonly DOWN = new Direction(0, "down", 0, -1, 0, "y", 1);
  static readonly UP = new Direction(1, "up", 0, 1, 0, "y", 0);
  static readonly NORTH = new Direction(2, "north", 0, 0, -1, "z", 3);
  static readonly SOUTH = new Direction(3, "south", 0, 0, 1, "z", 2);
  static readonly WEST = new Direction(4, "west", -1, 0, 0, "x", 5);
  static readonly EAST = new Direction(5, "east", 1, 0, 0, "x", 4);

  /** Direction.values() order. */
  static readonly VALUES: readonly Direction[] = [Direction.DOWN, Direction.UP, Direction.NORTH, Direction.SOUTH, Direction.WEST, Direction.EAST];
  /** Direction.Plane.HORIZONTAL iteration order. */
  static readonly HORIZONTAL: readonly Direction[] = [Direction.NORTH, Direction.EAST, Direction.SOUTH, Direction.WEST];

  get opposite(): Direction {
    return Direction.VALUES[this.oppositeOrdinal]!;
  }

  static fromName(name: string): Direction {
    const found = Direction.VALUES.find((direction) => direction.name === name);
    if (!found) throw new Error(`Unknown direction "${name}"`);
    return found;
  }
}

/** Direction.Axis.values() order, used by RotatedBlockProvider (Util.getRandom over the axes). */
export const AXES: readonly AxisName[] = ["x", "y", "z"];
