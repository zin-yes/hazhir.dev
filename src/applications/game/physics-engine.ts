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
    delta: number,
    eyeHeight: number = 1.62,
    isShifting: boolean = false
  ): void {
    const wasOnGround = this.isOnGround(position, eyeHeight);

    // Apply X movement
    const originalX = position.x;
    position.x += velocity.x * delta;
    this.updatePlayerBox(playerBox, position, eyeHeight);
    if (this.checkCollision(playerBox)) {
      position.x = originalX;
      velocity.x = 0;
    } else if (
      isShifting &&
      wasOnGround &&
      velocity.y <= 0 &&
      !this.isOnGround(position, eyeHeight)
    ) {
      position.x = originalX;
      velocity.x = 0;
    }

    // Apply Z movement
    const originalZ = position.z;
    position.z += velocity.z * delta;
    this.updatePlayerBox(playerBox, position, eyeHeight);
    if (this.checkCollision(playerBox)) {
      position.z = originalZ;
      velocity.z = 0;
    } else if (
      isShifting &&
      wasOnGround &&
      velocity.y <= 0 &&
      !this.isOnGround(position, eyeHeight)
    ) {
      position.z = originalZ;
      velocity.z = 0;
    }

    // Apply Y movement
    position.y += velocity.y * delta;
    this.updatePlayerBox(playerBox, position, eyeHeight);
    if (this.checkCollision(playerBox)) {
      position.y -= velocity.y * delta;
      velocity.y = 0;
    }
  }

  public isOnGround(
    position: THREE.Vector3,
    eyeHeight: number = 1.62
  ): boolean {
    const box = new THREE.Box3();
    this.updatePlayerBox(box, position, eyeHeight);
    box.min.y -= 0.05;
    box.max.y = box.min.y + 0.05;
    return this.checkCollision(box);
  }

  public isInWater(position: THREE.Vector3, eyeHeight: number = 1.62): boolean {
    const box = new THREE.Box3();
    this.updatePlayerBox(box, position, eyeHeight);
    const minX = Math.round(box.min.x);
    const maxX = Math.round(box.max.x);
    const minY = Math.round(box.min.y);
    const maxY = Math.round(box.max.y);
    const minZ = Math.round(box.min.z);
    const maxZ = Math.round(box.max.z);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const block = this.getBlock(x, y, z);
          if (block === BlockType.WATER) return true;
        }
      }
    }
    return false;
  }

  public updatePlayerBox(
    box: THREE.Box3,
    position: THREE.Vector3,
    eyeHeight: number = 1.62
  ) {
    const halfWidth = this.playerSize.x / 2;
    const halfDepth = this.playerSize.z / 2;

    box.min.x = position.x - halfWidth;
    box.max.x = position.x + halfWidth;

    box.min.y = position.y - eyeHeight;
    box.max.y = position.y - eyeHeight + this.playerSize.y;

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
          if (NON_COLLIDABLE_BLOCKS.includes(block)) {
            continue;
          }

          let maxYOffset = 0.5;
          let minYOffset = 0.0;

          if (
            block === BlockType.PLANKS_SLAB ||
            block === BlockType.COBBLESTONE_SLAB ||
            block === BlockType.STONE_SLAB
          ) {
            maxYOffset = 0.0;
          } else if (
            block === BlockType.PLANKS_SLAB_TOP ||
            block === BlockType.COBBLESTONE_SLAB_TOP ||
            block === BlockType.STONE_SLAB_TOP
          ) {
            minYOffset = 0.5;
          }

          const blockBox = new THREE.Box3(
            new THREE.Vector3(x - 0.5, y - 0.5 + minYOffset, z - 0.5),
            new THREE.Vector3(x + 0.5, y + maxYOffset, z + 0.5)
          );

          if (box.intersectsBox(blockBox)) return true;
        }
      }
    }
    return false;
  }
}
