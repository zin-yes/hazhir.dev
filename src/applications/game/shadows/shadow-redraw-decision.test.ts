import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import type { CascadeBox } from "./shadow-cascades";
import {
  decideCascadeRedraw,
  isRedrawDecision,
  type CascadeDrawRecord,
  type CascadeRedrawInputs,
} from "./shadow-redraw-decision";

const noonLight = new THREE.Vector3(0.2, 0.95, 0.24).normalize();
const drawnBox: CascadeBox = { center: [1234.5, 88, -560.25], halfExtent: 61, texelWorldSize: 0.06 };

const lastDraw: CascadeDrawRecord = {
  center: [1234.5, 88, -560.25],
  halfExtent: 61,
  light: noonLight.clone(),
  casterRevision: 7,
  drawnAtMs: 10_000,
};

function inputs(overrides: Partial<CascadeRedrawInputs>): CascadeRedrawInputs {
  return {
    previous: lastDraw,
    box: drawnBox,
    light: noonLight.clone(),
    casterRevision: 7,
    nowMs: 10_500,
    minMovingRedrawIntervalMs: 200,
    casterChangeRedrawIntervalMs: 250,
    lightTurnRedrawCosine: Math.cos((0.25 * Math.PI) / 180),
    ...overrides,
  };
}

describe("decideCascadeRedraw", () => {
  test("a cascade that was never drawn is drawn", () => {
    expect(decideCascadeRedraw(inputs({ previous: null }))).toBe("firstDraw");
  });

  test("an unchanged view, light and caster set needs no redraw however long ago it was drawn", () => {
    expect(decideCascadeRedraw(inputs({ nowMs: 600_000 }))).toBe("upToDate");
  });

  test("a snapped box that moved redraws once the moving interval has passed, and waits before that", () => {
    const movedBox: CascadeBox = { ...drawnBox, center: [1234.5 + 0.96, 88, -560.25] };
    expect(decideCascadeRedraw(inputs({ box: movedBox, nowMs: 10_250 }))).toBe("boxMoved");
    expect(decideCascadeRedraw(inputs({ box: movedBox, nowMs: 10_100 }))).toBe("throttledMoving");
  });

  test("a resized box counts as moved", () => {
    expect(decideCascadeRedraw(inputs({ box: { ...drawnBox, halfExtent: 62 } }))).toBe("boxMoved");
  });

  test("a light that turned more than the threshold redraws a still camera", () => {
    const turnedLight = new THREE.Vector3(0.2, 0.95, 0.24).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.05).normalize();
    expect(decideCascadeRedraw(inputs({ light: turnedLight }))).toBe("lightTurned");
  });

  test("a light that turned less than the threshold does not", () => {
    const barelyTurned = noonLight.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.002).normalize();
    expect(decideCascadeRedraw(inputs({ light: barelyTurned }))).toBe("upToDate");
  });

  test("a changed caster set redraws only after the caster interval", () => {
    expect(decideCascadeRedraw(inputs({ casterRevision: 9, nowMs: 10_300 }))).toBe("casterSetChanged");
    expect(decideCascadeRedraw(inputs({ casterRevision: 9, nowMs: 10_100 }))).toBe("throttledCasterChange");
  });

  test("the first cascade has no moving interval, so it redraws the same frame the box moves", () => {
    const movedBox: CascadeBox = { ...drawnBox, center: [1235.5, 88, -560.25] };
    expect(decideCascadeRedraw(inputs({ box: movedBox, nowMs: 10_001, minMovingRedrawIntervalMs: 0 }))).toBe("boxMoved");
  });

  test("only the four redraw reasons queue a cascade for drawing", () => {
    const queued = (["firstDraw", "boxMoved", "lightTurned", "casterSetChanged"] as const).every(isRedrawDecision);
    const waiting = (["throttledMoving", "throttledCasterChange", "upToDate"] as const).some(isRedrawDecision);
    expect(queued).toBe(true);
    expect(waiting).toBe(false);
  });
});
