// Mirrors BitSetDiscreteVoxelShape (fill / isFull) and DiscreteVoxelShape.forAllFaces, which walks the faces of the
// filled region in the same order as Java: axis cycles NONE, FORWARD, BACKWARD, scanning along the cycled Z axis.

import { Direction } from "../../core/direction";

type AxisIndex = 0 | 1 | 2;
type CycleName = "none" | "forward" | "backward";

/** AxisCycle.cycle(x, y, z, axis): the component of (x, y, z) the cycle maps onto `axis`. */
function cycleComponent(cycle: CycleName, x: number, y: number, z: number, axis: AxisIndex): number {
  const components: readonly [number, number, number] = cycle === "none" ? [x, y, z] : cycle === "forward" ? [z, x, y] : [y, z, x];
  return components[axis];
}

/** AxisCycle.cycle(Axis). */
function cycleAxis(cycle: CycleName, axis: AxisIndex): AxisIndex {
  if (cycle === "none") return axis;
  return (cycle === "forward" ? (axis + 1) % 3 : (axis + 2) % 3) as AxisIndex;
}

function inverseOf(cycle: CycleName): CycleName {
  return cycle === "none" ? "none" : cycle === "forward" ? "backward" : "forward";
}

const NEGATIVE_DIRECTIONS: readonly Direction[] = [Direction.WEST, Direction.DOWN, Direction.NORTH];
const POSITIVE_DIRECTIONS: readonly Direction[] = [Direction.EAST, Direction.UP, Direction.SOUTH];

export type FaceConsumer = (direction: Direction, localX: number, localY: number, localZ: number) => void;

export class BitSetVoxelShape {
  private readonly filled: Uint8Array;
  private readonly sizes: readonly [number, number, number];

  constructor(sizeX: number, sizeY: number, sizeZ: number) {
    this.sizes = [sizeX, sizeY, sizeZ];
    this.filled = new Uint8Array(sizeX * sizeY * sizeZ);
  }

  private indexOf(x: number, y: number, z: number): number {
    return (x * this.sizes[1] + y) * this.sizes[2] + z;
  }

  fill(x: number, y: number, z: number): void {
    this.filled[this.indexOf(x, y, z)] = 1;
  }

  isFull(x: number, y: number, z: number): boolean {
    return this.filled[this.indexOf(x, y, z)] === 1;
  }

  forAllFaces(consumer: FaceConsumer): void {
    this.forAllAxisFaces(consumer, "none");
    this.forAllAxisFaces(consumer, "forward");
    this.forAllAxisFaces(consumer, "backward");
  }

  private forAllAxisFaces(consumer: FaceConsumer, cycle: CycleName): void {
    const inverse = inverseOf(cycle);
    const scanAxis = cycleAxis(inverse, 2);
    const sizeFirst = this.sizes[cycleAxis(inverse, 0)];
    const sizeSecond = this.sizes[cycleAxis(inverse, 1)];
    const sizeScan = this.sizes[scanAxis];
    const negativeFace = NEGATIVE_DIRECTIONS[scanAxis]!;
    const positiveFace = POSITIVE_DIRECTIONS[scanAxis]!;
    for (let first = 0; first < sizeFirst; first++) {
      for (let second = 0; second < sizeSecond; second++) {
        let previousFull = false;
        for (let scan = 0; scan <= sizeScan; scan++) {
          const full = scan !== sizeScan && this.isFull(cycleComponent(inverse, first, second, scan, 0), cycleComponent(inverse, first, second, scan, 1), cycleComponent(inverse, first, second, scan, 2));
          if (!previousFull && full) {
            consumer(negativeFace, cycleComponent(inverse, first, second, scan, 0), cycleComponent(inverse, first, second, scan, 1), cycleComponent(inverse, first, second, scan, 2));
          }
          if (previousFull && !full) {
            consumer(positiveFace, cycleComponent(inverse, first, second, scan - 1, 0), cycleComponent(inverse, first, second, scan - 1, 1), cycleComponent(inverse, first, second, scan - 1, 2));
          }
          previousFull = full;
        }
      }
    }
  }
}
