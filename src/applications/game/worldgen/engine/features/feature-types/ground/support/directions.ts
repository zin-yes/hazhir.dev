// Direction helpers that core/direction.ts does not carry: Direction.getClockWise/getCounterClockWise on the
// horizontal plane and Direction.fromAxisAndDirection.

import { Direction } from "../../../core/direction";

/** Direction.getClockWise (horizontal directions only): north -> east -> south -> west. */
export function clockWise(direction: Direction): Direction {
  const index = Direction.HORIZONTAL.indexOf(direction);
  if (index < 0) throw new Error(`${direction.name} is not a horizontal direction`);
  return Direction.HORIZONTAL[(index + 1) % 4]!;
}

/** Direction.getCounterClockWise (horizontal directions only). */
export function counterClockWise(direction: Direction): Direction {
  const index = Direction.HORIZONTAL.indexOf(direction);
  if (index < 0) throw new Error(`${direction.name} is not a horizontal direction`);
  return Direction.HORIZONTAL[(index + 3) % 4]!;
}

/** Direction.fromAxisAndDirection(axis, negative ? NEGATIVE : POSITIVE). */
export function directionAlongAxis(axis: "x" | "y" | "z", negative: boolean): Direction {
  if (axis === "x") return negative ? Direction.WEST : Direction.EAST;
  if (axis === "y") return negative ? Direction.DOWN : Direction.UP;
  return negative ? Direction.NORTH : Direction.SOUTH;
}
