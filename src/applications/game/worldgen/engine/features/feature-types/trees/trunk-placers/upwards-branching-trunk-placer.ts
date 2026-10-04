// Mirrors UpwardsBranchingTrunkPlacer (mangroves): a straight trunk that sprouts sideways branches climbing upward,
// which may also grow through the blocks listed in can_grow_through.

import type { BlockPos } from "../../../core/block-pos";
import { MutableBlockPos } from "../../../core/block-pos";
import { Direction } from "../../../core/direction";
import type { BlockSet } from "../../../providers/block-predicates";
import type { IntProvider } from "../../../providers/value-providers";
import type { WorldGenLevel } from "../../../level/world-gen-level";
import { FoliageAttachment } from "../tree-placement";
import { type TrunkPlacementContext, TrunkPlacer } from "./trunk-placer";

export class UpwardsBranchingTrunkPlacer extends TrunkPlacer {
  constructor(
    baseHeight: number,
    heightRandomA: number,
    heightRandomB: number,
    private readonly extraBranchSteps: IntProvider,
    private readonly placeBranchPerLogProbability: number,
    private readonly extraBranchLength: IntProvider,
    private readonly canGrowThrough: BlockSet,
  ) {
    super(baseHeight, heightRandomA, heightRandomB);
  }

  override validTreePosition(level: WorldGenLevel, x: number, y: number, z: number): boolean {
    return super.validTreePosition(level, x, y, z) || this.canGrowThrough.contains(level, level.getBlockInfo(x, y, z).name);
  }

  placeTrunk(context: TrunkPlacementContext, freeTreeHeight: number, origin: BlockPos): FoliageAttachment[] {
    const { random } = context;
    const attachments: FoliageAttachment[] = [];
    const position = new MutableBlockPos();
    for (let offset = 0; offset < freeTreeHeight; offset++) {
      const y = origin.y + offset;
      position.set(origin.x, y, origin.z);
      if (this.placeLog(context, position.x, position.y, position.z) && offset < freeTreeHeight - 1 && random.nextFloat() < this.placeBranchPerLogProbability) {
        const direction = Direction.HORIZONTAL[random.nextIntBounded(Direction.HORIZONTAL.length)]!;
        const branchLength = this.extraBranchLength.sample(random);
        const branchStart = Math.max(0, branchLength - this.extraBranchLength.sample(random) - 1);
        const branchSteps = this.extraBranchSteps.sample(random);
        this.placeBranch(context, freeTreeHeight, attachments, position, y, direction, branchStart, branchSteps);
      }
      if (offset !== freeTreeHeight - 1) continue;
      position.set(origin.x, y + 1, origin.z);
      attachments.push(new FoliageAttachment(position.immutable(), 0, false));
    }
    return attachments;
  }

  private placeBranch(
    context: TrunkPlacementContext,
    freeTreeHeight: number,
    attachments: FoliageAttachment[],
    position: MutableBlockPos,
    trunkY: number,
    direction: Direction,
    branchStart: number,
    branchSteps: number,
  ): void {
    let topY = trunkY + branchStart;
    let x = position.x;
    let z = position.z;
    for (let offset = branchStart; offset < freeTreeHeight && branchSteps > 0; offset++, branchSteps--) {
      if (offset < 1) continue;
      const y = trunkY + offset;
      topY = y;
      x += direction.stepX;
      z += direction.stepZ;
      position.set(x, y, z);
      if (this.placeLog(context, x, y, z)) topY++;
      attachments.push(new FoliageAttachment(position.immutable(), 0, false));
    }
    if (topY - trunkY > 1) {
      const tip = position.set(x, topY, z).immutable();
      attachments.push(new FoliageAttachment(tip, 0, false));
      attachments.push(new FoliageAttachment(tip.below(2), 0, false));
    }
  }
}

