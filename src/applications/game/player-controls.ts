import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import type { BlockType } from "./blocks";
import { countInputEvent, finishInputEvent, startInputEvent } from "./input-profiling";
import { MAXIMUM_STEP_HEIGHT, PhysicsEngine } from "./physics-engine";
import {
  AIR_ACCELERATION_RATE,
  AIR_BRAKING_RATE,
  AIR_COAST_RATE,
  approachExponentially,
  BUOYANCY_SHARE,
  COYOTE_SECONDS,
  DEFAULT_FLIGHT_SPEED_INDEX,
  desiredStance,
  FLIGHT_ACCELERATION_RATE,
  FLIGHT_BASE_SPEED,
  FLIGHT_BOOST_FACTOR,
  FLIGHT_BRAKING_RATE,
  FLIGHT_SPEED_STEPS,
  FLOAT_GAIN,
  FLOAT_RATE,
  FLOAT_SUBMERSION,
  getSurfaceMovement,
  GRAVITY,
  GROUND_ACCELERATION_RATE,
  GROUND_BRAKING_RATE,
  GROUND_COAST_RATE,
  JUMP_BUFFER_SECONDS,
  JUMP_FORWARD_BOOST,
  JUMP_FORWARD_SPEED_CAP,
  JUMP_LANDING_COOLDOWN_SECONDS,
  JUMP_SPEED,
  LEDGE_CLEARED_HOP_SPEED,
  LEDGE_CLIMB_SPEED,
  LEDGE_HEIGHT_ABOVE_SURFACE,
  lerp,
  SPRINT_DOUBLE_TAP_SECONDS,
  SPRINT_SPEED_FACTOR,
  STANCE_SHAPES,
  type Stance,
  SWIM_ACCELERATION_RATE,
  SWIM_BRAKING_RATE,
  SWIM_COAST_RATE,
  SWIM_SPEED,
  SWIM_SPRINT_FACTOR,
  SWIM_VERTICAL_RATE,
  SWIM_VERTICAL_SPEED,
  swimBlendForSubmersion,
  TERMINAL_FALL_SPEED,
  WADING_SLOWDOWN,
  WALK_SPEED,
  WATER_DRAG_RATE,
} from "./player-movement";
import { profiler } from "./profiler";
import { DIMENSIONS } from "./profiler/dimensions";

/** A frame longer than this (a hitch, a background tab) is simulated as this long, so nobody falls through the floor. */
const MAXIMUM_FRAME_SECONDS = 0.05;
/** No single physics step moves the body further than this, so fast falls cannot skip a block. */
const MAXIMUM_STEP_BLOCKS = 0.4;
const MAXIMUM_PHYSICS_STEPS = 4;
const EYE_HEIGHT_RATE = 12;
/** Swimming up eases to a stop over this much submersion above the floating depth, so holding jump never launches out of the water. */
const RISE_EASE_SUBMERSION = 0.1;
/** Climbing out only starts with the eyes this close to the surface, so a wall far below never speeds up a dive. */
const LEDGE_CLIMB_EYE_DEPTH_BLOCKS = 0.9;
const STANCE_RISE_ORDER: Readonly<Record<Stance, readonly Stance[]>> = {
  standing: ["standing", "crouching", "prone"],
  crouching: ["crouching", "prone"],
  prone: ["prone"],
};

/** Steps smaller than this are not worth smoothing. */
const STEP_SMOOTHING_MINIMUM_BLOCKS = 0.04;
const STEP_SMOOTHING_RATE = 13;
/** Speed over what the keys ask for before the excess coasts off slowly instead of being steered away. */
const COAST_MARGIN_SPEED = 0.3;
const BOB_STRIDE_RADIANS_PER_BLOCK = 1.6;
const BOB_VERTICAL_BLOCKS = 0.03;
const BOB_SIDEWAYS_BLOCKS = 0.022;
const BOB_AMPLITUDE_RATE = 10;
const BOB_STANCE_SCALE: Readonly<Record<Stance, number>> = { standing: 1, crouching: 0.6, prone: 0.25 };
const LANDING_DIP_MINIMUM_SPEED = 7;
const LANDING_DIP_BLOCKS_PER_SPEED = 0.01;
const LANDING_DIP_MAXIMUM_BLOCKS = 0.16;
const LANDING_DIP_RATE = 9;

export class PlayerControls {
  public controls: PointerLockControls;
  private physics: PhysicsEngine;

  private velocity = new THREE.Vector3();

  private moveForward = false;
  private moveBackward = false;
  private moveLeft = false;
  private moveRight = false;
  private moveUp = false;
  private moveDown = false;
  private canJump = false;
  private isFlying = false;
  private isShifting = false;
  private isProne = false;
  private sprintKeyHeld = false;
  private sprintLatchedByDoubleTap = false;
  private lastForwardTapAtMilliseconds = -Infinity;
  public isMobile = false;
  private lookSensitivity = 1;

  private stance: Stance = "standing";
  private currentEyeHeight = STANCE_SHAPES.standing.eyeHeight;
  private jumpBufferSeconds = 0;
  private coyoteSeconds = 0;
  private jumpCooldownSeconds = 0;
  private supportingBlock: BlockType | null = null;
  private isClimbingLedge = false;
  /** The water surface the climb started from, kept while the body rises out of the water. */
  private ledgeWaterSurfaceHeight = 0;
  private flightSpeedIndex = DEFAULT_FLIGHT_SPEED_INDEX;
  /** Called with the new flight speed multiplier whenever it changes. */
  public onFlightSpeedChange: ((multiplier: number) => void) | null = null;

  private isViewBobbingEnabled = true;
  private bobPhase = 0;
  private bobAmplitude = 0;
  private landingDip = 0;
  /** Camera height still owed after stepping up or down a stair or slab, eased back to zero. */
  private stepSmoothing = 0;
  private readonly appliedBobOffset = new THREE.Vector3();

  private readonly forwardScratch = new THREE.Vector3();
  private readonly rightScratch = new THREE.Vector3();
  private readonly wishScratch = new THREE.Vector3();
  private readonly upScratch = new THREE.Vector3();

  private playerBox = new THREE.Box3();

  public getPlayerBox() {
    return this.playerBox;
  }

  /** Whether the player is flying, so the wheel can steer flight speed instead of the hotbar. */
  /** Where the eyes are without the walking sway and step smoothing; what the shadow maps should follow. */
  public readonly stableEyePosition = new THREE.Vector3();

  public get flightActive() {
    return this.isFlying;
  }

  constructor(
    camera: THREE.Camera,
    domElement: HTMLElement,
    physics: PhysicsEngine
  ) {
    this.controls = new PointerLockControls(camera, domElement);
    this.physics = physics;

    this.initInputListeners();

    this.controls.addEventListener("lock", () => countInputEvent("pointerLock"));
    this.controls.addEventListener("change", () => countInputEvent("mouseMove"));
    this.controls.addEventListener("unlock", () => {
      countInputEvent("pointerUnlock");
      this.moveForward = false;
      this.moveBackward = false;
      this.moveLeft = false;
      this.moveRight = false;
      this.moveUp = false;
      this.moveDown = false;
      this.isShifting = false;
      this.sprintKeyHeld = false;
      this.sprintLatchedByDoubleTap = false;
      this.canJump = false;
    });
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (!this.controls.isLocked) {
      profiler.addCounter("game.input.keyDownsIgnored");
      return;
    }
    const startedAtMs = startInputEvent();
    try {
      this.handleKeyDown(event);
    } finally {
      finishInputEvent("keyDown", startedAtMs);
    }
  };

  private handleKeyDown(event: KeyboardEvent) {
    profiler.addCounter("game.input.keyDown");

    switch (event.code) {
      case "ArrowUp":
      case "KeyW":
        if (!event.repeat) this.registerForwardTap();
        this.moveForward = true;
        break;
      case "ArrowLeft":
      case "KeyA":
        this.moveLeft = true;
        break;
      case "ArrowDown":
      case "KeyS":
        this.moveBackward = true;
        break;
      case "ArrowRight":
      case "KeyD":
        this.moveRight = true;
        break;
      case "Space":
        this.pressJump();
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.isShifting = true;
        this.moveDown = true;
        break;
      case "ControlLeft":
      case "ControlRight":
        this.sprintKeyHeld = true;
        break;
      case "KeyZ":
        if (!event.repeat) this.toggleProne();
        break;
      case "KeyV":
        this.toggleFlying();
        break;
    }
  }

  private onKeyUp = (event: KeyboardEvent) => {
    const startedAtMs = startInputEvent();
    try {
      this.handleKeyUp(event);
    } finally {
      finishInputEvent("keyUp", startedAtMs);
    }
  };

  private handleKeyUp(event: KeyboardEvent) {
    switch (event.code) {
      case "ArrowUp":
      case "KeyW":
        this.moveForward = false;
        this.sprintLatchedByDoubleTap = false;
        break;
      case "ArrowLeft":
      case "KeyA":
        this.moveLeft = false;
        break;
      case "ArrowDown":
      case "KeyS":
        this.moveBackward = false;
        break;
      case "ArrowRight":
      case "KeyD":
        this.moveRight = false;
        break;
      case "Space":
        this.moveUp = false;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.isShifting = false;
        this.moveDown = false;
        break;
      case "ControlLeft":
      case "ControlRight":
        this.sprintKeyHeld = false;
        break;
    }
  }

  private initInputListeners() {
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
  }

  /** A second press of forward within a short time latches sprint until forward is released. */
  private registerForwardTap() {
    const nowMilliseconds = performance.now();
    if (nowMilliseconds - this.lastForwardTapAtMilliseconds < SPRINT_DOUBLE_TAP_SECONDS * 1000) {
      this.sprintLatchedByDoubleTap = true;
    }
    this.lastForwardTapAtMilliseconds = nowMilliseconds;
  }

  private pressJump() {
    this.moveUp = true;
    this.jumpBufferSeconds = JUMP_BUFFER_SECONDS;
  }

  public setMoveState(state: {
    forward?: boolean;
    backward?: boolean;
    left?: boolean;
    right?: boolean;
    up?: boolean;
    down?: boolean;
    shifting?: boolean;
  }) {
    if (state.forward !== undefined) this.moveForward = state.forward;
    if (state.backward !== undefined) this.moveBackward = state.backward;
    if (state.left !== undefined) this.moveLeft = state.left;
    if (state.right !== undefined) this.moveRight = state.right;
    if (state.up !== undefined) this.moveUp = state.up;
    if (state.down !== undefined) this.moveDown = state.down;
    if (state.shifting !== undefined) this.isShifting = state.shifting;
  }

  /** Scales both mouse and touch look; 1 is the original speed. */
  public setLookSensitivity(multiplier: number) {
    this.lookSensitivity = multiplier;
    this.controls.pointerSpeed = multiplier;
  }

  public setViewBobbingEnabled(isEnabled: boolean) {
    this.isViewBobbingEnabled = isEnabled;
  }

  public rotateCamera(deltaX: number, deltaY: number) {
    profiler.addCounter("game.input.cameraRotations");
    profiler.addCounter(
      "game.input.cameraRotationPixels",
      Math.abs(deltaX) + Math.abs(deltaY),
      "pixels",
    );
    const euler = new THREE.Euler(0, 0, 0, "YXZ");
    euler.setFromQuaternion(this.controls.object.quaternion);
    euler.y -= deltaX * 0.003 * this.lookSensitivity;
    euler.x -= deltaY * 0.003 * this.lookSensitivity;
    euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.x));
    this.controls.object.quaternion.setFromEuler(euler);
  }

  public jump() {
    profiler.addCounter("game.input.jumps");
    this.pressJump();
  }

  public resetMotion() {
    this.velocity.set(0, 0, 0);
    this.moveForward = false;
    this.moveBackward = false;
    this.moveLeft = false;
    this.moveRight = false;
    this.moveUp = false;
    this.moveDown = false;
    this.sprintLatchedByDoubleTap = false;
    this.jumpBufferSeconds = 0;
    this.removeViewBob();
    this.bobAmplitude = 0;
    this.landingDip = 0;
  }

  public stopJump() {
    this.moveUp = false;
  }

  public setFlying(flying: boolean) {
    this.isFlying = flying;
    this.velocity.set(0, 0, 0);
  }

  public toggleFlying() {
    profiler.addCounter("game.input.flyToggles");
    this.isFlying = !this.isFlying;
    if (this.isFlying) this.isProne = false;
  }

  /** Lies down, or gets up when already lying; standing up waits for headroom (see updateStance). */
  public toggleProne() {
    profiler.addCounter("game.input.proneToggles");
    if (this.isFlying) return;
    this.isProne = !this.isProne;
  }

  /** Steps the flight speed up (1) or down (-1) through FLIGHT_SPEED_STEPS. */
  public adjustFlightSpeed(direction: 1 | -1) {
    const nextIndex = Math.min(
      FLIGHT_SPEED_STEPS.length - 1,
      Math.max(0, this.flightSpeedIndex + direction),
    );
    if (nextIndex === this.flightSpeedIndex) return;
    this.flightSpeedIndex = nextIndex;
    this.onFlightSpeedChange?.(FLIGHT_SPEED_STEPS[nextIndex]!);
  }

  public dispose() {
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    this.controls.dispose();
  }

  public update(delta: number) {
    const movementMode = this.isFlying
      ? "player.fly"
      : this.canJump
        ? "player.walk"
        : "player.airborne";
    const scopeToken = profiler.begin(
      "main.player.update",
      DIMENSIONS.simulationSystem,
      movementMode,
    );
    try {
      this.updateMovement(Math.min(delta, MAXIMUM_FRAME_SECONDS));
      this.stableEyePosition.copy(this.controls.object.position).sub(this.appliedBobOffset);
    } finally {
      profiler.end(scopeToken);
    }
  }

  private updateMovement(deltaSeconds: number) {
    if (profiler.enabled) this.countFrameState();
    const position = this.controls.object.position;
    this.removeViewBob();
    const isSteerable = this.controls.isLocked || this.isMobile;

    const submersion = this.isFlying
      ? 0
      : this.physics.getWaterSubmersion(position, this.currentEyeHeight);
    const swimBlend = swimBlendForSubmersion(submersion);
    if (swimBlend > 0.5) this.isProne = false;

    this.updateStance(deltaSeconds, swimBlend > 0.5);

    if (this.isFlying) {
      this.updateFlight(deltaSeconds, isSteerable);
      return;
    }

    this.updateWalkingAndSwimming(deltaSeconds, isSteerable, submersion, swimBlend);
  }

  /** Picks the stance that is wanted and fits, then eases the eyes to it with the feet staying planted. */
  private updateStance(deltaSeconds: number, isSwimming: boolean) {
    const position = this.controls.object.position;
    const wantedStance = desiredStance({
      isFlying: this.isFlying,
      isSwimming,
      wantsProne: this.isProne,
      wantsCrouch: this.isShifting,
    });
    this.stance = this.stanceThatFits(wantedStance);

    const lastEyeHeight = this.currentEyeHeight;
    this.currentEyeHeight = approachExponentially(
      lastEyeHeight,
      STANCE_SHAPES[this.stance].eyeHeight,
      EYE_HEIGHT_RATE,
      deltaSeconds,
    );
    position.y += this.currentEyeHeight - lastEyeHeight;
  }

  /** The wanted stance, or the tallest lower one that fits when the wanted one would put the head into a block. */
  private stanceThatFits(wantedStance: Stance): Stance {
    const position = this.controls.object.position;
    for (const candidate of STANCE_RISE_ORDER[wantedStance]) {
      const candidateEyeHeight = STANCE_SHAPES[candidate].eyeHeight;
      const isRising = candidateEyeHeight > this.currentEyeHeight + 0.01;
      if (!isRising) return candidate;
      if (this.physics.isStanceClear(position, this.currentEyeHeight, candidateEyeHeight)) return candidate;
    }
    return this.stance;
  }

  private isSprintHeld(): boolean {
    return this.sprintKeyHeld || this.sprintLatchedByDoubleTap;
  }

  /**
   * Writes the horizontal direction the player faces into forwardScratch and the way their right hand points into
   * rightScratch. Taken from both the view direction and the camera's up direction, so it stays steady when looking
   * straight up or down, where the view direction alone has no horizontal part left.
   */
  private readFacing() {
    const forward = this.forwardScratch;
    const right = this.rightScratch;
    const object = this.controls.object;
    object.getWorldDirection(forward);
    const lookHeight = forward.y;
    const lookReach = Math.hypot(forward.x, forward.z);
    const up = this.upScratch.set(0, 1, 0).applyQuaternion(object.quaternion);
    forward.set(
      forward.x * lookReach - up.x * lookHeight,
      0,
      forward.z * lookReach - up.z * lookHeight,
    );
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
    forward.normalize();
    right.set(-forward.z, 0, forward.x);
  }

  /** Writes the horizontal wish direction (unit length, or zero) of the held keys into wishScratch. */
  private readHorizontalWish(): THREE.Vector3 {
    this.readFacing();
    const forward = this.forwardScratch;
    const right = this.rightScratch;
    const wish = this.wishScratch.set(0, 0, 0);
    if (this.moveForward) wish.add(forward);
    if (this.moveBackward) wish.sub(forward);
    if (this.moveRight) wish.add(right);
    if (this.moveLeft) wish.sub(right);
    if (wish.lengthSq() > 0) wish.normalize();
    return wish;
  }

  private updateFlight(deltaSeconds: number, isSteerable: boolean) {
    const position = this.controls.object.position;
    const wish = isSteerable ? this.readHorizontalWish() : this.wishScratch.set(0, 0, 0);
    if (isSteerable) {
      if (this.moveUp) wish.y += 1;
      if (this.moveDown) wish.y -= 1;
      if (wish.lengthSq() > 0) wish.normalize();
    }
    const hasInput = wish.lengthSq() > 0;
    const boost = this.isSprintHeld() ? FLIGHT_BOOST_FACTOR : 1;
    const speed = FLIGHT_BASE_SPEED * FLIGHT_SPEED_STEPS[this.flightSpeedIndex]! * boost;
    const rate = hasInput ? FLIGHT_ACCELERATION_RATE : FLIGHT_BRAKING_RATE;

    this.velocity.x = approachExponentially(this.velocity.x, wish.x * speed, rate, deltaSeconds);
    this.velocity.y = approachExponentially(this.velocity.y, wish.y * speed, rate, deltaSeconds);
    this.velocity.z = approachExponentially(this.velocity.z, wish.z * speed, rate, deltaSeconds);

    position.addScaledVector(this.velocity, deltaSeconds);
    this.physics.updatePlayerBox(this.playerBox, position, this.currentEyeHeight);
    this.bobAmplitude = 0;
  }

  private updateWalkingAndSwimming(
    deltaSeconds: number,
    isSteerable: boolean,
    submersion: number,
    swimBlend: number,
  ) {
    const position = this.controls.object.position;
    if (submersion > 0) profiler.addCounter("game.player.frames.swim");
    if (this.stance === "prone") profiler.addCounter("game.player.frames.prone");

    const wish = isSteerable ? this.readHorizontalWish() : this.wishScratch.set(0, 0, 0);
    const hasInput = wish.lengthSq() > 0;
    const isSprinting =
      hasInput && this.moveForward && !this.moveBackward && this.stance === "standing" && this.isSprintHeld();

    this.updateHorizontalVelocity(deltaSeconds, wish, hasInput, isSprinting, submersion, swimBlend);
    this.updateVerticalVelocity(deltaSeconds, wish, isSteerable, submersion, swimBlend);

    const fallSpeedBeforeCollision = this.velocity.y;
    const wasGrounded = this.canJump;
    const heightBeforeMove = position.y;
    this.moveWithCollisions(deltaSeconds);

    const isRisingOrJumping = fallSpeedBeforeCollision > 0;
    if (wasGrounded && !isRisingOrJumping) {
      const liftedByStep = position.y - heightBeforeMove - fallSpeedBeforeCollision * deltaSeconds;
      if (liftedByStep > STEP_SMOOTHING_MINIMUM_BLOCKS) this.stepSmoothing -= liftedByStep;
    }

    let isGrounded = this.physics.isOnGround(position, this.currentEyeHeight) && this.velocity.y <= 0;
    if (!isGrounded && wasGrounded && !isRisingOrJumping && swimBlend < 0.5) {
      const drop = this.physics.snapDownToGround(position, this.playerBox, this.currentEyeHeight, MAXIMUM_STEP_HEIGHT);
      if (drop > 0) {
        this.stepSmoothing += drop;
        this.velocity.y = 0;
        isGrounded = true;
      }
    }
    this.canJump = isGrounded;
    if (isGrounded) {
      this.velocity.y = 0;
      this.supportingBlock = this.physics.getSupportingBlock(position, this.currentEyeHeight);
      if (!wasGrounded) {
        this.jumpCooldownSeconds = JUMP_LANDING_COOLDOWN_SECONDS;
        this.dipCameraForLanding(fallSpeedBeforeCollision);
      }
    }
    profiler.addCounter(isGrounded ? "game.player.frames.walk" : "game.player.frames.airborne");

    this.applyViewBob(deltaSeconds, isSteerable && swimBlend < 0.3, isGrounded);
  }

  private updateHorizontalVelocity(
    deltaSeconds: number,
    wish: THREE.Vector3,
    hasInput: boolean,
    isSprinting: boolean,
    submersion: number,
    swimBlend: number,
  ) {
    const surface = getSurfaceMovement(this.supportingBlock);
    const landSpeed =
      WALK_SPEED *
      STANCE_SHAPES[this.stance].speedFactor *
      surface.speedMultiplier *
      (isSprinting ? SPRINT_SPEED_FACTOR : 1) *
      (1 - WADING_SLOWDOWN * submersion);
    const swimSpeed = SWIM_SPEED * (isSprinting ? SWIM_SPRINT_FACTOR : 1);
    const speed = lerp(landSpeed, swimSpeed, swimBlend);

    const isFasterThanAsked = hasInput && Math.hypot(this.velocity.x, this.velocity.z) > speed + COAST_MARGIN_SPEED;
    const groundRate = isFasterThanAsked
      ? GROUND_COAST_RATE
      : hasInput
        ? GROUND_ACCELERATION_RATE
        : GROUND_BRAKING_RATE;
    const airRate = isFasterThanAsked ? AIR_COAST_RATE : hasInput ? AIR_ACCELERATION_RATE : AIR_BRAKING_RATE;
    const landRate = this.canJump ? groundRate * surface.grip : airRate;
    const swimRate = isFasterThanAsked ? SWIM_COAST_RATE : hasInput ? SWIM_ACCELERATION_RATE : SWIM_BRAKING_RATE;
    const rate = lerp(landRate, swimRate, swimBlend);

    this.velocity.x = approachExponentially(this.velocity.x, wish.x * speed, rate, deltaSeconds);
    this.velocity.z = approachExponentially(this.velocity.z, wish.z * speed, rate, deltaSeconds);
  }

  private updateVerticalVelocity(
    deltaSeconds: number,
    wish: THREE.Vector3,
    isSteerable: boolean,
    submersion: number,
    swimBlend: number,
  ) {
    this.jumpBufferSeconds = Math.max(0, this.jumpBufferSeconds - deltaSeconds);
    this.jumpCooldownSeconds = Math.max(0, this.jumpCooldownSeconds - deltaSeconds);
    this.coyoteSeconds = this.canJump ? COYOTE_SECONDS : Math.max(0, this.coyoteSeconds - deltaSeconds);

    if (this.climbOutOfWaterOntoLedge(isSteerable, swimBlend)) return;

    this.velocity.y -= GRAVITY * (1 - BUOYANCY_SHARE * swimBlend) * deltaSeconds;
    this.velocity.y = Math.max(this.velocity.y, -TERMINAL_FALL_SPEED);
    if (submersion > 0) {
      this.velocity.y *= Math.exp(-WATER_DRAG_RATE * submersion * deltaSeconds);
    }

    if (swimBlend > 0) {
      this.steerVerticallyInWater(deltaSeconds, isSteerable, submersion, swimBlend);
      return;
    }
    if (!isSteerable) return;

    if (this.stance === "prone" && this.jumpBufferSeconds > 0) {
      this.isProne = false;
      this.jumpBufferSeconds = 0;
      return;
    }
    const wantsJump = this.jumpBufferSeconds > 0 || this.moveUp;
    if (wantsJump && this.coyoteSeconds > 0 && this.jumpCooldownSeconds === 0 && this.stance !== "prone") {
      this.velocity.y = JUMP_SPEED * (1 - 0.25 * submersion);
      this.hopForward(wish);
      this.canJump = false;
      this.coyoteSeconds = 0;
      this.jumpBufferSeconds = 0;
    }
  }

  /** Kicks the player a little along the keys they hold; the speed it adds stops at the cap and never trims a faster run. */
  private hopForward(wish: THREE.Vector3) {
    if (wish.lengthSq() === 0) return;
    const speedBeforeHop = Math.hypot(this.velocity.x, this.velocity.z);
    this.velocity.x += wish.x * JUMP_FORWARD_BOOST;
    this.velocity.z += wish.z * JUMP_FORWARD_BOOST;
    const speedLimit = Math.max(JUMP_FORWARD_SPEED_CAP, speedBeforeHop);
    const speedAfterHop = Math.hypot(this.velocity.x, this.velocity.z);
    if (speedAfterHop > speedLimit) {
      const scale = speedLimit / speedAfterHop;
      this.velocity.x *= scale;
      this.velocity.z *= scale;
    }
  }

  /**
   * Holding jump against a ledge while swimming lifts the body up its face and over the top. Returns whether it is
   * climbing this frame (gravity and drag are skipped then). Once the feet clear the top, a small hop carries on.
   */
  private climbOutOfWaterOntoLedge(isSteerable: boolean, swimBlend: number): boolean {
    const position = this.controls.object.position;
    let isClimbing = false;
    if (isSteerable && this.moveUp && (swimBlend > 0 || this.isClimbingLedge)) {
      const liveSurfaceHeight = this.physics.getWaterSurfaceHeight(position, this.currentEyeHeight);
      if (liveSurfaceHeight !== null) this.ledgeWaterSurfaceHeight = liveSurfaceHeight;
      const surfaceHeight = liveSurfaceHeight ?? (this.isClimbingLedge ? this.ledgeWaterSurfaceHeight : null);
      const isNearSurface =
        surfaceHeight !== null && (this.isClimbingLedge || position.y > surfaceHeight - LEDGE_CLIMB_EYE_DEPTH_BLOCKS);
      if (surfaceHeight !== null && isNearSurface) {
        const direction = this.readHorizontalWish();
        if (direction.lengthSq() === 0) direction.copy(this.forwardScratch);
        isClimbing = this.physics.canClimbOntoLedge(
          position,
          this.currentEyeHeight,
          direction.x,
          direction.z,
          surfaceHeight,
          LEDGE_HEIGHT_ABOVE_SURFACE,
        );
      }
    }
    if (isClimbing) {
      this.velocity.y = LEDGE_CLIMB_SPEED;
    } else if (this.isClimbingLedge) {
      this.velocity.y = Math.min(this.velocity.y, LEDGE_CLEARED_HOP_SPEED);
    }
    this.isClimbingLedge = isClimbing;
    return isClimbing;
  }

  /** Swimming up, down and treading water: held keys pick a vertical speed, otherwise the body floats at the surface. */
  private steerVerticallyInWater(
    deltaSeconds: number,
    isSteerable: boolean,
    submersion: number,
    swimBlend: number,
  ) {
    const position = this.controls.object.position;
    let targetSpeed: number | null = null;
    if (isSteerable && this.moveUp) {
      const risingShare = Math.min(1, Math.max(0, (submersion - FLOAT_SUBMERSION) / RISE_EASE_SUBMERSION));
      targetSpeed = SWIM_VERTICAL_SPEED * risingShare;
    } else if (isSteerable && this.moveDown) {
      targetSpeed = -SWIM_VERTICAL_SPEED;
    }

    if (targetSpeed !== null) {
      this.velocity.y = approachExponentially(this.velocity.y, targetSpeed, SWIM_VERTICAL_RATE * swimBlend, deltaSeconds);
      return;
    }
    const floatingSpeed = (submersion - FLOAT_SUBMERSION) * FLOAT_GAIN;
    this.velocity.y = approachExponentially(this.velocity.y, floatingSpeed, FLOAT_RATE * swimBlend, deltaSeconds);
  }

  /** Moves the body by its velocity in as many physics steps as its speed needs to never skip a block. */
  private moveWithCollisions(deltaSeconds: number) {
    const position = this.controls.object.position;
    const fastestAxis = Math.max(Math.abs(this.velocity.x), Math.abs(this.velocity.y), Math.abs(this.velocity.z));
    const stepCount = Math.min(
      MAXIMUM_PHYSICS_STEPS,
      Math.max(1, Math.ceil((fastestAxis * deltaSeconds) / MAXIMUM_STEP_BLOCKS)),
    );
    const stepSeconds = deltaSeconds / stepCount;
    for (let step = 0; step < stepCount; step++) {
      this.physics.resolveCollision(
        position,
        this.velocity,
        this.playerBox,
        stepSeconds,
        this.currentEyeHeight,
        this.stance === "crouching",
      );
    }
  }

  private dipCameraForLanding(fallSpeed: number) {
    const impactSpeed = -fallSpeed;
    if (impactSpeed < LANDING_DIP_MINIMUM_SPEED) return;
    this.landingDip = Math.min(
      LANDING_DIP_MAXIMUM_BLOCKS,
      this.landingDip + impactSpeed * LANDING_DIP_BLOCKS_PER_SPEED,
    );
  }

  /** Sways the camera with the stride and dips it on landing; the offset is undone at the start of the next update. */
  private applyViewBob(deltaSeconds: number, isWalkingFree: boolean, isGrounded: boolean) {
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const strideAmount =
      this.isViewBobbingEnabled && isWalkingFree && isGrounded
        ? Math.min(horizontalSpeed / WALK_SPEED, 1.5) * BOB_STANCE_SCALE[this.stance]
        : 0;
    this.bobAmplitude = approachExponentially(this.bobAmplitude, strideAmount, BOB_AMPLITUDE_RATE, deltaSeconds);
    if (isGrounded) this.bobPhase += horizontalSpeed * deltaSeconds * BOB_STRIDE_RADIANS_PER_BLOCK;
    this.landingDip = approachExponentially(this.landingDip, 0, LANDING_DIP_RATE, deltaSeconds);

    this.stepSmoothing = approachExponentially(this.stepSmoothing, 0, STEP_SMOOTHING_RATE, deltaSeconds);

    const verticalOffset =
      Math.sin(this.bobPhase * 2) * BOB_VERTICAL_BLOCKS * this.bobAmplitude - this.landingDip + this.stepSmoothing;
    const sidewaysOffset = Math.cos(this.bobPhase) * BOB_SIDEWAYS_BLOCKS * this.bobAmplitude;
    if (verticalOffset === 0 && sidewaysOffset === 0) return;

    this.readFacing();
    this.appliedBobOffset.copy(this.rightScratch).multiplyScalar(sidewaysOffset);
    this.appliedBobOffset.y += verticalOffset;
    this.controls.object.position.add(this.appliedBobOffset);
  }

  private removeViewBob() {
    this.controls.object.position.sub(this.appliedBobOffset);
    this.appliedBobOffset.set(0, 0, 0);
  }

  /** Frame counters for the facts that hold before movement is resolved. */
  private countFrameState() {
    if (this.isFlying) profiler.addCounter("game.player.frames.fly");
    if (this.isShifting) profiler.addCounter("game.player.frames.shifting");
    profiler.addCounter(
      this.controls.isLocked || this.isMobile
        ? "game.player.frames.steerable"
        : "game.player.frames.unsteered",
    );
  }
}
