// Mirrors CherryTrunkPlacer: a short trunk with one to three branches that arc outward and then climb.

import { type BlockPos, MutableBlockPos } from "../../../core/block-pos";
import { Direction } from "../../../core/direction";
import { type IntProvider, randomBetweenInclusive } from "../../../providers/value-providers";
import { manhattanDistance } from "../java-math";
import { FoliageAttachment } from "../tree-placement";
import { type TrunkPlacementContext, TrunkPlacer } from "./trunk-placer";

const fround = Math.fround;

export class CherryTrunkPlacer extends TrunkPlacer {
  private readonly secondBranchStartMinimum: number;
  private readonly secondBranchStartMaximum: number;

  constructor(
    baseHeight: number,
    heightRandomA: number,
    heightRandomB: number,
    private readonly branchCount: IntProvider,
    private readonly branchHorizontalLength: IntProvider,
    private readonly branchStartOffsetFromTop: IntProvider,
    private readonly branchEndOffsetFromTop: IntProvider,
  ) {
    super(baseHeight, heightRandomA, heightRandomB);
    this.secondBranchStartMinimum = branchStartOffsetFromTop.minValue;
    this.secondBranchStartMaximum = branchStartOffsetFromTop.maxValue - 1;
  }

  placeTrunk(context: TrunkPlacementContext, freeTreeHeight: number, origin: BlockPos): FoliageAttachment[] {
    const { random, level } = context;
    this.setDirtAt(context, origin.x, origin.y - 1, origin.z);
    const firstBranchStart = Math.max(0, freeTreeHeight - 1 + this.branchStartOffsetFromTop.sample(random));
    let secondBranchStart = Math.max(0, freeTreeHeight - 1 + randomBetweenInclusive(random, this.secondBranchStartMinimum, this.secondBranchStartMaximum));
    if (secondBranchStart >= firstBranchStart) secondBranchStart++;
    const branchCount = this.branchCount.sample(random);
    const hasThreeBranches = branchCount === 3;
    const hasTwoBranches = branchCount >= 2;
    let trunkHeight: number;
    if (hasThreeBranches) trunkHeight = freeTreeHeight;
    else if (hasTwoBranches) trunkHeight = Math.max(firstBranchStart, secondBranchStart) + 1;
    else trunkHeight = firstBranchStart + 1;
    for (let offset = 0; offset < trunkHeight; offset++) this.placeLog(context, origin.x, origin.y + offset, origin.z);
    const attachments: FoliageAttachment[] = [];
    if (hasThreeBranches) attachments.push(new FoliageAttachment(origin.above(trunkHeight), 0, false));
    const position = new MutableBlockPos();
    const direction = Direction.HORIZONTAL[random.nextIntBounded(Direction.HORIZONTAL.length)]!;
    const alignLogAxis = (state: string) => (level.blockStates.hasProperty(state, "axis") ? level.blockStates.withProperty(state, "axis", direction.axis) : state);
    attachments.push(this.generateBranch(context, freeTreeHeight, origin, alignLogAxis, direction, firstBranchStart, firstBranchStart < trunkHeight - 1, position));
    if (hasTwoBranches) {
      attachments.push(this.generateBranch(context, freeTreeHeight, origin, alignLogAxis, direction.opposite, secondBranchStart, secondBranchStart < trunkHeight - 1, position));
    }
    return attachments;
  }

  private generateBranch(
    context: TrunkPlacementContext,
    freeTreeHeight: number,
    origin: BlockPos,
    alignLogAxis: (state: string) => string,
    direction: Direction,
    startHeight: number,
    startsLowOnTrunk: boolean,
    position: MutableBlockPos,
  ): FoliageAttachment {
    const { random } = context;
    position.set(origin.x, origin.y, origin.z).move(Direction.UP, startHeight);
    const endHeight = freeTreeHeight - 1 + this.branchEndOffsetFromTop.sample(random);
    const lengthened = startsLowOnTrunk || endHeight < startHeight;
    const horizontalLength = this.branchHorizontalLength.sample(random) + (lengthened ? 1 : 0);
    const target = origin.relative(direction, horizontalLength).above(endHeight);
    const initialSteps = lengthened ? 2 : 1;
    for (let step = 0; step < initialSteps; step++) {
      position.move(direction);
      this.placeLog(context, position.x, position.y, position.z, alignLogAxis);
    }
    const verticalDirection = target.y > position.y ? Direction.UP : Direction.DOWN;
    for (let remaining = manhattanDistance(position.x, position.y, position.z, target.x, target.y, target.z); remaining !== 0; remaining = manhattanDistance(position.x, position.y, position.z, target.x, target.y, target.z)) {
      const verticalChance = fround(fround(Math.abs(target.y - position.y)) / fround(remaining));
      const moveVertically = random.nextFloat() < verticalChance;
      position.move(moveVertically ? verticalDirection : direction);
      this.placeLog(context, position.x, position.y, position.z, moveVertically ? undefined : alignLogAxis);
    }
    return new FoliageAttachment(target.above(), 0, false);
  }
}

