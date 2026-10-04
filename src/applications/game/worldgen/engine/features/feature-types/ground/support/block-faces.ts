// Face queries on the block state at a position, mirroring BlockState.isFaceSturdy(level, pos, direction) and
// MultifaceBlock.canAttachTo. Both read the recorded default-state shapes (see engine/block-state), with the few
// recorded exceptions (leaves attach through their collision shape although their support shape is empty).

import type { Direction } from "../../../core/direction";
import type { WorldGenLevel } from "../../../level/world-gen-level";
import { ATTACH_FACE_EXCEPTIONS, COLLISION_FULL_OVERRIDES } from "./block-faces.generated";

/** BlockState.isFaceSturdy(level, pos, direction) with SupportType.FULL. */
export function isFaceSturdy(level: WorldGenLevel, x: number, y: number, z: number, direction: Direction): boolean {
  return (level.getBlockInfo(x, y, z).sturdyFaces & (1 << direction.ordinal)) !== 0;
}

/**
 * MultifaceBlock.canAttachTo(level, direction, pos, state): the neighbor at (x, y, z) has a full support or collision
 * face turned toward the block that attaches in `direction`.
 */
export function canAttachTo(level: WorldGenLevel, direction: Direction, x: number, y: number, z: number): boolean {
  const info = level.getBlockInfo(x, y, z);
  const attachableFaces = ATTACH_FACE_EXCEPTIONS[info.name] ?? info.sturdyFaces;
  return (attachableFaces & (1 << direction.opposite.ordinal)) !== 0;
}

/** BlockState.isCollisionShapeFullBlock. */
export function isCollisionShapeFullBlock(level: WorldGenLevel, x: number, y: number, z: number): boolean {
  const info = level.getBlockInfo(x, y, z);
  return COLLISION_FULL_OVERRIDES[info.name] ?? info.sturdyFaces === 63;
}
