// Decides when a chunk is meshed and feeds the mesh workers just in time.
//
// Barrier: a chunk is meshed once it is lit, inside the drawn volume, and every loaded chunk around it (the 26 of
// its 3 x 3 x 3 neighborhood) is lit too, so its own light and its neighbors' border light are final and it is
// built once instead of once per neighbor that arrives. Later changes bump meshVersion and queue one rebuild per
// chunk (deduplicated by key) that reads the newest data when a worker takes it; a result built from an older
// version is dropped. Edit rebuilds go ahead of streaming work.

import { MAX_LIGHT } from "../edits/light-tables";
import { profiler } from "../profiler";
import { BlockType } from "../blocks";
import { type BorderFace, extractBorderSlab } from "../chunk-borders";
import type { ChunkFaceBuffers, ChunkMeshResult } from "../workers/mesh-types";
import { FACE_NEIGHBOR_KEY_DELTAS, offsetChunkKey } from "./chunk-key";
import { isCubeOccluderBlock, type ChunkRecord } from "./chunk-record";
import type { ChunkStore } from "./chunk-store";
import type { ChunkMeshRequest, MeshBackend } from "./pipeline-backends";
import { PriorityScheduler } from "./priority-scheduler";

/** Below every streaming priority, so edit rebuilds are dispatched first. */
export const EDIT_MESH_PRIORITY = -1_000_000;

/** Border face names in FACE_NEIGHBOR_KEY_DELTAS order (+x, -x, +y, -y, +z, -z), as the mesher names them. */
const BORDER_FACE_BY_DIRECTION: readonly BorderFace[] = ["right", "left", "top", "bottom", "front", "back"];

const CHUNK_SIZE = 32;

/** Whether the neighbor in a direction (FACE_NEIGHBOR_KEY_DELTAS order) has only cube occluders on the layer touching us. */
function isTouchingLayerSolid(neighbor: ChunkRecord | undefined, direction: number): boolean {
  if (!neighbor?.blocks) return false;
  if (neighbor.uniformBlock >= 0) return isCubeOccluderBlock(neighbor.uniformBlock);
  const axis = direction >> 1;
  const layer = (direction & 1) === 0 ? 0 : CHUNK_SIZE - 1;
  const blocks = neighbor.blocks;
  for (let first = 0; first < CHUNK_SIZE; first++) {
    for (let second = 0; second < CHUNK_SIZE; second++) {
      const index =
        axis === 0
          ? (layer << 10) | (first << 5) | second
          : axis === 1
            ? (first << 10) | (layer << 5) | second
            : (first << 10) | (second << 5) | layer;
      if (!isCubeOccluderBlock(blocks[index]!)) return false;
    }
  }
  return true;
}

interface QueuedMesh {
  key: number;
  isEdit: boolean;
}

export interface MeshCoordinatorHooks {
  priorityOf(key: number): number;
  isInDrawnVolume(record: ChunkRecord): boolean;
  onMeshReady(record: ChunkRecord, mesh: ChunkMeshResult | null, isFirstMesh: boolean): void;
  /**
   * True when the chunk above is not loaded because it is open sky (skipped above the surface). Its border is then
   * air in full sky light, not unknown, so top faces against it are lit instead of black.
   */
  isOpenSkyAbove?(record: ChunkRecord): boolean;
}

const BORDER_CELLS = 32 * 32;
const SKY_LIT_AIR_LIGHT = MAX_LIGHT << 4;

export interface MeshCounters {
  builds: number;
  skippedUniform: number;
  staleDropped: number;
  applied: number;
}

export class MeshCoordinator {
  readonly counters: MeshCounters = { builds: 0, skippedUniform: 0, staleDropped: 0, applied: 0 };
  readonly maxBuildsInFlight: number;
  private readonly queue = new PriorityScheduler<QueuedMesh>();
  private readonly waitingForMesh = new Set<number>();
  private buildsInFlight = 0;
  private isDisposed = false;

  constructor(
    private readonly store: ChunkStore<ChunkRecord>,
    private readonly backend: MeshBackend,
    private readonly hooks: MeshCoordinatorHooks,
  ) {
    this.maxBuildsInFlight = backend.workerCount + 1;
  }

  get queuedCount(): number {
    return this.queue.size;
  }

  get inFlightCount(): number {
    return this.buildsInFlight;
  }

  get waitingCount(): number {
    return this.waitingForMesh.size;
  }

  /** Queues the chunk's first mesh if it is ready, else remembers it until something around it changes. */
  consider(record: ChunkRecord): void {
    if (!record.isLit || record.hasMeshActivity) {
      this.waitingForMesh.delete(record.key);
      return;
    }
    if (!this.hooks.isInDrawnVolume(record) || !this.isNeighborhoodLit(record.key)) {
      this.waitingForMesh.add(record.key);
      return;
    }
    this.schedule(record, false);
  }

  /** Re-checks a chunk and the 26 around it, after it was lit or removed. */
  considerNeighborhood(chunkKey: number): void {
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
          const record = this.store.getByKey(offsetChunkKey(chunkKey, offsetX, offsetY, offsetZ));
          if (record) this.consider(record);
        }
      }
    }
  }

  /** After the player moved: chunks that were outside the drawn volume may be inside now. */
  revisitWaiting(): void {
    for (const key of Array.from(this.waitingForMesh)) {
      const record = this.store.getByKey(key);
      if (record) this.consider(record);
      else this.waitingForMesh.delete(key);
    }
  }

  /** Something the chunk's mesh reads changed: rebuild it if it has (or is getting) a mesh. */
  markInputsChanged(record: ChunkRecord, isEdit: boolean): void {
    record.meshVersion++;
    if (record.hasMeshActivity) this.schedule(record, isEdit);
    else this.consider(record);
  }

  /** The chunk's light changed on the given faces (merge bits): rebuild it and the neighbors that read them. */
  markLightChanged(record: ChunkRecord, changedFaces: number): void {
    this.markInputsChanged(record, false);
    for (let direction = 0; direction < FACE_NEIGHBOR_KEY_DELTAS.length; direction++) {
      if ((changedFaces & (1 << direction)) === 0) continue;
      const neighbor = this.store.getByKey(record.key + FACE_NEIGHBOR_KEY_DELTAS[direction]!);
      if (neighbor?.hasMeshActivity) this.markInputsChanged(neighbor, false);
    }
  }

  /** Resolves once the chunk's newest mesh is on screen, or right away when none is coming. */
  waitForMesh(record: ChunkRecord): Promise<void> {
    if (!record.isMeshScheduled && record.meshBuildsInFlight === 0) return Promise.resolve();
    return new Promise((resolve) => record.meshWaiters.push({ version: record.meshVersion, resolve }));
  }

  forget(record: ChunkRecord): void {
    this.queue.remove(record.key);
    this.waitingForMesh.delete(record.key);
    record.isMeshScheduled = false;
    record.resolveAllMeshWaiters();
  }

  reprioritizeAll(): void {
    this.queue.reprioritizeAll((key, item) => (item.isEdit ? EDIT_MESH_PRIORITY : this.hooks.priorityOf(key)));
  }

  pump(): void {
    while (!this.isDisposed && this.buildsInFlight < this.maxBuildsInFlight) {
      const queued = this.queue.pop();
      if (!queued) return;
      const record = this.store.getByKey(queued.key);
      if (!record) continue;
      record.isMeshScheduled = false;
      if (!record.isLit) {
        record.resolveAllMeshWaiters();
        continue;
      }
      if (this.drawsNothing(record)) {
        this.counters.skippedUniform++;
        profiler.addCounter("game.mesh.skippedUniform");
        this.apply(record, null, record.meshVersion);
        continue;
      }
      this.dispatch(record);
    }
  }

  dispose(): void {
    this.isDisposed = true;
    this.queue.clear();
    this.waitingForMesh.clear();
  }

  private schedule(record: ChunkRecord, isEdit: boolean): void {
    this.waitingForMesh.delete(record.key);
    record.isMeshScheduled = true;
    if (this.queue.has(record.key)) {
      if (isEdit) this.queue.schedule(record.key, { key: record.key, isEdit: true }, EDIT_MESH_PRIORITY);
      return;
    }
    this.queue.schedule(
      record.key,
      { key: record.key, isEdit },
      isEdit ? EDIT_MESH_PRIORITY : this.hooks.priorityOf(record.key),
    );
  }

  private isNeighborhoodLit(chunkKey: number): boolean {
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
          const neighbor = this.store.getByKey(offsetChunkKey(chunkKey, offsetX, offsetY, offsetZ));
          if (neighbor && !neighbor.isLit) return false;
        }
      }
    }
    return true;
  }

  /** All air, or solid cubes whose every face is pressed against solid cubes of the neighbors. */
  private drawsNothing(record: ChunkRecord): boolean {
    if (record.uniformBlock === BlockType.AIR) return true;
    if (!isCubeOccluderBlock(record.uniformBlock)) return false;
    const neighbors = this.store.neighborsOfKey(record.key);
    for (let direction = 0; direction < neighbors.length; direction++) {
      if (!isTouchingLayerSolid(neighbors[direction], direction)) return false;
    }
    return true;
  }

  private dispatch(record: ChunkRecord): void {
    const versionAtDispatch = record.meshVersion;
    const request = this.buildRequest(record);
    record.meshBuildsInFlight++;
    this.buildsInFlight++;
    this.counters.builds++;
    profiler.addCounter("game.mesh.builds");
    this.backend
      .buildMesh(request)
      .then(
        (mesh) => {
          if (this.isDisposed) return;
          const isCurrent = this.store.getByKey(record.key) === record && record.meshVersion === versionAtDispatch;
          if (!isCurrent) {
            this.counters.staleDropped++;
            profiler.addCounter("game.mesh.staleDropped");
            return;
          }
          this.apply(record, mesh, versionAtDispatch);
        },
        (error) => console.error(error),
      )
      .finally(() => {
        record.meshBuildsInFlight--;
        this.buildsInFlight--;
        if (record.meshBuildsInFlight === 0 && !record.isMeshScheduled) record.resolveAllMeshWaiters();
        this.pump();
      });
  }

  private apply(record: ChunkRecord, mesh: ChunkMeshResult | null, version: number): void {
    const isFirstMesh = record.appliedMeshVersion < 0;
    record.appliedMeshVersion = version;
    this.counters.applied++;
    this.hooks.onMeshReady(record, mesh, isFirstMesh);
    record.resolveMeshWaiters(version);
  }

  private buildRequest(record: ChunkRecord): ChunkMeshRequest {
    const extractToken = profiler.begin("main.chunk.extractBorders");
    const borders: ChunkFaceBuffers = {};
    const borderLights: ChunkFaceBuffers = {};
    const neighbors = this.store.neighborsOfKey(record.key);
    for (let direction = 0; direction < neighbors.length; direction++) {
      const neighbor = neighbors[direction];
      const face = BORDER_FACE_BY_DIRECTION[direction]!;
      if (!neighbor && face === "top" && this.hooks.isOpenSkyAbove?.(record)) {
        borders[face] = new Uint8Array(BORDER_CELLS).buffer;
        borderLights[face] = new Uint8Array(BORDER_CELLS).fill(SKY_LIT_AIR_LIGHT).buffer;
        continue;
      }
      if (!neighbor?.blocks) continue;
      borders[face] = extractBorderSlab(neighbor.blocks, face);
      if (neighbor.isLit && neighbor.light) borderLights[face] = extractBorderSlab(neighbor.light, face);
    }
    const request: ChunkMeshRequest = {
      chunkX: record.chunkX,
      chunkY: record.chunkY,
      chunkZ: record.chunkZ,
      blocks: (record.blocks as Uint8Array).slice().buffer,
      light: (record.light as Uint8Array).slice().buffer,
      borders,
      borderLights,
    };
    profiler.end(extractToken);
    return request;
  }
}
