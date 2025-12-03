import * as THREE from "three";
import { BlockType, NON_COLLIDABLE_BLOCKS } from "./blocks";

export class PhysicsEngine {
  private getBlock: (x: number, y: number, z: number) => BlockType | null;
  private playerSize = new THREE.Vector3(0.6, 1.8, 0.6);
  private eyeHeight = 1.62;

  constructor(getBlock: (x: number, y: number, z: number) => BlockType | null) {
    this.getBlock = getBlock;
  }

  public resolveCollision(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    playerBox: THREE.Box3,
    delta: number
  ): void {
    // Apply X movement
    position.x += velocity.x * delta;
    this.updatePlayerBox(playerBox, position);
    if (this.checkCollision(playerBox)) {
      position.x -= velocity.x * delta;
      velocity.x = 0;
    }

    // Apply Z movement
    position.z += velocity.z * delta;
    this.updatePlayerBox(playerBox, position);
    if (this.checkCollision(playerBox)) {
      position.z -= velocity.z * delta;
      velocity.z = 0;
    }

    // Apply Y movement
    position.y += velocity.y * delta;
    this.updatePlayerBox(playerBox, position);
    if (this.checkCollision(playerBox)) {
      position.y -= velocity.y * delta;
      velocity.y = 0;
    }
  }

  public isOnGround(position: THREE.Vector3): boolean {
    const box = new THREE.Box3();
    this.updatePlayerBox(box, position);
    box.min.y -= 0.05;
    box.max.y = box.min.y + 0.05;
    return this.checkCollision(box);
  }

  private updatePlayerBox(box: THREE.Box3, position: THREE.Vector3) {
    const halfWidth = this.playerSize.x / 2;
    const halfDepth = this.playerSize.z / 2;

    box.min.x = position.x - halfWidth;
    box.max.x = position.x + halfWidth;

    box.min.y = position.y - this.eyeHeight;
    box.max.y = position.y - this.eyeHeight + this.playerSize.y;

    box.min.z = position.z - halfDepth;
    box.max.z = position.z + halfDepth;
  }

  private checkCollision(box: THREE.Box3): boolean {
    const epsilon = 0.001;
    const minX = Math.round(box.min.x + epsilon);
    const maxX = Math.round(box.max.x - epsilon);
    const minY = Math.round(box.min.y + epsilon);
    const maxY = Math.round(box.max.y - epsilon);
    const minZ = Math.round(box.min.z + epsilon);
    const maxZ = Math.round(box.max.z - epsilon);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const block = this.getBlock(x, y, z);
          if (block === null) return true;
          if (!NON_COLLIDABLE_BLOCKS.includes(block)) {
            return true;
          }
        }
      }
    }
    return false;
  }
}
