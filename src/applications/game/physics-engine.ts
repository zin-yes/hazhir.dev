import * as THREE from "three";
import { BlockType, NON_COLLIDABLE_BLOCKS, getHitboxes } from "./blocks";
import { profiler } from "./profiler";
import { DIMENSIONS } from "./profiler/dimensions";

const PHYSICS_COLLISION_CHECK_SYSTEM = "physics.collisionCheck";

type CollisionOutcome = "hit" | "miss" | "unloadedChunk";

const COLLISION_OUTCOME_COUNTERS: { [outcome in CollisionOutcome]: string } = {
  hit: "game.physics.collisionHits",
  miss: "game.physics.collisionMisses",
  unloadedChunk: "game.physics.collisionUnloadedChunkHits",
};


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
    const scopeToken = profiler.begin("main.physics.resolveCollision");
    profiler.addCounter("game.physics.resolveCalls");
    try {
      this.resolveCollisionUnprofiled(
        position,
        velocity,
        playerBox,
        delta,
        eyeHeight,
        isShifting
      );
    } finally {
      profiler.end(scopeToken);
    }
  }

  private resolveCollisionUnprofiled(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    playerBox: THREE.Box3,
    delta: number,
    eyeHeight: number,
    isShifting: boolean
  ): void {
    const wasOnGround = this.isOnGround(position, eyeHeight);
    profiler.addCounter("game.physics.axisResolutions", 3);

    // Apply X movement
    const axisXToken = profiler.begin(
      "main.physics.resolveCollision.axisX",
      DIMENSIONS.simulationSystem,
      "physics.moveAxisX"
    );
    const originalX = position.x;
    position.x += velocity.x * delta;
    this.updatePlayerBox(playerBox, position, eyeHeight);
    if (this.checkCollision(playerBox)) {
      let stepped = false;
      if (wasOnGround && !isShifting) {
        const stepHeight = 0.6;
        const originalY = position.y;
        position.y += stepHeight;
        this.updatePlayerBox(playerBox, position, eyeHeight);
        if (!this.checkCollision(playerBox)) {
          stepped = true;
          profiler.addCounter("game.physics.stepUps");
        } else {
          position.y = originalY;
        }
      }

      if (!stepped) {
        profiler.addCounter("game.physics.axisBlocked.x");
        position.x = originalX;
        velocity.x = 0;
      }
    } else if (
      isShifting &&
      wasOnGround &&
      velocity.y <= 0 &&
      !this.isOnGround(position, eyeHeight)
    ) {
      profiler.addCounter("game.physics.sneakEdgeStops");
      position.x = originalX;
      velocity.x = 0;
    }
    profiler.end(axisXToken);

    // Apply Z movement
    const axisZToken = profiler.begin(
      "main.physics.resolveCollision.axisZ",
      DIMENSIONS.simulationSystem,
      "physics.moveAxisZ"
    );
    const originalZ = position.z;
    position.z += velocity.z * delta;
    this.updatePlayerBox(playerBox, position, eyeHeight);
    if (this.checkCollision(playerBox)) {
      let stepped = false;
      if (wasOnGround && !isShifting) {
        const stepHeight = 0.6;
        const originalY = position.y;
        position.y += stepHeight;
        this.updatePlayerBox(playerBox, position, eyeHeight);
        if (!this.checkCollision(playerBox)) {
          stepped = true;
          profiler.addCounter("game.physics.stepUps");
        } else {
          position.y = originalY;
        }
      }

      if (!stepped) {
        profiler.addCounter("game.physics.axisBlocked.z");
        position.z = originalZ;
        velocity.z = 0;
      }
    } else if (
      isShifting &&
      wasOnGround &&
      velocity.y <= 0 &&
      !this.isOnGround(position, eyeHeight)
    ) {
      profiler.addCounter("game.physics.sneakEdgeStops");
      position.z = originalZ;
      velocity.z = 0;
    }
    profiler.end(axisZToken);

    // Apply Y movement
    const axisYToken = profiler.begin(
      "main.physics.resolveCollision.axisY",
      DIMENSIONS.simulationSystem,
      "physics.moveAxisY"
    );
    position.y += velocity.y * delta;
    this.updatePlayerBox(playerBox, position, eyeHeight);
    if (this.checkCollision(playerBox)) {
      profiler.addCounter("game.physics.axisBlocked.y");
      profiler.addCounter(
        velocity.y < 0 ? "game.physics.landings" : "game.physics.ceilingHits",
      );
      position.y -= velocity.y * delta;
      velocity.y = 0;
    }
    profiler.end(axisYToken);
  }

  public isOnGround(
    position: THREE.Vector3,
    eyeHeight: number = 1.62
  ): boolean {
    const scopeToken = profiler.begin("main.physics.isOnGround");
    try {
      return this.isOnGroundUnprofiled(position, eyeHeight);
    } finally {
      profiler.end(scopeToken);
    }
  }

  private isOnGroundUnprofiled(
    position: THREE.Vector3,
    eyeHeight: number
  ): boolean {
    const box = new THREE.Box3();
    profiler.addCounter("game.physics.probeBoxAllocations");
    this.updatePlayerBox(box, position, eyeHeight);
    box.min.y -= 0.05;
    box.max.y = box.min.y + 0.05;
    return this.checkCollision(box);
  }

  public isInWater(position: THREE.Vector3, eyeHeight: number = 1.62): boolean {
    const scopeToken = profiler.begin("main.physics.isInWater");
    try {
      return this.isInWaterUnprofiled(position, eyeHeight);
    } finally {
      profiler.end(scopeToken);
    }
  }

  private isInWaterUnprofiled(
    position: THREE.Vector3,
    eyeHeight: number
  ): boolean {
    const box = new THREE.Box3();
    profiler.addCounter("game.physics.probeBoxAllocations");
    this.updatePlayerBox(box, position, eyeHeight);
    const minX = Math.round(box.min.x);
    const maxX = Math.round(box.max.x);
    const minY = Math.round(box.min.y);
    const maxY = Math.round(box.max.y);
    const minZ = Math.round(box.min.z);
    const maxZ = Math.round(box.max.z);

    profiler.addCounter("game.physics.waterProbes");
    let probedBlocks = 0;
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const block = this.getBlock(x, y, z);
          probedBlocks++;
          if (block === BlockType.WATER) {
            profiler.addCounter("game.physics.waterProbeBlocksQueried", probedBlocks);
            profiler.addCounter("game.physics.waterProbeHits");
            return true;
          }
        }
      }
    }
    profiler.addCounter("game.physics.waterProbeBlocksQueried", probedBlocks);
    return false;
  }

  public updatePlayerBox(
    box: THREE.Box3,
    position: THREE.Vector3,
    eyeHeight: number = 1.62
  ) {
    profiler.addCounter("game.physics.playerBoxUpdates");
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
    profiler.addCounter("game.physics.collisionChecks");
    const isProfiling = profiler.enabled;
    const epsilon = 0.001;
    const minX = Math.round(box.min.x + epsilon);
    const maxX = Math.round(box.max.x - epsilon);
    const minY = Math.round(box.min.y + epsilon);
    const maxY = Math.round(box.max.y - epsilon);
    const minZ = Math.round(box.min.z + epsilon);
    const maxZ = Math.round(box.max.z - epsilon);

    let blocksQueried = 0;
    let hitboxesTested = 0;
    let nonCollidableSkipped = 0;

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const block = this.getBlock(x, y, z);
          blocksQueried++;
          if (block === null) {
            this.recordCollisionWork(blocksQueried, hitboxesTested, nonCollidableSkipped, "unloadedChunk");
            return true;
          }
          if (NON_COLLIDABLE_BLOCKS.includes(block)) {
            nonCollidableSkipped++;
            continue;
          }

          const hitboxes = getHitboxes(block);
          const hitboxesBeforeBlock = hitboxesTested;

          for (const { scale, offset } of hitboxes) {
            const centerX = x + offset[0];
            const centerY = y + offset[1];
            const centerZ = z + offset[2];

            const halfScaleX = scale[0] / 2;
            const halfScaleY = scale[1] / 2;
            const halfScaleZ = scale[2] / 2;

            const blockBox = new THREE.Box3(
              new THREE.Vector3(
                centerX - halfScaleX,
                centerY - halfScaleY,
                centerZ - halfScaleZ
              ),
              new THREE.Vector3(
                centerX + halfScaleX,
                centerY + halfScaleY,
                centerZ + halfScaleZ
              )
            );

            hitboxesTested++;
            if (box.intersectsBox(blockBox)) {
              if (isProfiling) this.recordBlockHitboxes(block, hitboxesTested - hitboxesBeforeBlock);
              this.recordCollisionWork(blocksQueried, hitboxesTested, nonCollidableSkipped, "hit");
              return true;
            }
          }
          if (isProfiling) this.recordBlockHitboxes(block, hitboxesTested - hitboxesBeforeBlock);
        }
      }
    }
    this.recordCollisionWork(blocksQueried, hitboxesTested, nonCollidableSkipped, "miss");
    return false;
  }

  private recordBlockHitboxes(block: BlockType, hitboxCount: number) {
    profiler.recordBreakdown(DIMENSIONS.physicsBlock, BlockType[block] ?? "UNKNOWN", {
      units: hitboxCount,
      calls: 1,
    });
  }

  private recordCollisionWork(
    blocksQueried: number,
    hitboxesTested: number,
    nonCollidableSkipped: number,
    outcome: CollisionOutcome,
  ) {
    if (!profiler.enabled) return;
    profiler.addCounter("game.physics.blocksQueried", blocksQueried);
    profiler.addCounter("game.physics.hitboxesTested", hitboxesTested);
    profiler.addCounter("game.physics.nonCollidableSkipped", nonCollidableSkipped);
    profiler.addCounter(COLLISION_OUTCOME_COUNTERS[outcome]);
    profiler.noteFrame("physics.collisionChecks", 1);
    profiler.noteFrame("physics.blocksQueried", blocksQueried);
    profiler.recordBreakdown(
      DIMENSIONS.simulationSystem,
      PHYSICS_COLLISION_CHECK_SYSTEM,
      { units: blocksQueried, calls: 1 }
    );
  }
}
