// The sphere brush's rules, free of input and rendering: radius limits, which mode a click means, where the sphere
// lands and when a drag has moved far enough to paint again.

import type { BlockPosition, BrushMode } from "../edits/block-edit-batch";
import { profiler } from "../profiler";

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
  if (!Number.isFinite(radius)) {
    profiler.addCounter("game.brush.radiusNotFinite");
    return BRUSH_DEFAULT_RADIUS;
  }
  const clamped = Math.min(BRUSH_MAXIMUM_RADIUS, Math.max(BRUSH_MINIMUM_RADIUS, Math.round(radius)));
  if (clamped !== radius) profiler.addCounter(clamped === Math.round(radius) ? "game.brush.radiusRounded" : "game.brush.radiusClamped");
  return clamped;
}

/** Radius steps grow with the radius, so [ and ] cover 1..64 in a handful of presses. */
export function steppedBrushRadius(radius: number, direction: 1 | -1): number {
  const step = radius >= 32 ? 8 : radius >= 16 ? 4 : radius >= 8 ? 2 : 1;
  const steppedRadius = clampBrushRadius(radius + direction * step);
  profiler.addCounter(direction === 1 ? "game.brush.radiusStepsUp" : "game.brush.radiusStepsDown");
  profiler.sampleGauge("game.brush.radius", steppedRadius, "blocks");
  return steppedRadius;
}

const BRUSH_MODE_COUNTERS: { [mode in BrushMode]: string } = {
  fill: "game.brush.mode.fill",
  erase: "game.brush.mode.erase",
  fillAirOnly: "game.brush.mode.fillAirOnly",
  replaceNonAirOnly: "game.brush.mode.replaceNonAirOnly",
};

export function brushModeFor(action: BrushAction, modifiers: BrushModifiers): BrushMode {
  const mode = chooseBrushMode(action, modifiers);
  profiler.addCounter(BRUSH_MODE_COUNTERS[mode]);
  return mode;
}

function chooseBrushMode(action: BrushAction, modifiers: BrushModifiers): BrushMode {
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
    profiler.addCounter(action === "erase" ? "game.brush.centerOnHitBlock" : "game.brush.centerBesideHitFace");
    const [cellX, cellY, cellZ] = hit.cell;
    if (action === "erase") return { x: cellX, y: cellY, z: cellZ };
    const [normalX, normalY, normalZ] = hit.faceNormal;
    return { x: cellX + normalX, y: cellY + normalY, z: cellZ + normalZ };
  }
  profiler.addCounter("game.brush.centerInFrontOfCamera");
  // Blocks are centered on integer coordinates (block x spans x - 0.5 .. x + 0.5).
  return {
    x: Math.round(cameraPosition.x + viewDirection.x * reach),
    y: Math.round(cameraPosition.y + viewDirection.y * reach),
    z: Math.round(cameraPosition.z + viewDirection.z * reach),
  };
}

/** A drag repaints only after the center moved a quarter radius, so holding still never reapplies the sphere. */
export function hasDragMovedEnough(previousCenter: BlockPosition | null, center: BlockPosition, radius: number): boolean {
  if (!previousCenter) {
    profiler.addCounter("game.brush.dragFirstPaint");
    return true;
  }
  const distance = Math.hypot(center.x - previousCenter.x, center.y - previousCenter.y, center.z - previousCenter.z);
  const requiredDistance = Math.max(1, radius * DRAG_STEP_FRACTION);
  const hasMovedEnough = distance >= requiredDistance;
  profiler.addCounter(hasMovedEnough ? "game.brush.dragRepaints" : "game.brush.dragSkipped");
  profiler.sampleGauge("game.brush.dragDistanceShareOfRequired", distance / requiredDistance, "ratio");
  return hasMovedEnough;
}
