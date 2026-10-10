// The numbers and small pure rules behind how the player moves: stances, what each block under the feet does to speed and
// grip, and the frame-rate independent easing every velocity change goes through. player-controls.ts applies them.

import { BlockType } from "./blocks";

export type Stance = "standing" | "crouching" | "prone";

export interface StanceShape {
  /** Height of the eyes above the feet. The body is this plus HEAD_CLEARANCE tall (see physics-engine.ts). */
  eyeHeight: number;
  /** Share of the walking speed this stance moves at. */
  speedFactor: number;
}

export const STANCE_SHAPES: Readonly<Record<Stance, StanceShape>> = {
  standing: { eyeHeight: 1.62, speedFactor: 1 },
  crouching: { eyeHeight: 1.42, speedFactor: 0.3 },
  prone: { eyeHeight: 0.4, speedFactor: 0.16 },
};

export const WALK_SPEED = 5;
export const SPRINT_SPEED_FACTOR = 1.45;
export const JUMP_SPEED = 9.5;
/** Each jump while steering adds this much speed along the keys, but never pushes the player past the cap. */
export const JUMP_FORWARD_BOOST = 3;
export const JUMP_FORWARD_SPEED_CAP = 9.5;
export const GRAVITY = 37.5;
/** Falling faster than this would pass through blocks; air drag caps the fall here. */
export const TERMINAL_FALL_SPEED = 55;

/** Per second rates at which velocity closes on the speed the player asks for; grip scales the ground ones. */
export const GROUND_ACCELERATION_RATE = 22;
export const GROUND_BRAKING_RATE = 18;
export const AIR_ACCELERATION_RATE = 14;
export const AIR_BRAKING_RATE = 0.6;
/** Rates at which speed above what the keys ask for (after a sprint, a fall, a flight) bleeds off while still steering. */
export const GROUND_COAST_RATE = 5;
export const AIR_COAST_RATE = 1.2;
export const SWIM_COAST_RATE = 2.5;

export const SWIM_SPEED = 3.2;
export const SWIM_SPRINT_FACTOR = 1.35;
export const SWIM_ACCELERATION_RATE = 7;
export const SWIM_BRAKING_RATE = 4;
export const SWIM_VERTICAL_SPEED = 3.4;
export const SWIM_VERTICAL_RATE = 8;
/** Highest ledge above the water surface a swimmer can climb out onto, in blocks. */
export const LEDGE_HEIGHT_ABOVE_SURFACE = 1.2;
/** Upward speed while climbing out onto a ledge, and the most of it kept once the feet clear the top. */
export const LEDGE_CLIMB_SPEED = 6;
export const LEDGE_CLEARED_HOP_SPEED = 3.5;
/** Share of gravity that buoyancy cancels at full submersion; the rest is a slow sink. */
export const BUOYANCY_SHARE = 0.94;
/** Per second drag on every axis at full submersion. */
export const WATER_DRAG_RATE = 3;
/** With nothing pressed the body drifts to this much submerged, which leaves the head just above the surface. */
export const FLOAT_SUBMERSION = 0.8;
/** Vertical speed per unit of submersion away from the floating depth, and how fast velocity follows it. */
export const FLOAT_GAIN = 6;
export const FLOAT_RATE = 6;
/** Submersion over which wading turns into swimming. */
export const SWIM_BLEND_START = 0.3;
export const SWIM_BLEND_END = 0.65;
/** Wading slows walking by this much at full submersion. */
export const WADING_SLOWDOWN = 0.35;

export const FLIGHT_BASE_SPEED = 10;
export const FLIGHT_SPEED_STEPS: readonly number[] = [0.3, 0.6, 1, 1.5, 2.5, 4, 7];
export const DEFAULT_FLIGHT_SPEED_INDEX = 3;
export const FLIGHT_BOOST_FACTOR = 2.5;
export const FLIGHT_ACCELERATION_RATE = 7;
export const FLIGHT_BRAKING_RATE = 6;

export const SPRINT_DOUBLE_TAP_SECONDS = 0.3;
export const JUMP_BUFFER_SECONDS = 0.12;
export const COYOTE_SECONDS = 0.1;
/** After touching down the player cannot jump again for this long, so holding jump does not bounce instantly. */
export const JUMP_LANDING_COOLDOWN_SECONDS = 0.3;

export interface SurfaceMovement {
  /** Multiplier on walking speed while standing on this block. */
  speedMultiplier: number;
  /** Multiplier on how fast velocity changes on the ground: 1 is a firm floor, near 0 is ice. */
  grip: number;
}

const FIRM_SURFACE: SurfaceMovement = { speedMultiplier: 1, grip: 1 };

const SURFACE_MOVEMENT: ReadonlyMap<BlockType, SurfaceMovement> = new Map<BlockType, SurfaceMovement>([
  [BlockType.ICE, { speedMultiplier: 1.02, grip: 0.08 }],
  [BlockType.PACKED_ICE, { speedMultiplier: 1.02, grip: 0.06 }],
  [BlockType.BLUE_ICE, { speedMultiplier: 1.04, grip: 0.04 }],
  [BlockType.SAND, { speedMultiplier: 0.88, grip: 0.9 }],
  [BlockType.RED_SAND, { speedMultiplier: 0.88, grip: 0.9 }],
  [BlockType.MUD, { speedMultiplier: 0.6, grip: 0.8 }],
  [BlockType.PACKED_MUD, { speedMultiplier: 0.95, grip: 1 }],
  [BlockType.SNOW_LAYER, { speedMultiplier: 0.85, grip: 0.7 }],
  [BlockType.SNOW_BLOCK, { speedMultiplier: 0.92, grip: 0.7 }],
  [BlockType.SNOW_SLAB, { speedMultiplier: 0.92, grip: 0.7 }],
  [BlockType.GRASS_SNOWY, { speedMultiplier: 0.92, grip: 0.75 }],
  [BlockType.MOSS, { speedMultiplier: 0.95, grip: 0.95 }],
  [BlockType.MOSS_CARPET, { speedMultiplier: 0.95, grip: 0.95 }],
  [BlockType.GRAVEL, { speedMultiplier: 0.95, grip: 1 }],
  [BlockType.COMPACT_GRAVEL, { speedMultiplier: 1, grip: 1 }],
  [BlockType.CLAY, { speedMultiplier: 0.9, grip: 0.85 }],
  [BlockType.PEAT, { speedMultiplier: 0.9, grip: 0.9 }],
  [BlockType.ASH, { speedMultiplier: 0.9, grip: 0.85 }],
  [BlockType.HAY_BLOCK, { speedMultiplier: 0.95, grip: 1 }],
  [BlockType.PLANKS, { speedMultiplier: 1.05, grip: 1 }],
  [BlockType.PLANKS_SLAB, { speedMultiplier: 1.05, grip: 1 }],
  [BlockType.PLANKS_SLAB_TOP, { speedMultiplier: 1.05, grip: 1 }],
]);

/** What standing on `block` does to movement; null (nothing known there) and plain blocks are a firm floor. */
export function getSurfaceMovement(block: BlockType | null): SurfaceMovement {
  if (block === null) return FIRM_SURFACE;
  return SURFACE_MOVEMENT.get(block) ?? FIRM_SURFACE;
}

/** Moves `current` towards `target`, closing the gap at `ratePerSecond`; the result never depends on the frame rate. */
export function approachExponentially(current: number, target: number, ratePerSecond: number, deltaSeconds: number): number {
  return target + (current - target) * Math.exp(-ratePerSecond * deltaSeconds);
}

export function smoothstep(start: number, end: number, value: number): number {
  const fraction = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return fraction * fraction * (3 - 2 * fraction);
}

export function lerp(start: number, end: number, fraction: number): number {
  return start + (end - start) * fraction;
}

/** 0 on land, 1 when fully swimming, from how much of the body is under water. */
export function swimBlendForSubmersion(submersion: number): number {
  return smoothstep(SWIM_BLEND_START, SWIM_BLEND_END, submersion);
}

/** The stance the player ends up in given what is held; flight and swimming stand the body up. */
export function desiredStance(params: { isFlying: boolean; isSwimming: boolean; wantsProne: boolean; wantsCrouch: boolean }): Stance {
  if (params.isFlying || params.isSwimming) return "standing";
  if (params.wantsProne) return "prone";
  if (params.wantsCrouch) return "crouching";
  return "standing";
}
