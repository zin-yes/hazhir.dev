// Mirrors BendingTrunkPlacer (azalea and Terralith bushes): a trunk that leans over and ends in a horizontal arm.

import type { BlockPos } from "../../../core/block-pos";
import { MutableBlockPos } from "../../../core/block-pos";
import { Direction } from "../../../core/direction";
import type { IntProvider } from "../../../providers/value-providers";
import { FoliageAttachment } from "../tree-placement";
import { type TrunkPlacementContext, TrunkPlacer } from "./trunk-placer";

export class BendingTrunkPlacer extends TrunkPlacer {
  constructor(
    baseHeight: number,
    heightRandomA: number,
    heightRandomB: number,
    private readonly minHeightForLeaves: number,
    private readonly bendLength: IntProvider,
  ) {
    super(baseHeight, heightRandomA, heightRandomB);
  }

  placeTrunk(context: TrunkPlacementContext, freeTreeHeight: number, origin: BlockPos): FoliageAttachment[] {
    const { random, level } = context;
    const bendDirection = Direction.HORIZONTAL[random.nextIntBounded(Direction.HORIZONTAL.length)]!;
    const topOffset = freeTreeHeight - 1;
    const position = origin.mutable();
    this.setDirtAt(context, position.x, position.y - 1, position.z);
    const attachments: FoliageAttachment[] = [];
    for (let offset = 0; offset <= topOffset; offset++) {
      if (offset + 1 >= topOffset + random.nextIntBounded(2)) position.move(bendDirection);
      if (this.validTreePosition(level, position.x, position.y, position.z)) this.placeLog(context, position.x, position.y, position.z);
      if (offset >= this.minHeightForLeaves) attachments.push(new FoliageAttachment(position.immutable(), 0, false));
      position.move(Direction.UP);
    }
    const armLength = this.bendLength.sample(random);
    this.placeArm(context, position, bendDirection, armLength, attachments);
    return attachments;
  }

  private placeArm(context: TrunkPlacementContext, position: MutableBlockPos, direction: Direction, armLength: number, attachments: FoliageAttachment[]): void {
    for (let step = 0; step <= armLength; step++) {
      if (this.validTreePosition(context.level, position.x, position.y, position.z)) this.placeLog(context, position.x, position.y, position.z);
      attachments.push(new FoliageAttachment(position.immutable(), 0, false));
      position.move(direction);
    }
  }
}
