// Mirrors StraightTrunkPlacer, ForkingTrunkPlacer, GiantTrunkPlacer, MegaJungleTrunkPlacer and DarkOakTrunkPlacer.

import { BlockPos } from "../../../core/block-pos";
import { Direction } from "../../../core/direction";
import { mthCos, mthSin } from "../java-math";
import { FoliageAttachment } from "../tree-placement";
import { isAirOrLeaves } from "../tree-world";
import { type TrunkPlacementContext, TrunkPlacer } from "./trunk-placer";

const fround = Math.fround;

function randomHorizontalDirection(context: TrunkPlacementContext): Direction {
  return Direction.HORIZONTAL[context.random.nextIntBounded(Direction.HORIZONTAL.length)]!;
}

export class StraightTrunkPlacer extends TrunkPlacer {
  placeTrunk(context: TrunkPlacementContext, freeTreeHeight: number, origin: BlockPos): FoliageAttachment[] {
    this.setDirtAt(context, origin.x, origin.y - 1, origin.z);
    for (let offset = 0; offset < freeTreeHeight; offset++) this.placeLog(context, origin.x, origin.y + offset, origin.z);
    return [new FoliageAttachment(origin.above(freeTreeHeight), 0, false)];
  }
}

export class ForkingTrunkPlacer extends TrunkPlacer {
  placeTrunk(context: TrunkPlacementContext, freeTreeHeight: number, origin: BlockPos): FoliageAttachment[] {
    const { random } = context;
    this.setDirtAt(context, origin.x, origin.y - 1, origin.z);
    const attachments: FoliageAttachment[] = [];
    const leaningDirection = randomHorizontalDirection(context);
    const leanStartHeight = freeTreeHeight - random.nextIntBounded(4) - 1;
    let remainingLean = 3 - random.nextIntBounded(3);
    let x = origin.x;
    let z = origin.z;
    let topY: number | undefined;
    for (let offset = 0; offset < freeTreeHeight; offset++) {
      const y = origin.y + offset;
      if (offset >= leanStartHeight && remainingLean > 0) {
        x += leaningDirection.stepX;
        z += leaningDirection.stepZ;
        remainingLean--;
      }
      if (this.placeLog(context, x, y, z)) topY = y + 1;
    }
    if (topY !== undefined) attachments.push(new FoliageAttachment(new BlockPos(x, topY, z), 1, false));

    x = origin.x;
    z = origin.z;
    const branchDirection = randomHorizontalDirection(context);
    if (branchDirection !== leaningDirection) {
      const branchStartHeight = leanStartHeight - random.nextIntBounded(2) - 1;
      let remainingBranchLength = 1 + random.nextIntBounded(3);
      topY = undefined;
      for (let offset = branchStartHeight; offset < freeTreeHeight && remainingBranchLength > 0; offset++, remainingBranchLength--) {
        if (offset < 1) continue;
        const y = origin.y + offset;
        x += branchDirection.stepX;
        z += branchDirection.stepZ;
        if (this.placeLog(context, x, y, z)) topY = y + 1;
      }
      if (topY !== undefined) attachments.push(new FoliageAttachment(new BlockPos(x, topY, z), 0, false));
    }
    return attachments;
  }
}

export class GiantTrunkPlacer extends TrunkPlacer {
  placeTrunk(context: TrunkPlacementContext, freeTreeHeight: number, origin: BlockPos): FoliageAttachment[] {
    const dirtY = origin.y - 1;
    this.setDirtAt(context, origin.x, dirtY, origin.z);
    this.setDirtAt(context, origin.x + 1, dirtY, origin.z);
    this.setDirtAt(context, origin.x, dirtY, origin.z + 1);
    this.setDirtAt(context, origin.x + 1, dirtY, origin.z + 1);
    for (let offset = 0; offset < freeTreeHeight; offset++) {
      this.placeLogIfFree(context, origin.x, origin.y + offset, origin.z);
      if (offset >= freeTreeHeight - 1) continue;
      this.placeLogIfFree(context, origin.x + 1, origin.y + offset, origin.z);
      this.placeLogIfFree(context, origin.x + 1, origin.y + offset, origin.z + 1);
      this.placeLogIfFree(context, origin.x, origin.y + offset, origin.z + 1);
    }
    return [new FoliageAttachment(origin.above(freeTreeHeight), 0, true)];
  }
}

export class MegaJungleTrunkPlacer extends GiantTrunkPlacer {
  override placeTrunk(context: TrunkPlacementContext, freeTreeHeight: number, origin: BlockPos): FoliageAttachment[] {
    const { random } = context;
    const attachments: FoliageAttachment[] = [...super.placeTrunk(context, freeTreeHeight, origin)];
    for (let branchY = freeTreeHeight - 2 - random.nextIntBounded(4); branchY > Math.trunc(freeTreeHeight / 2); branchY -= 2 + random.nextIntBounded(4)) {
      const angle = fround(fround(random.nextFloat()) * fround(fround(Math.PI) * 2));
      let offsetX = 0;
      let offsetZ = 0;
      for (let step = 0; step < 5; step++) {
        offsetX = Math.trunc(fround(1.5 + fround(mthCos(angle) * step)));
        offsetZ = Math.trunc(fround(1.5 + fround(mthSin(angle) * step)));
        this.placeLog(context, origin.x + offsetX, origin.y + branchY - 3 + Math.trunc(step / 2), origin.z + offsetZ);
      }
      attachments.push(new FoliageAttachment(origin.offset(offsetX, branchY, offsetZ), -2, false));
    }
    return attachments;
  }
}

export class DarkOakTrunkPlacer extends TrunkPlacer {
  placeTrunk(context: TrunkPlacementContext, freeTreeHeight: number, origin: BlockPos): FoliageAttachment[] {
    const { random, level } = context;
    const attachments: FoliageAttachment[] = [];
    const dirtY = origin.y - 1;
    this.setDirtAt(context, origin.x, dirtY, origin.z);
    this.setDirtAt(context, origin.x + 1, dirtY, origin.z);
    this.setDirtAt(context, origin.x, dirtY, origin.z + 1);
    this.setDirtAt(context, origin.x + 1, dirtY, origin.z + 1);
    const leaningDirection = randomHorizontalDirection(context);
    const leanStartHeight = freeTreeHeight - random.nextIntBounded(4);
    let remainingLean = 2 - random.nextIntBounded(3);
    const baseX = origin.x;
    const baseZ = origin.z;
    let x = baseX;
    let z = baseZ;
    const topY = origin.y + freeTreeHeight - 1;
    for (let offset = 0; offset < freeTreeHeight; offset++) {
      if (offset >= leanStartHeight && remainingLean > 0) {
        x += leaningDirection.stepX;
        z += leaningDirection.stepZ;
        remainingLean--;
      }
      const y = origin.y + offset;
      if (!isAirOrLeaves(level, x, y, z)) continue;
      this.placeLog(context, x, y, z);
      this.placeLog(context, x + 1, y, z);
      this.placeLog(context, x, y, z + 1);
      this.placeLog(context, x + 1, y, z + 1);
    }
    attachments.push(new FoliageAttachment(new BlockPos(x, topY, z), 0, true));
    for (let offsetX = -1; offsetX <= 2; offsetX++) {
      for (let offsetZ = -1; offsetZ <= 2; offsetZ++) {
        if ((offsetX >= 0 && offsetX <= 1 && offsetZ >= 0 && offsetZ <= 1) || random.nextIntBounded(3) > 0) continue;
        const rootLength = random.nextIntBounded(3) + 2;
        for (let depth = 0; depth < rootLength; depth++) this.placeLog(context, baseX + offsetX, topY - depth - 1, baseZ + offsetZ);
        attachments.push(new FoliageAttachment(new BlockPos(x + offsetX, topY, z + offsetZ), 0, false));
      }
    }
    return attachments;
  }
}
