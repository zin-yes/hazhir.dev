// What the pipeline knows about one desired chunk and one column, plus the shared arrays of uniform chunks.

import { BlockType } from "../blocks";
import { CELLS_PER_CHUNK } from "../edits/chunk-cluster";
import { EMISSION, IS_TRANSPARENT } from "../edits/light-tables";
import { BLOCK_ROW_FLAGS, ROW_FLAG_CUBE_OCCLUDER } from "../workers/mesh-tables";
import { chunkKeyX, chunkKeyY, chunkKeyZ, columnKeyOfChunkKey } from "./chunk-key";

/** pending: waiting to be generated. generating / lighting: a worker has it. generated: blocks, no light yet. */
export type ChunkStage = "pending" | "generating" | "generated" | "lighting" | "lit";

export interface MeshWaiter {
  version: number;
  resolve: () => void;
}

export class ChunkRecord {
  readonly chunkX: number;
  readonly chunkY: number;
  readonly chunkZ: number;
  readonly columnKey: number;
  stage: ChunkStage = "pending";
  blocks: Uint8Array | null = null;
  light: Uint8Array | null = null;
  /** False while blocks is the shared array of a uniform chunk, which must be copied before any write. */
  ownsBlocks = false;
  ownsLight = false;
  /** The block every cell holds, or -1 when mixed (or once edited). */
  uniformBlock = -1;
  /** Bumped whenever anything the chunk's mesh reads changes: its blocks and light and its neighbors' borders. */
  meshVersion = 0;
  /** Bumped when an edit writes blocks or light, so light computed from older data is thrown away. */
  editVersion = 0;
  /** meshVersion of the mesh on screen, -1 before the first. */
  appliedMeshVersion = -1;
  isMeshScheduled = false;
  meshBuildsInFlight = 0;
  meshWaiters: MeshWaiter[] = [];
  /** profiler.now() when the chunk was requested, for pipeline latency timers. */
  readonly requestedAtMs: number;

  constructor(
    readonly key: number,
    requestedAtMs: number,
  ) {
    this.chunkX = chunkKeyX(key);
    this.chunkY = chunkKeyY(key);
    this.chunkZ = chunkKeyZ(key);
    this.columnKey = columnKeyOfChunkKey(key);
    this.requestedAtMs = requestedAtMs;
  }

  get hasBlocks(): boolean {
    return this.blocks !== null;
  }

  get isLit(): boolean {
    return this.stage === "lit";
  }

  /** Whether a mesh is on screen, being built or queued: such a chunk is rebuilt when its inputs change. */
  get hasMeshActivity(): boolean {
    return this.appliedMeshVersion >= 0 || this.isMeshScheduled || this.meshBuildsInFlight > 0;
  }

  ensureOwnBlocks(): Uint8Array {
    if (!this.ownsBlocks && this.blocks) {
      this.blocks = this.blocks.slice();
      this.ownsBlocks = true;
    }
    return this.blocks as Uint8Array;
  }

  ensureOwnLight(): Uint8Array | null {
    if (!this.ownsLight && this.light) {
      this.light = this.light.slice();
      this.ownsLight = true;
    }
    return this.light;
  }

  resolveMeshWaiters(upToVersion: number): void {
    if (this.meshWaiters.length === 0) return;
    const stillWaiting: MeshWaiter[] = [];
    for (const waiter of this.meshWaiters) {
      if (waiter.version <= upToVersion) waiter.resolve();
      else stillWaiting.push(waiter);
    }
    this.meshWaiters = stillWaiting;
  }

  resolveAllMeshWaiters(): void {
    const waiters = this.meshWaiters;
    this.meshWaiters = [];
    for (const waiter of waiters) waiter.resolve();
  }
}

export class ColumnRecord {
  readonly chunkKeys = new Set<number>();
  readonly pendingChunkKeys = new Set<number>();
  isGenerating = false;
  isLighting = false;
  /** Highest chunk y holding anything but air, once the column has been generated. */
  surfaceChunkY: number | undefined = undefined;

  constructor(
    readonly key: number,
    readonly chunkX: number,
    readonly chunkZ: number,
  ) {}
}

const uniformBlocksById = new Map<number, Uint8Array>();
/** All-zero light, shared by every uniform chunk that light cannot enter. */
export const SHARED_DARK_LIGHT = new Uint8Array(CELLS_PER_CHUNK);

/** One read-only array per block id for uniform chunks. Write through ChunkRecord.ensureOwnBlocks only. */
export function sharedUniformBlocks(block: number): Uint8Array {
  let blocks = uniformBlocksById.get(block);
  if (!blocks) {
    blocks = new Uint8Array(CELLS_PER_CHUNK).fill(block);
    uniformBlocksById.set(block, blocks);
  }
  return blocks;
}

/** Light can never enter or leave the chunk: every cell blocks it and none glows. */
export function isSealedUniformBlock(uniformBlock: number): boolean {
  return uniformBlock >= 0 && IS_TRANSPARENT[uniformBlock] === 0 && EMISSION[uniformBlock] === 0;
}

/** A full cube that hides any face pressed against it, so a chunk of it surrounded by more of it draws nothing. */
export function isCubeOccluderBlock(block: number): boolean {
  return block >= 0 && (BLOCK_ROW_FLAGS[block]! & ROW_FLAG_CUBE_OCCLUDER) !== 0;
}

export function isAirChunk(record: ChunkRecord): boolean {
  return record.uniformBlock === BlockType.AIR;
}
