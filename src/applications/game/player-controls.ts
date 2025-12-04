import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { PhysicsEngine } from "./physics-engine";

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

  private readonly speed = 5;
  private readonly jumpForce = 9.5;
  private readonly gravity = 37.5;
  private readonly standingEyeHeight = 1.62;
  private readonly shiftingEyeHeight = 1.42;
  private currentEyeHeight = 1.62;

  private playerBox = new THREE.Box3();

  public getPlayerBox() {
    return this.playerBox;
  }

  constructor(
    camera: THREE.Camera,
    domElement: HTMLElement,
    physics: PhysicsEngine
  ) {
    this.controls = new PointerLockControls(camera, domElement);
    this.physics = physics;

    this.initInputListeners();

    this.controls.addEventListener("unlock", () => {
      this.moveForward = false;
      this.moveBackward = false;
      this.moveLeft = false;
      this.moveRight = false;
      this.moveUp = false;
      this.moveDown = false;
      this.canJump = false;
    });
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (!this.controls.isLocked) return;

    switch (event.code) {
      case "ArrowUp":
      case "KeyW":
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
        if (this.isFlying) {
          this.moveUp = true;
        } else if (
          this.physics.isInWater(
            this.controls.object.position,
            this.currentEyeHeight
          )
        ) {
          this.moveUp = true;
        } else if (this.canJump) {
          this.velocity.y = this.jumpForce;
          this.canJump = false;
        }
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.isShifting = true;
        if (
          this.isFlying ||
          this.physics.isInWater(
            this.controls.object.position,
            this.currentEyeHeight
          )
        ) {
          this.moveDown = true;
        }
        break;
      case "KeyV":
        this.isFlying = !this.isFlying;
        this.velocity.set(0, 0, 0);
        break;
    }
  };

  private onKeyUp = (event: KeyboardEvent) => {
    switch (event.code) {
      case "ArrowUp":
      case "KeyW":
        this.moveForward = false;
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
    }
  };

  private initInputListeners() {
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
  }

  public dispose() {
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    this.controls.dispose();
  }

  public update(delta: number) {
    const lastEyeHeight = this.currentEyeHeight;
    // Interpolate eye height
    const targetEyeHeight = this.isShifting
      ? this.shiftingEyeHeight
      : this.standingEyeHeight;
    this.currentEyeHeight = THREE.MathUtils.lerp(
      this.currentEyeHeight,
      targetEyeHeight,
      delta * 10
    );

    // Compensate camera position to keep feet planted
    const diff = this.currentEyeHeight - lastEyeHeight;
    this.controls.object.position.y += diff;

    if (this.isFlying) {
      if (this.controls.isLocked) {
        const forward = new THREE.Vector3();
        const right = new THREE.Vector3();

        this.controls.object.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();

        right.crossVectors(forward, this.controls.object.up).normalize();

        const desiredVelocity = new THREE.Vector3();
        if (this.moveForward) desiredVelocity.add(forward);
        if (this.moveBackward) desiredVelocity.sub(forward);
        if (this.moveRight) desiredVelocity.add(right);
        if (this.moveLeft) desiredVelocity.sub(right);
        if (this.moveUp) desiredVelocity.y += 1;
        if (this.moveDown) desiredVelocity.y -= 1;

        if (desiredVelocity.lengthSq() > 0) {
          desiredVelocity.normalize().multiplyScalar(this.speed * 3);
        }

        this.velocity.copy(desiredVelocity);
      } else {
        this.velocity.set(0, 0, 0);
      }

      const position = this.controls.object.position;
      position.addScaledVector(this.velocity, delta);
      this.physics.updatePlayerBox(
        this.playerBox,
        position,
        this.currentEyeHeight
      );
      return;
    }

    const position = this.controls.object.position;

    if (this.physics.isInWater(position, this.currentEyeHeight)) {
      this.velocity.y -= this.gravity * delta * 0.1;
      this.velocity.multiplyScalar(0.9);

      if (this.controls.isLocked) {
        const forward = new THREE.Vector3();
        const right = new THREE.Vector3();

        this.controls.object.getWorldDirection(forward);
        forward.normalize();

        right.crossVectors(forward, this.controls.object.up).normalize();

        const desiredVelocity = new THREE.Vector3();
        if (this.moveForward) desiredVelocity.add(forward);
        if (this.moveBackward) desiredVelocity.sub(forward);
        if (this.moveRight) desiredVelocity.add(right);
        if (this.moveLeft) desiredVelocity.sub(right);
        if (this.moveUp) desiredVelocity.y += 0.5;
        if (this.moveDown) desiredVelocity.y -= 0.5;

        if (desiredVelocity.lengthSq() > 0) {
          desiredVelocity.normalize().multiplyScalar(this.speed * 0.5);
          this.velocity.add(desiredVelocity.multiplyScalar(delta * 10));
        }
      }

      this.physics.resolveCollision(
        position,
        this.velocity,
        this.playerBox,
        delta,
        this.currentEyeHeight
      );
      return;
    }

    // Apply Gravity
    this.velocity.y -= this.gravity * delta;

    if (this.controls.isLocked) {
      // Calculate desired horizontal velocity
      const forward = new THREE.Vector3();
      const right = new THREE.Vector3();

      this.controls.object.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();

      right.crossVectors(forward, this.controls.object.up).normalize();

      const desiredVelocity = new THREE.Vector3();
      if (this.moveForward) desiredVelocity.add(forward);
      if (this.moveBackward) desiredVelocity.sub(forward);
      if (this.moveRight) desiredVelocity.add(right);
      if (this.moveLeft) desiredVelocity.sub(right);

      if (desiredVelocity.lengthSq() > 0) {
        const currentSpeed = this.isShifting ? this.speed * 0.3 : this.speed;
        desiredVelocity.normalize().multiplyScalar(currentSpeed);
      }

      this.velocity.x = desiredVelocity.x;
      this.velocity.z = desiredVelocity.z;
    } else {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }

    this.physics.resolveCollision(
      position,
      this.velocity,
      this.playerBox,
      delta,
      this.currentEyeHeight,
      this.isShifting
    );

    if (
      this.physics.isOnGround(position, this.currentEyeHeight) &&
      this.velocity.y <= 0
    ) {
      this.canJump = true;
      this.velocity.y = 0;
    } else {
      this.canJump = false;
    }
  }
}
