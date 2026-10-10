import * as THREE from "three";
import { BlockType, NON_COLLIDABLE_BLOCKS, getHitboxes } from "./blocks";
import { findWaterSurfaceHeight } from "./camera-water-surface";
import { profiler } from "./profiler";
import { DIMENSIONS } from "./profiler/dimensions";

const PHYSICS_COLLISION_CHECK_SYSTEM = "physics.collisionCheck";

type CollisionOutcome = "hit" | "miss" | "unloadedChunk";

const COLLISION_OUTCOME_COUNTERS: { [outcome in CollisionOutcome]: string } = {
  hit: "game.physics.collisionHits",
  miss: "game.physics.collisionMisses",
  unloadedChunk: "game.physics.collisionUnloadedChunkHits",
};

type Hitbox = ReturnType<typeof getHitboxes>[number];

const NON_COLLIDABLE_LOOKUP = new Set<BlockType>(NON_COLLIDABLE_BLOCKS);
const hitboxesByBlock = new Map<BlockType, Hitbox[]>();

function hitboxesOf(block: BlockType): Hitbox[] {
  let hitboxes = hitboxesByBlock.get(block);
  if (!hitboxes) {
    hitboxes = getHitboxes(block);
    hitboxesByBlock.set(block, hitboxes);
  }
  return hitboxes;
}

/** How far the top of the head sits above the eyes; the body is as tall as the eye height plus this. */
export const HEAD_CLEARANCE = 0.18;
const PLAYER_WIDTH = 0.6;
/** How far below the feet a block still counts as the ground underfoot. */
const GROUND_PROBE_DEPTH = 0.05;
/** How far past the body's own half width a ledge can be and still be climbed onto. */
const LEDGE_REACH = 0.32;

export class PhysicsEngine {
  private getBlock: (x: number, y: number, z: number) => BlockType | null;
  private readonly probeBox = new THREE.Box3();
  private readonly blockBox = new THREE.Box3();
  private readonly probePoint = new THREE.Vector3();

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
    const box = this.probeBox;
    this.updatePlayerBox(box, position, eyeHeight);
    box.min.y -= GROUND_PROBE_DEPTH;
    box.max.y = box.min.y + GROUND_PROBE_DEPTH;
    return this.checkCollision(box);
  }

  /** The block the feet stand on, or the partial block (slab, snow) they stand in; null when its chunk is not loaded. */
  public getSupportingBlock(
    position: THREE.Vector3,
    eyeHeight: number = 1.62
  ): BlockType | null {
    const feetY = position.y - eyeHeight;
    return this.getBlock(
      Math.round(position.x),
      Math.round(feetY - GROUND_PROBE_DEPTH),
      Math.round(position.z)
    );
  }

  /** Height of the water surface in the column the body stands in, or null when the feet are not in water. */
  public getWaterSurfaceHeight(
    position: THREE.Vector3,
    eyeHeight: number = 1.62
  ): number | null {
    this.probePoint.set(position.x, position.y - eyeHeight + 0.3, position.z);
    return findWaterSurfaceHeight(this.getBlock, this.probePoint);
  }

  /**
   * How much of the body is under water, 0 (dry) to 1 (head under), measured against the real surface height of the
   * water column, so wading, treading water and diving are one continuous scale instead of an in/out switch.
   */
  public getWaterSubmersion(
    position: THREE.Vector3,
    eyeHeight: number = 1.62
  ): number {
    const scopeToken = profiler.begin("main.physics.waterSubmersion");
    try {
      profiler.addCounter("game.physics.waterProbes");
      const surfaceHeight = this.getWaterSurfaceHeight(position, eyeHeight);
      if (surfaceHeight === null) return 0;
      const submergedHeight = surfaceHeight - (position.y - eyeHeight);
      return Math.min(1, Math.max(0, submergedHeight / (eyeHeight + HEAD_CLEARANCE)));
    } finally {
      profiler.end(scopeToken);
    }
  }

  /**
   * Whether a swimmer at the surface could climb out onto the block they face: something solid is within reach in that
   * direction, and the body fits on top of it (no higher than `ledgeHeightAboveSurface` above the water).
   */
  public canClimbOntoLedge(
    position: THREE.Vector3,
    eyeHeight: number,
    directionX: number,
    directionZ: number,
    surfaceHeight: number,
    ledgeHeightAboveSurface: number
  ): boolean {
    const probe = this.probePoint;
    probe.set(
      position.x + directionX * LEDGE_REACH,
      position.y,
      position.z + directionZ * LEDGE_REACH
    );
    this.updatePlayerBox(this.probeBox, probe, eyeHeight);
    if (!this.checkCollision(this.probeBox)) return false;
    probe.y += surfaceHeight - (position.y - eyeHeight) + ledgeHeightAboveSurface;
    this.updatePlayerBox(this.probeBox, probe, eyeHeight);
    return !this.checkCollision(this.probeBox);
  }

  /** Whether a body of the target stance fits at the feet of the current one (standing up needs headroom). */
  public isStanceClear(
    position: THREE.Vector3,
    currentEyeHeight: number,
    targetEyeHeight: number
  ): boolean {
    this.probePoint.set(
      position.x,
      position.y - currentEyeHeight + targetEyeHeight,
      position.z
    );
    this.updatePlayerBox(this.probeBox, this.probePoint, targetEyeHeight);
    return !this.checkCollision(this.probeBox);
  }

  public updatePlayerBox(
    box: THREE.Box3,
    position: THREE.Vector3,
    eyeHeight: number = 1.62
  ) {
    profiler.addCounter("game.physics.playerBoxUpdates");
    const halfWidth = PLAYER_WIDTH / 2;
    const halfDepth = PLAYER_WIDTH / 2;

    box.min.x = position.x - halfWidth;
    box.max.x = position.x + halfWidth;

    box.min.y = position.y - eyeHeight;
    box.max.y = position.y + HEAD_CLEARANCE;

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
          if (NON_COLLIDABLE_LOOKUP.has(block)) {
            nonCollidableSkipped++;
            continue;
          }

          const hitboxes = hitboxesOf(block);
          const hitboxesBeforeBlock = hitboxesTested;

          for (const { scale, offset } of hitboxes) {
            const centerX = x + offset[0];
            const centerY = y + offset[1];
            const centerZ = z + offset[2];

            const halfScaleX = scale[0] / 2;
            const halfScaleY = scale[1] / 2;
            const halfScaleZ = scale[2] / 2;

            const blockBox = this.blockBox;
            blockBox.min.set(centerX - halfScaleX, centerY - halfScaleY, centerZ - halfScaleZ);
            blockBox.max.set(centerX + halfScaleX, centerY + halfScaleY, centerZ + halfScaleZ);

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
