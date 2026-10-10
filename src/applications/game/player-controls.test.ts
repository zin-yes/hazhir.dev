import { beforeAll, describe, expect, test } from "bun:test";
import * as THREE from "three";
import { BlockType } from "./blocks";
import { PhysicsEngine } from "./physics-engine";
import { PlayerControls } from "./player-controls";

const FRAME_SECONDS = 1 / 60;

type BlockAt = (x: number, y: number, z: number) => BlockType | null;

beforeAll(() => {
  const fakeDocument = { addEventListener() {}, removeEventListener() {} };
  Object.assign(globalThis, { document: fakeDocument });
});

function look(camera: THREE.Camera, pitchRadians: number, yawRadians = -Math.PI / 2) {
  camera.quaternion.setFromEuler(new THREE.Euler(pitchRadians, yawRadians, 0, "YXZ"));
}

function createPlayer(getBlock: BlockAt, eyePosition: THREE.Vector3) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.copy(eyePosition);
  look(camera, 0);
  const domElement = { ownerDocument: { addEventListener() {}, removeEventListener() {} } } as unknown as HTMLElement;
  const player = new PlayerControls(camera, domElement, new PhysicsEngine(getBlock));
  player.controls.isLocked = true;
  return { player, camera };
}

function run(player: PlayerControls, seconds: number) {
  for (let frame = 0; frame < Math.round(seconds / FRAME_SECONDS); frame++) player.update(FRAME_SECONDS);
}

function horizontalSpeed(player: PlayerControls) {
  const velocity = (player as unknown as { velocity: THREE.Vector3 }).velocity;
  return Math.hypot(velocity.x, velocity.z);
}

/** Flat floor with its top at y = -0.5, made of `floorBlock`, open air above. */
function flatFloor(floorBlock: BlockType): BlockAt {
  return (_x, y) => (y <= -1 ? floorBlock : BlockType.AIR);
}

const STANDING_EYE_ON_FLOOR = 1.62 - 0.5;

describe("ground movement", () => {
  test("speed builds up over time instead of jumping to full", () => {
    const { player } = createPlayer(flatFloor(BlockType.STONE), new THREE.Vector3(0, STANDING_EYE_ON_FLOOR, 0));
    run(player, 0.2);
    player.setMoveState({ forward: true });
    run(player, 2 * FRAME_SECONDS);
    const earlySpeed = horizontalSpeed(player);
    run(player, 1);
    const settledSpeed = horizontalSpeed(player);

    expect(earlySpeed).toBeGreaterThan(0.5);
    expect(earlySpeed).toBeLessThan(3);
    expect(settledSpeed).toBeGreaterThan(4.7);
    expect(settledSpeed).toBeLessThan(5.3);
  });

  test("a runner stops quickly on stone but keeps sliding on ice", () => {
    const slideSpeedAfterRelease = (floorBlock: BlockType) => {
      const { player } = createPlayer(flatFloor(floorBlock), new THREE.Vector3(0, STANDING_EYE_ON_FLOOR, 0));
      run(player, 0.2);
      player.setMoveState({ forward: true });
      run(player, 1);
      player.setMoveState({ forward: false });
      run(player, 0.5);
      return horizontalSpeed(player);
    };

    expect(slideSpeedAfterRelease(BlockType.STONE)).toBeLessThan(0.5);
    expect(slideSpeedAfterRelease(BlockType.ICE)).toBeGreaterThan(2);
  });

  test("sand and mud are slower than stone", () => {
    const settledSpeedOn = (floorBlock: BlockType) => {
      const { player } = createPlayer(flatFloor(floorBlock), new THREE.Vector3(0, STANDING_EYE_ON_FLOOR, 0));
      run(player, 0.2);
      player.setMoveState({ forward: true });
      run(player, 1.5);
      return horizontalSpeed(player);
    };

    const stoneSpeed = settledSpeedOn(BlockType.STONE);
    expect(settledSpeedOn(BlockType.SAND)).toBeLessThan(stoneSpeed * 0.95);
    expect(settledSpeedOn(BlockType.MUD)).toBeLessThan(stoneSpeed * 0.7);
  });

  test("prone stays down under a ceiling too low to stand and gets up once it is gone", () => {
    let hasCeiling = true;
    const getBlock: BlockAt = (_x, y) => {
      if (y <= -1) return BlockType.STONE;
      if (hasCeiling && y >= 1) return BlockType.STONE;
      return BlockType.AIR;
    };
    const { player } = createPlayer(getBlock, new THREE.Vector3(0, STANDING_EYE_ON_FLOOR, 0));
    const bodyHeight = () => player.getPlayerBox().max.y - player.getPlayerBox().min.y;
    run(player, 0.3);

    player.toggleProne();
    run(player, 1);
    expect(bodyHeight()).toBeLessThan(0.7);

    player.toggleProne();
    run(player, 1);
    expect(bodyHeight()).toBeLessThan(0.7);

    hasCeiling = false;
    run(player, 1);
    expect(bodyHeight()).toBeGreaterThan(1.7);
  });
});

describe("flight", () => {
  test("flight speed steps change how fast it goes and it glides to a stop", () => {
    const flyAtStep = (stepsUp: number) => {
      const { player } = createPlayer(flatFloor(BlockType.STONE), new THREE.Vector3(0, 40, 0));
      player.setFlying(true);
      for (let step = 0; step < stepsUp; step++) player.adjustFlightSpeed(1);
      player.setMoveState({ forward: true });
      run(player, 2);
      return horizontalSpeed(player);
    };

    expect(flyAtStep(2)).toBeGreaterThan(flyAtStep(0) * 2);

    const { player } = createPlayer(flatFloor(BlockType.STONE), new THREE.Vector3(0, 40, 0));
    player.setFlying(true);
    player.setMoveState({ forward: true });
    run(player, 1.5);
    player.setMoveState({ forward: false });
    run(player, 0.05);
    expect(horizontalSpeed(player)).toBeGreaterThan(1);
    run(player, 2);
    expect(horizontalSpeed(player)).toBeLessThan(0.1);
  });
});

/** Water from y = -4 to 0 over a stone seabed; the bank starts at x = 3 and rises to `bankTopCell`. */
function pool(bankTopCell: number): BlockAt {
  return (x, y) => {
    if (y <= -5) return BlockType.STONE;
    if (x >= 3 && y <= bankTopCell) return BlockType.STONE;
    if (y <= 0) return BlockType.WATER;
    return BlockType.AIR;
  };
}

describe("water", () => {
  test("a diver with nothing pressed floats up and treads water with the head above the surface", () => {
    const { player, camera } = createPlayer(pool(0), new THREE.Vector3(0, -3, 0));
    run(player, 6);

    expect(camera.position.y).toBeGreaterThan(0.2);
    expect(camera.position.y).toBeLessThan(0.9);
  });

  test("swimming forward does not need the camera to look up or down", () => {
    const { player, camera } = createPlayer(pool(0), new THREE.Vector3(-4, 0.5, 0));
    look(camera, -1.2);
    run(player, 1);
    const heightBefore = camera.position.y;
    player.setMoveState({ forward: true });
    run(player, 2);

    expect(camera.position.x).toBeGreaterThan(-4 + 2);
    expect(Math.abs(camera.position.y - heightBefore)).toBeLessThan(0.3);
  });

  test("holding shift dives and jump rises back", () => {
    const { player, camera } = createPlayer(pool(0), new THREE.Vector3(0, 0.5, 0));
    run(player, 1);
    player.setMoveState({ down: true });
    run(player, 1.5);
    const divedTo = camera.position.y;
    player.setMoveState({ down: false, up: true });
    run(player, 1.5);

    expect(divedTo).toBeLessThan(-1.5);
    expect(camera.position.y).toBeGreaterThan(divedTo + 1.5);
  });

  test("holding jump and forward at the edge climbs out onto a bank just above the water", () => {
    const { player, camera } = createPlayer(pool(0), new THREE.Vector3(1.5, 0.5, 0));
    run(player, 1);
    player.setMoveState({ forward: true, up: true });
    run(player, 2.5);

    expect(camera.position.x).toBeGreaterThan(3);
    expect(player.getPlayerBox().min.y).toBeGreaterThan(0.4);
  });

  test("climbs out onto a bank a full block above the water, but not up a two block wall", () => {
    const climbsOut = (bankTopCell: number) => {
      const { player, camera } = createPlayer(pool(bankTopCell), new THREE.Vector3(1.5, 0.5, 0));
      run(player, 1);
      player.setMoveState({ forward: true, up: true });
      run(player, 2.5);
      return camera.position.x > 3;
    };

    expect(climbsOut(1)).toBe(true);
    expect(climbsOut(3)).toBe(false);
  });
});

function isGrounded(player: PlayerControls) {
  return (player as unknown as { canJump: boolean }).canJump;
}

describe("looking straight up or down", () => {
  test.each([Math.PI / 2, -Math.PI / 2])("forward still walks the way the player faces at pitch %f", (pitch) => {
    const { player, camera } = createPlayer(flatFloor(BlockType.STONE), new THREE.Vector3(0, STANDING_EYE_ON_FLOOR, 0));
    look(camera, pitch);
    run(player, 0.2);
    player.setMoveState({ forward: true });
    run(player, 1);

    expect(camera.position.x).toBeGreaterThan(2);
    expect(Math.abs(camera.position.z)).toBeLessThan(0.3);
  });
});

describe("jumping", () => {
  test("a jump leaves the ground on the very frame after landing", () => {
    const { player, camera } = createPlayer(flatFloor(BlockType.STONE), new THREE.Vector3(0, 6, 0));
    let frames = 0;
    while (!isGrounded(player) && frames < 240) {
      player.update(FRAME_SECONDS);
      frames++;
    }
    expect(isGrounded(player)).toBe(true);

    const heightOnLanding = camera.position.y;
    player.jump();
    player.update(FRAME_SECONDS);
    expect(camera.position.y - heightOnLanding).toBeGreaterThan(0.1);
  });

  test("a body falling onto the floor comes to rest on it within a few frames", () => {
    const { player, camera } = createPlayer(flatFloor(BlockType.STONE), new THREE.Vector3(0, 3, 0));
    run(player, 1.5);

    expect(isGrounded(player)).toBe(true);
    expect(camera.position.y - 1.62).toBeCloseTo(-0.5, 1);
  });

  test("jumping at a one block step from beside it climbs onto it", () => {
    const stepAtTwo: BlockAt = (x, y) => (y <= -1 || (x >= 2 && y <= 0) ? BlockType.STONE : BlockType.AIR);
    for (const startX of [0.5, 1.0, 1.19]) {
      const { player, camera } = createPlayer(stepAtTwo, new THREE.Vector3(startX, STANDING_EYE_ON_FLOOR, 0));
      run(player, 0.3);
      player.setMoveState({ forward: true, up: true });
      run(player, 2);

      expect(camera.position.x).toBeGreaterThan(1.8);
      expect(player.getPlayerBox().min.y).toBeGreaterThan(0.4);
    }
  });
});

describe("slabs and stairs", () => {
  const slabsFromTwoToFour: BlockAt = (x, y) => {
    if (y <= -1) return BlockType.STONE;
    if (y === 0 && x >= 2 && x <= 4) return BlockType.STONE_SLAB;
    return BlockType.AIR;
  };

  test("walking up and down a slab never leaves the ground and the camera glides over the step", () => {
    const { player, camera } = createPlayer(slabsFromTwoToFour, new THREE.Vector3(0, STANDING_EYE_ON_FLOOR, 0));
    run(player, 0.3);
    player.setMoveState({ forward: true });

    let airborneFrames = 0;
    let largestCameraJump = 0;
    let highestFeet = -Infinity;
    let previousHeight = camera.position.y;
    for (let frame = 0; frame < 180; frame++) {
      player.update(FRAME_SECONDS);
      if (!isGrounded(player)) airborneFrames++;
      largestCameraJump = Math.max(largestCameraJump, Math.abs(camera.position.y - previousHeight));
      highestFeet = Math.max(highestFeet, player.getPlayerBox().min.y);
      previousHeight = camera.position.y;
    }

    expect(camera.position.x).toBeGreaterThan(5);
    expect(highestFeet).toBeGreaterThan(-0.05);
    expect(airborneFrames).toBe(0);
    expect(largestCameraJump).toBeLessThan(0.2);
  });
});

describe("momentum", () => {
  test("running speed is not thrown away when flight is switched off", () => {
    const { player } = createPlayer(flatFloor(BlockType.STONE), new THREE.Vector3(0, 40, 0));
    player.setFlying(true);
    player.setMoveState({ forward: true });
    run(player, 2);
    const flyingSpeed = horizontalSpeed(player);
    player.toggleFlying();
    run(player, 0.1);

    expect(flyingSpeed).toBeGreaterThan(12);
    expect(horizontalSpeed(player)).toBeGreaterThan(flyingSpeed * 0.8);
  });

  test("letting go of sprint coasts down to walking speed instead of snapping to it", () => {
    const { player } = createPlayer(flatFloor(BlockType.STONE), new THREE.Vector3(0, STANDING_EYE_ON_FLOOR, 0));
    run(player, 0.2);
    player.setMoveState({ forward: true });
    (player as unknown as { sprintKeyHeld: boolean }).sprintKeyHeld = true;
    run(player, 1.5);
    const sprintSpeed = horizontalSpeed(player);
    (player as unknown as { sprintKeyHeld: boolean }).sprintKeyHeld = false;
    run(player, 0.1);
    const justAfter = horizontalSpeed(player);
    run(player, 2);

    expect(sprintSpeed).toBeGreaterThan(6.8);
    expect(justAfter).toBeGreaterThan(5.5);
    expect(horizontalSpeed(player)).toBeLessThan(5.3);
  });
});
