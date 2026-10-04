// The sphere brush's rules, free of input and rendering: radius limits, which mode a click means, where the sphere
// lands and when a drag has moved far enough to paint again.

import type { BlockPosition, BrushMode } from "../edits/block-edit-batch";

export const BRUSH_MINIMUM_RADIUS = 1;
export const BRUSH_MAXIMUM_RADIUS = 64;
export const BRUSH_DEFAULT_RADIUS = 6;
/** Blocks the brush ray reaches, longer than the hand's 5. */
export const BRUSH_REACH_BLOCKS = 24;
/** A drag paints again once the center moved this fraction of the radius. */
const DRAG_STEP_FRACTION = 0.25;

export interface BrushSettings {
  enabled: boolean;
  radius: number;
}

export type BrushAction = "erase" | "paint";

export interface BrushModifiers {
  /** Ctrl: repaint only blocks that are there. */
  replaceOnly: boolean;
  /** Alt: fill only air. */
  airOnly: boolean;
}

export function clampBrushRadius(radius: number): number {
  if (!Number.isFinite(radius)) return BRUSH_DEFAULT_RADIUS;
  return Math.min(BRUSH_MAXIMUM_RADIUS, Math.max(BRUSH_MINIMUM_RADIUS, Math.round(radius)));
}

/** Radius steps grow with the radius, so [ and ] cover 1..64 in a handful of presses. */
export function steppedBrushRadius(radius: number, direction: 1 | -1): number {
  const step = radius >= 32 ? 8 : radius >= 16 ? 4 : radius >= 8 ? 2 : 1;
  return clampBrushRadius(radius + direction * step);
}

export function brushModeFor(action: BrushAction, modifiers: BrushModifiers): BrushMode {
  if (action === "erase") return "erase";
  if (modifiers.replaceOnly) return "replaceNonAirOnly";
  if (modifiers.airOnly) return "fillAirOnly";
  return "fill";
}

export interface BrushRayHit {
  cell: readonly [number, number, number];
  faceNormal: readonly [number, number, number];
}

/**
 * Erasing centers on the targeted block, painting on the block in front of the face that was hit. Without a hit the
 * sphere sits `reach` blocks in front of the camera.
 */
export function brushCenterFor(
  action: BrushAction,
  hit: BrushRayHit | null,
  cameraPosition: BlockPosition,
  viewDirection: BlockPosition,
  reach: number = BRUSH_REACH_BLOCKS,
): BlockPosition {
  if (hit) {
    const [cellX, cellY, cellZ] = hit.cell;
    if (action === "erase") return { x: cellX, y: cellY, z: cellZ };
    const [normalX, normalY, normalZ] = hit.faceNormal;
    return { x: cellX + normalX, y: cellY + normalY, z: cellZ + normalZ };
  }
  // Blocks are centered on integer coordinates (block x spans x - 0.5 .. x + 0.5).
  return {
    x: Math.round(cameraPosition.x + viewDirection.x * reach),
    y: Math.round(cameraPosition.y + viewDirection.y * reach),
    z: Math.round(cameraPosition.z + viewDirection.z * reach),
  };
}

/** A drag repaints only after the center moved a quarter radius, so holding still never reapplies the sphere. */
export function hasDragMovedEnough(previousCenter: BlockPosition | null, center: BlockPosition, radius: number): boolean {
  if (!previousCenter) return true;
  const distance = Math.hypot(center.x - previousCenter.x, center.y - previousCenter.y, center.z - previousCenter.z);
  return distance >= Math.max(1, radius * DRAG_STEP_FRACTION);
}
