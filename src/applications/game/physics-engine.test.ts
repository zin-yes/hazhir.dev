import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as THREE from "three";
import { BlockType } from "./blocks";
import { PhysicsEngine } from "./physics-engine";
import { profiler } from "./profiler";
import { DIMENSIONS } from "./profiler/dimensions";

const EYE_HEIGHT = 1.62;

/** Stone everywhere at y <= -1 for x up to 3; beyond x = 3 the chunk is not loaded. */
function getBlockOverStoneFloor(x: number, y: number): BlockType | null {
  if (x > 3) return null;
  return y <= -1 ? BlockType.STONE : BlockType.AIR;
}

function counterTotal(name: string) {
  return profiler.snapshot().counters.find((counter) => counter.name === name)?.total ?? 0;
}

describe("physics profiling", () => {
  beforeEach(() => {
    profiler.reset("physics-test");
    profiler.setEnabled(true);
  });
  afterEach(() => profiler.setEnabled(false));

  test("landing on a floor counts the blocked Y axis, one landing and the stone hitboxes tested", () => {
    const physics = new PhysicsEngine((x, y) => getBlockOverStoneFloor(x, y));
    const position = new THREE.Vector3(0, -0.45 + EYE_HEIGHT, 0);
    const velocity = new THREE.Vector3(0, -5, 0);
    const playerBox = new THREE.Box3();

    physics.resolveCollision(position, velocity, playerBox, 0.1, EYE_HEIGHT);

    expect(velocity.y).toBe(0);
    expect(counterTotal("game.physics.resolveCalls")).toBe(1);
    expect(counterTotal("game.physics.axisResolutions")).toBe(3);
    expect(counterTotal("game.physics.axisBlocked.y")).toBe(1);
    expect(counterTotal("game.physics.landings")).toBe(1);
    expect(counterTotal("game.physics.ceilingHits")).toBe(0);
    expect(counterTotal("game.physics.axisBlocked.x")).toBe(0);

    const stoneEntry = profiler
      .snapshot()
      .breakdowns.find((breakdown) => breakdown.dimension === DIMENSIONS.physicsBlock)
      ?.entries.find((entry) => entry.key === "STONE");
    expect(stoneEntry?.units).toBeGreaterThanOrEqual(1);
    expect(counterTotal("game.physics.collisionHits")).toBeGreaterThanOrEqual(1);
    expect(counterTotal("game.physics.nonCollidableSkipped")).toBeGreaterThanOrEqual(1);
  });

  test("walking into an unloaded chunk is a collision and is counted as one", () => {
    const physics = new PhysicsEngine((x, y) => getBlockOverStoneFloor(x, y));
    const position = new THREE.Vector3(3.4, -0.45 + EYE_HEIGHT, 0);
    const velocity = new THREE.Vector3(2, 0, 0);

    physics.resolveCollision(position, velocity, new THREE.Box3(), 0.1, EYE_HEIGHT);

    expect(counterTotal("game.physics.collisionUnloadedChunkHits")).toBeGreaterThanOrEqual(1);
    expect(counterTotal("game.physics.axisBlocked.x")).toBe(1);
    expect(position.x).toBeCloseTo(3.4, 5);
  });
});
