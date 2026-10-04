// The game's side of the LOD: owns the LOD manager for the current world, turns chunk pipeline events and block edits
// into LOD calls, follows the far terrain render distance (0 turns the LOD off and gives the sky back to the main
// scene) and draws the LOD pass before the main scene.

import type * as THREE from "three";
import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "../config";
import type { PipelineEditResult } from "../world/chunk-pipeline";
import type { ChunkRecord } from "../world/chunk-record";
import { createLodManager, type LodManager } from "./manager/lod-manager";
import type { LodStats } from "./manager/lod-stats";

/** What the bridge reads from the chunk pipeline. */
export interface LodChunkSource {
  forEachChunk(visit: (record: ChunkRecord) => void): void;
  store: { get(chunkX: number, chunkY: number, chunkZ: number): ChunkRecord | undefined };
}

export interface GameLodBridgeOptions {
  /** Creates one LOD worker (keep the `new Worker(new URL(...))` literal at the call site for the bundler). */
  createWorker: () => Worker;
  workerCount: number;
  /** The sky: it must already be in the main scene, where it returns while the LOD is off. */
  background: THREE.Object3D;
  createManager?: typeof createLodManager;
}

export class GameLodBridge {
  private manager: LodManager | null = null;
  private seed: number | null = null;
  private renderDistanceChunks = 0;
  private hasCapturedHaze = false;
  private readonly createManager: typeof createLodManager;

  constructor(private readonly options: GameLodBridgeOptions) {
    this.createManager = options.createManager ?? createLodManager;
  }

  get isActive(): boolean {
    return this.manager !== null;
  }

  /** A new world (or seed): drops the old LOD before any chunk of the new one loads. */
  startWorld(seed: number, renderDistanceChunks: number): void {
    this.disposeManager();
    this.seed = seed;
    this.renderDistanceChunks = renderDistanceChunks;
    if (renderDistanceChunks > 0) this.createForCurrentWorld(null);
  }

  /** Applies a new far terrain distance live; turning it on mid-game replays the loaded chunks. */
  setRenderDistance(renderDistanceChunks: number, chunks: LodChunkSource | null): void {
    this.renderDistanceChunks = renderDistanceChunks;
    if (renderDistanceChunks === 0) {
      this.disposeManager();
    } else if (this.manager) {
      this.manager.setRenderDistanceChunks(renderDistanceChunks);
    } else if (this.seed !== null) {
      this.createForCurrentWorld(chunks);
    }
  }

  onChunkGenerated(record: ChunkRecord): void {
    if (record.blocks) this.manager?.onRealChunkLoaded(record.chunkX, record.chunkY, record.chunkZ, record.blocks);
  }

  onChunkMeshed(record: ChunkRecord): void {
    this.manager?.onRealChunkMeshed(record.chunkX, record.chunkY, record.chunkZ);
  }

  onChunkUnloaded(record: ChunkRecord): void {
    this.manager?.onRealChunkUnloaded(record.chunkX, record.chunkY, record.chunkZ);
  }

  /** Re-summarizes every chunk whose blocks an edit changed (light-only changes do not matter to the LOD). */
  onBlocksEdited(result: PipelineEditResult, chunks: LodChunkSource): void {
    const manager = this.manager;
    if (!manager || result.changes.count === 0) return;
    const editedChunks = new Map<string, [number, number, number]>();
    const { changes } = result;
    for (let position = 0; position < changes.count; position++) {
      const chunkX = Math.floor(changes.x[position] / CHUNK_WIDTH);
      const chunkY = Math.floor(changes.y[position] / CHUNK_HEIGHT);
      const chunkZ = Math.floor(changes.z[position] / CHUNK_LENGTH);
      editedChunks.set(`${chunkX},${chunkY},${chunkZ}`, [chunkX, chunkY, chunkZ]);
    }
    for (const [chunkX, chunkY, chunkZ] of editedChunks.values()) {
      const blocks = chunks.store.get(chunkX, chunkY, chunkZ)?.blocks;
      if (blocks) manager.onBlocksEdited(chunkX, chunkY, chunkZ, blocks);
    }
  }

  /** Clears the frame and draws the LOD pass; the main scene then renders on top without clearing. */
  renderPass(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
    const manager = this.manager;
    if (!manager) return;
    if (!this.hasCapturedHaze) {
      manager.captureBackgroundHaze(renderer);
      this.hasCapturedHaze = true;
    }
    manager.update(camera, renderer.domElement.clientHeight);
    manager.render(renderer, camera);
  }

  stats(): (LodStats & { renderDistanceChunks: number; isCameraUnderground: boolean }) | null {
    const manager = this.manager;
    if (!manager) return null;
    return {
      ...manager.getStats(),
      renderDistanceChunks: manager.renderDistanceChunks,
      isCameraUnderground: manager.isCameraUnderground,
    };
  }

  dispose(): void {
    this.disposeManager();
    this.seed = null;
  }

  private createForCurrentWorld(chunks: LodChunkSource | null): void {
    if (this.seed === null) return;
    const manager = this.createManager({
      seed: this.seed,
      workerFactory: this.options.createWorker,
      workerCount: this.options.workerCount,
      renderDistanceChunks: this.renderDistanceChunks,
    });
    manager.adoptBackground(this.options.background);
    this.manager = manager;
    this.hasCapturedHaze = false;
    chunks?.forEachChunk((record) => {
      this.onChunkGenerated(record);
      if (record.appliedMeshVersion >= 0) this.onChunkMeshed(record);
    });
  }

  private disposeManager(): void {
    this.manager?.dispose();
    this.manager = null;
  }
}
