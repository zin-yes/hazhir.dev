// Decides, per cascade, whether its shadow map has to be redrawn this frame and names the reason, so the profiler can
// count why maps were redrawn or left alone.

import type * as THREE from "three";
import type { CascadeBox, Vector3Tuple } from "./shadow-cascades";

export interface CascadeDrawRecord {
  center: Vector3Tuple;
  halfExtent: number;
  light: THREE.Vector3;
  casterRevision: number;
  drawnAtMs: number;
}

export type CascadeRedrawDecision =
  | "firstDraw"
  | "boxMoved"
  | "lightTurned"
  | "casterSetChanged"
  | "throttledMoving"
  | "throttledCasterChange"
  | "upToDate";

/** Decisions that put the cascade in the queue of maps to redraw. */
export function isRedrawDecision(decision: CascadeRedrawDecision): boolean {
  return decision === "firstDraw" || decision === "boxMoved" || decision === "lightTurned" || decision === "casterSetChanged";
}

export interface CascadeRedrawInputs {
  previous: CascadeDrawRecord | null;
  box: CascadeBox;
  light: THREE.Vector3;
  casterRevision: number;
  nowMs: number;
  /** A moving camera or turning light redraws this cascade at most this often. */
  minMovingRedrawIntervalMs: number;
  casterChangeRedrawIntervalMs: number;
  /** Cosine of the angle the light has to turn before the map is redrawn. */
  lightTurnRedrawCosine: number;
}

export function decideCascadeRedraw(inputs: CascadeRedrawInputs): CascadeRedrawDecision {
  const { previous, box, light, nowMs } = inputs;
  if (!previous) return "firstDraw";
  const boxMoved =
    previous.halfExtent !== box.halfExtent ||
    previous.center[0] !== box.center[0] ||
    previous.center[1] !== box.center[1] ||
    previous.center[2] !== box.center[2];
  const lightTurned = previous.light.dot(light) < inputs.lightTurnRedrawCosine;
  const millisecondsSinceDraw = nowMs - previous.drawnAtMs;
  if (boxMoved || lightTurned) {
    if (millisecondsSinceDraw < inputs.minMovingRedrawIntervalMs) return "throttledMoving";
    return boxMoved ? "boxMoved" : "lightTurned";
  }
  if (previous.casterRevision === inputs.casterRevision) return "upToDate";
  if (millisecondsSinceDraw < inputs.casterChangeRedrawIntervalMs) return "throttledCasterChange";
  return "casterSetChanged";
}
