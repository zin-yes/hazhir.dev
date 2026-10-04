// Mirrors FancyTrunkPlacer (the big oak): a tilted trunk with limbs ending in foliage clusters. Constants and the
// float/double mix follow the Java source line by line.

import { BlockPos } from "../../../core/block-pos";
import { mthFloor, mthSqrt } from "../java-math";
import { FoliageAttachment } from "../tree-placement";
import { type TrunkPlacementContext, TrunkPlacer } from "./trunk-placer";

const fround = Math.fround;
const TRUNK_HEIGHT_SCALE = 0.618;
const CLUSTER_DENSITY_MAGIC = 1.382;
const BRANCH_SLOPE = 0.381;
const BRANCH_LENGTH_MAGIC = 0.328;
const TWO_PI_FACTOR = Math.PI;

interface FoliageCoordinates {
  readonly attachment: FoliageAttachment;
  readonly branchBase: number;
}

type AxisName = "x" | "y" | "z";

function treeShape(height: number, y: number): number {
  if (fround(y) < fround(fround(height) * fround(0.3))) return -1.0;
  const halfHeight = fround(fround(height) / 2.0);
  const distanceFromMiddle = fround(halfHeight - fround(y));
  let radius = mthSqrt(fround(fround(halfHeight * halfHeight) - fround(distanceFromMiddle * distanceFromMiddle)));
  if (distanceFromMiddle === 0) radius = halfHeight;
  else if (Math.abs(distanceFromMiddle) >= halfHeight) return 0.0;
  return fround(radius * fround(0.5));
}

export class FancyTrunkPlacer extends TrunkPlacer {
  placeTrunk(context: TrunkPlacementContext, freeTreeHeight: number, origin: BlockPos): FoliageAttachment[] {
    const { random } = context;
    const limbHeight = 5;
    const shapeHeight = freeTreeHeight + 2;
    const clusterBaseOffset = mthFloor(shapeHeight * TRUNK_HEIGHT_SCALE);
    this.setDirtAt(context, origin.x, origin.y - 1, origin.z);
    const clustersPerLayer = Math.min(1, mthFloor(CLUSTER_DENSITY_MAGIC + (1.0 * shapeHeight / 13.0) ** 2));
    const defaultBranchBase = origin.y + clusterBaseOffset;
    let layer = shapeHeight - limbHeight;
    const coordinates: FoliageCoordinates[] = [{ attachment: new FoliageAttachment(origin.above(layer), 0, false), branchBase: defaultBranchBase }];
    for (; layer >= 0; layer--) {
      const shape = treeShape(shapeHeight, layer);
      if (shape < 0.0) continue;
      for (let cluster = 0; cluster < clustersPerLayer; cluster++) {
        const limbLength = 1.0 * shape * (fround(random.nextFloat()) + BRANCH_LENGTH_MAGIC);
        const angle = fround(random.nextFloat() * 2.0) * TWO_PI_FACTOR;
        const offsetX = limbLength * Math.sin(angle) + 0.5;
        const offsetZ = limbLength * Math.cos(angle) + 0.5;
        const limbStart = origin.offset(mthFloor(offsetX), layer - 1, mthFloor(offsetZ));
        const limbEnd = limbStart.above(limbHeight);
        if (!this.makeLimb(context, limbStart, limbEnd, false)) continue;
        const deltaX = origin.x - limbStart.x;
        const deltaZ = origin.z - limbStart.z;
        const branchY = limbStart.y - Math.sqrt(deltaX * deltaX + deltaZ * deltaZ) * BRANCH_SLOPE;
        const branchBaseY = branchY > defaultBranchBase ? defaultBranchBase : Math.trunc(branchY);
        const trunkConnection = new BlockPos(origin.x, branchBaseY, origin.z);
        if (!this.makeLimb(context, trunkConnection, limbStart, false)) continue;
        coordinates.push({ attachment: new FoliageAttachment(limbStart, 0, false), branchBase: trunkConnection.y });
      }
    }
    this.makeLimb(context, origin, origin.above(clusterBaseOffset), true);
    this.makeBranches(context, shapeHeight, origin, coordinates);
    const attachments: FoliageAttachment[] = [];
    for (const coordinate of coordinates) {
      if (this.trimBranches(shapeHeight, coordinate.branchBase - origin.y)) attachments.push(coordinate.attachment);
    }
    return attachments;
  }

  private makeLimb(context: TrunkPlacementContext, start: BlockPos, end: BlockPos, doPlace: boolean): boolean {
    if (!doPlace && start.equals(end)) return true;
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const deltaZ = end.z - start.z;
    const steps = Math.max(Math.abs(deltaX), Math.abs(deltaY), Math.abs(deltaZ));
    const stepX = fround(deltaX / steps);
    const stepY = fround(deltaY / steps);
    const stepZ = fround(deltaZ / steps);
    for (let step = 0; step <= steps; step++) {
      const x = start.x + mthFloor(fround(0.5 + fround(step * stepX)));
      const y = start.y + mthFloor(fround(0.5 + fround(step * stepY)));
      const z = start.z + mthFloor(fround(0.5 + fround(step * stepZ)));
      if (doPlace) {
        const axis = this.logAxis(start, x, z);
        this.placeLog(context, x, y, z, (state) => (context.level.blockStates.hasProperty(state, "axis") ? context.level.blockStates.withProperty(state, "axis", axis) : state));
      } else if (!this.isFree(context.level, x, y, z)) {
        return false;
      }
    }
    return true;
  }

  private logAxis(start: BlockPos, x: number, z: number): AxisName {
    const distanceX = Math.abs(x - start.x);
    const longest = Math.max(distanceX, Math.abs(z - start.z));
    if (longest > 0) return distanceX === longest ? "x" : "z";
    return "y";
  }

  private trimBranches(shapeHeight: number, heightAboveOrigin: number): boolean {
    return heightAboveOrigin >= shapeHeight * 0.2;
  }

  private makeBranches(context: TrunkPlacementContext, shapeHeight: number, origin: BlockPos, coordinates: readonly FoliageCoordinates[]): void {
    for (const coordinate of coordinates) {
      const branchBase = coordinate.branchBase;
      const base = new BlockPos(origin.x, branchBase, origin.z);
      if (base.equals(coordinate.attachment.pos) || !this.trimBranches(shapeHeight, branchBase - origin.y)) continue;
      this.makeLimb(context, base, coordinate.attachment.pos, true);
    }
  }
}
