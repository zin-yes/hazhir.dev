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
  private canJump = false;

  private readonly speed = 5;
  private readonly jumpForce = 9.5;
  private readonly gravity = 37.5;

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
  }

  private initInputListeners() {
    const onKeyDown = (event: KeyboardEvent) => {
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
          if (this.canJump) {
            this.velocity.y = this.jumpForce;
            this.canJump = false;
          }
          break;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
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
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
  }

  public update(delta: number) {
    // Apply Gravity
    this.velocity.y -= this.gravity * delta;

    if (this.controls.isLocked) {
      // Calculate desired horizontal velocity
      const forward = new THREE.Vector3();
      const right = new THREE.Vector3();

      this.controls.getObject().getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();

      right.crossVectors(forward, this.controls.getObject().up).normalize();

      const desiredVelocity = new THREE.Vector3();
      if (this.moveForward) desiredVelocity.add(forward);
      if (this.moveBackward) desiredVelocity.sub(forward);
      if (this.moveRight) desiredVelocity.add(right);
      if (this.moveLeft) desiredVelocity.sub(right);

      if (desiredVelocity.lengthSq() > 0) {
        desiredVelocity.normalize().multiplyScalar(this.speed);
      }

      this.velocity.x = desiredVelocity.x;
      this.velocity.z = desiredVelocity.z;
    } else {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }

    const position = this.controls.getObject().position;

    this.physics.resolveCollision(
      position,
      this.velocity,
      this.playerBox,
      delta
    );

    if (this.physics.isOnGround(position) && this.velocity.y <= 0) {
      this.canJump = true;
      this.velocity.y = 0;
    } else {
      this.canJump = false;
    }
  }
}
