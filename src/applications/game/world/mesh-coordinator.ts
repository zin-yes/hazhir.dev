// Decides when a chunk is meshed and feeds the mesh workers just in time.
//
// Barrier: a chunk is meshed once it is lit, inside the drawn volume, and every loaded chunk around it (the 26 of
// its 3 x 3 x 3 neighborhood) is lit too, so its own light and its neighbors' border light are final and it is
// built once instead of once per neighbor that arrives. Later changes bump meshVersion and queue one rebuild per
// chunk (deduplicated by key) that reads the newest data when a worker takes it; a result built from an older
// version is dropped. Edit rebuilds go ahead of streaming work.

import { MAX_LIGHT } from "../edits/light-tables";
import { profiler } from "../profiler";
import { DIMENSIONS } from "../profiler/dimensions";
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

/** Layer scans of the "draws nothing" check, counted as plain integers and published with the queue gauges. */
const layerScanStats = { scans: 0, cellsScanned: 0, foundOpenCell: 0, foundSolidLayer: 0, resolvedFromUniform: 0, missingNeighbor: 0 };

/** Whether the neighbor in a direction (FACE_NEIGHBOR_KEY_DELTAS order) has only cube occluders on the layer touching us. */
function isTouchingLayerSolid(neighbor: ChunkRecord | undefined, direction: number): boolean {
  if (!neighbor?.blocks) {
    layerScanStats.missingNeighbor++;
    return false;
  }
  if (neighbor.uniformBlock >= 0) {
    layerScanStats.resolvedFromUniform++;
    return isCubeOccluderBlock(neighbor.uniformBlock);
  }
  layerScanStats.scans++;
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
      if (!isCubeOccluderBlock(blocks[index]!)) {
        layerScanStats.cellsScanned += first * CHUNK_SIZE + second + 1;
        layerScanStats.foundOpenCell++;
        return false;
      }
    }
  }
  layerScanStats.cellsScanned += CHUNK_SIZE * CHUNK_SIZE;
  layerScanStats.foundSolidLayer++;
  return true;
}

/** Metric names of the border extraction per face direction, built once. */
const BORDER_FACE_BYTE_METERS = BORDER_FACE_BY_DIRECTION.map((face) => `bytes.mesh.border.${face}`);

interface QueuedMesh {
  key: number;
  isEdit: boolean;
  /** profiler.now() when the rebuild was first queued, or -1 when it was not measured. */
  queuedAtMs: number;
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
  private readonly queue = new PriorityScheduler<QueuedMesh>({ profilerLane: "mesh" });
  private readonly waitingForMesh = new Set<number>();
  private buildsInFlight = 0;
  private peakBuildsInFlightSinceSample = 0;
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

  /** Queue, in-flight and waiting levels plus the layer scan traffic; call about once a second. */
  publishProfilerGauges(): void {
    if (!profiler.enabled) return;
    this.queue.publishProfilerGauges();
    profiler.sampleGauge("queue.mesh.waitingForNeighborhood", this.waitingForMesh.size);
    profiler.sampleGauge("queue.mesh.buildsInFlight", this.buildsInFlight);
    profiler.sampleGauge("queue.mesh.buildsInFlightPeak", Math.max(this.peakBuildsInFlightSinceSample, this.buildsInFlight));
    this.peakBuildsInFlightSinceSample = this.buildsInFlight;
    profiler.sampleGauge("queue.mesh.buildSlotsFree", this.maxBuildsInFlight - this.buildsInFlight);
    profiler.addCounter("game.mesh.layerScans", layerScanStats.scans);
    profiler.addCounter("game.mesh.layerCellsScanned", layerScanStats.cellsScanned);
    profiler.addCounter("game.mesh.layerScansFoundOpenCell", layerScanStats.foundOpenCell);
    profiler.addCounter("game.mesh.layerScansFoundSolid", layerScanStats.foundSolidLayer);
    profiler.addCounter("game.mesh.layerChecksResolvedByUniform", layerScanStats.resolvedFromUniform);
    profiler.addCounter("game.mesh.layerChecksMissingNeighbor", layerScanStats.missingNeighbor);
    layerScanStats.scans = 0;
    layerScanStats.cellsScanned = 0;
    layerScanStats.foundOpenCell = 0;
    layerScanStats.foundSolidLayer = 0;
    layerScanStats.resolvedFromUniform = 0;
    layerScanStats.missingNeighbor = 0;
  }

  /** Queues the chunk's first mesh if it is ready, else remembers it until something around it changes. */
  consider(record: ChunkRecord): void {
    profiler.addCounter("game.mesh.considered");
    if (!record.isLit || record.hasMeshActivity) {
      this.waitingForMesh.delete(record.key);
      profiler.addCounter(record.isLit ? "game.mesh.considerSkippedHasMesh" : "game.mesh.considerSkippedNotLit");
      return;
    }
    if (!this.hooks.isInDrawnVolume(record)) {
      this.waitingForMesh.add(record.key);
      profiler.addCounter("game.mesh.considerWaitingOutsideDrawnVolume");
      return;
    }
    if (!this.isNeighborhoodLit(record.key)) {
      this.waitingForMesh.add(record.key);
      profiler.addCounter("game.mesh.considerWaitingNeighborhoodNotLit");
      return;
    }
    profiler.addCounter("game.mesh.considerReadyForFirstMesh");
    this.schedule(record, false);
  }

  /** Re-checks a chunk and the 26 around it, after it was lit or removed. */
  considerNeighborhood(chunkKey: number): void {
    profiler.addCounter("game.mesh.neighborhoodsConsidered");
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
          const record = this.store.getByKey(offsetChunkKey(chunkKey, offsetX, offsetY, offsetZ));
          if (record) this.consider(record);
        }
      }
    }
  }

  /**
   * Takes a chunk's mesh off screen (it left the drawn volume): any build in flight comes back stale, and the chunk
   * waits to be meshed again should it come back into view.
   */
  dropMesh(record: ChunkRecord): void {
    if (record.appliedMeshVersion < 0 && !record.isMeshScheduled && record.meshBuildsInFlight === 0) return;
    profiler.addCounter("game.mesh.droppedFromView");
    if (record.appliedMeshVersion >= 0) profiler.addCounter("game.mesh.droppedFromViewWithMesh");
    if (record.meshBuildsInFlight > 0) profiler.addCounter("game.mesh.droppedFromViewWhileBuilding");
    record.meshVersion++;
    record.appliedMeshVersion = -1;
    this.queue.remove(record.key);
    record.isMeshScheduled = false;
    record.resolveAllMeshWaiters();
    this.hooks.onMeshReady(record, null, false);
    this.consider(record);
  }

  /** After the player moved: chunks that were outside the drawn volume may be inside now. */
  revisitWaiting(): void {
    profiler.addCounter("game.mesh.waitingRevisited", this.waitingForMesh.size);
    for (const key of Array.from(this.waitingForMesh)) {
      const record = this.store.getByKey(key);
      if (record) this.consider(record);
      else this.waitingForMesh.delete(key);
    }
  }

  /** Something the chunk's mesh reads changed: rebuild it if it has (or is getting) a mesh. */
  markInputsChanged(record: ChunkRecord, isEdit: boolean): void {
    record.meshVersion++;
    if (record.hasMeshActivity) {
      profiler.addCounter(isEdit ? "game.mesh.inputsChangedByEdit" : "game.mesh.inputsChangedByStreaming");
      this.schedule(record, isEdit);
    } else {
      profiler.addCounter("game.mesh.inputsChangedBeforeFirstMesh");
      this.consider(record);
    }
  }

  /** The chunk's light changed on the given faces (merge bits): rebuild it and the neighbors that read them. */
  markLightChanged(record: ChunkRecord, changedFaces: number): void {
    profiler.addCounter("game.mesh.lightChanges");
    this.markInputsChanged(record, false);
    for (let direction = 0; direction < FACE_NEIGHBOR_KEY_DELTAS.length; direction++) {
      if ((changedFaces & (1 << direction)) === 0) continue;
      const neighbor = this.store.getByKey(record.key + FACE_NEIGHBOR_KEY_DELTAS[direction]!);
      if (neighbor?.hasMeshActivity) {
        profiler.addCounter("game.mesh.lightChangeNeighborsMarked");
        this.markInputsChanged(neighbor, false);
      }
    }
  }

  /** Resolves once the chunk's newest mesh is on screen, or right away when none is coming. */
  waitForMesh(record: ChunkRecord): Promise<void> {
    if (!record.isMeshScheduled && record.meshBuildsInFlight === 0) {
      profiler.addCounter("game.mesh.waitsResolvedImmediately");
      return Promise.resolve();
    }
    profiler.addCounter("game.mesh.waitsCreated");
    return new Promise((resolve) => record.meshWaiters.push({ version: record.meshVersion, resolve }));
  }

  forget(record: ChunkRecord): void {
    profiler.addCounter("game.mesh.forgotten");
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
      this.recordQueueWait(queued);
      const record = this.store.getByKey(queued.key);
      if (!record) {
        profiler.addCounter("game.mesh.poppedForUnloadedChunk");
        continue;
      }
      record.isMeshScheduled = false;
      if (!record.isLit) {
        profiler.addCounter("game.mesh.poppedNotLit");
        record.resolveAllMeshWaiters();
        continue;
      }
      if (this.drawsNothing(record)) {
        this.counters.skippedUniform++;
        profiler.addCounter("game.mesh.skippedUniform");
        profiler.addCounter(record.uniformBlock === BlockType.AIR ? "game.mesh.skippedAir" : "game.mesh.skippedBuriedSolid");
        this.apply(record, null, record.meshVersion);
        continue;
      }
      this.dispatch(record);
    }
    if (this.buildsInFlight >= this.maxBuildsInFlight && this.queue.size > 0) profiler.addCounter("game.mesh.pumpBlockedByBuildLimit");
  }

  private recordQueueWait(queued: QueuedMesh): void {
    if (queued.queuedAtMs < 0 || !profiler.enabled) return;
    profiler.recordTimer(
      queued.isEdit ? "latency.mesh.queueWait.edit" : "latency.mesh.queueWait.streaming",
      profiler.now() - queued.queuedAtMs,
      "latency",
    );
  }

  dispose(): void {
    this.isDisposed = true;
    this.queue.clear();
    this.waitingForMesh.clear();
  }

  private schedule(record: ChunkRecord, isEdit: boolean): void {
    this.waitingForMesh.delete(record.key);
    record.isMeshScheduled = true;
    const alreadyQueued = this.queue.itemOf(record.key);
    if (alreadyQueued) {
      if (isEdit) {
        if (!alreadyQueued.isEdit) profiler.addCounter("game.mesh.queuedUpgradedToEdit");
        alreadyQueued.isEdit = true;
        this.queue.schedule(record.key, alreadyQueued, EDIT_MESH_PRIORITY);
      } else {
        profiler.addCounter("game.mesh.queueDeduplicated");
      }
      return;
    }
    profiler.addCounter(isEdit ? "game.mesh.queuedEdit" : record.appliedMeshVersion < 0 ? "game.mesh.queuedFirst" : "game.mesh.queuedRebuild");
    this.queue.schedule(
      record.key,
      { key: record.key, isEdit, queuedAtMs: profiler.enabled ? profiler.now() : -1 },
      isEdit ? EDIT_MESH_PRIORITY : this.hooks.priorityOf(record.key),
    );
  }

  private isNeighborhoodLit(chunkKey: number): boolean {
    profiler.addCounter("game.mesh.neighborhoodLitChecks");
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
    profiler.addCounter("game.mesh.drawsNothingChecks");
    if (record.uniformBlock === BlockType.AIR) return true;
    if (!isCubeOccluderBlock(record.uniformBlock)) return false;
    const scopeToken = profiler.begin("main.mesh.drawsNothing.neighborLayers");
    try {
      const neighbors = this.store.neighborsOfKey(record.key);
      for (let direction = 0; direction < neighbors.length; direction++) {
        if (!isTouchingLayerSolid(neighbors[direction], direction)) return false;
      }
      return true;
    } finally {
      profiler.end(scopeToken);
    }
  }

  private dispatch(record: ChunkRecord): void {
    const dispatchToken = profiler.begin("main.mesh.dispatch");
    const versionAtDispatch = record.meshVersion;
    const request = this.buildRequest(record);
    record.meshBuildsInFlight++;
    this.buildsInFlight++;
    if (this.buildsInFlight > this.peakBuildsInFlightSinceSample) this.peakBuildsInFlightSinceSample = this.buildsInFlight;
    this.counters.builds++;
    profiler.addCounter("game.mesh.builds");
    profiler.addCounter(record.appliedMeshVersion < 0 ? "game.mesh.buildsFirst" : "game.mesh.buildsRebuild");
    profiler.end(dispatchToken);
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
        (error) => {
          console.error(error);
          profiler.addCounter("game.mesh.buildFailures");
        },
      )
      .finally(() => {
        record.meshBuildsInFlight--;
        this.buildsInFlight--;
        if (record.meshBuildsInFlight === 0 && !record.isMeshScheduled) {
          record.resolveAllMeshWaiters();
          if (record.appliedMeshVersion < 0 && this.store.getByKey(record.key) === record) this.consider(record);
        }
        this.pump();
      });
  }

  private apply(record: ChunkRecord, mesh: ChunkMeshResult | null, version: number): void {
    const isFirstMesh = record.appliedMeshVersion < 0;
    record.appliedMeshVersion = version;
    this.counters.applied++;
    profiler.addCounter("game.mesh.applied");
    this.hooks.onMeshReady(record, mesh, isFirstMesh);
    record.resolveMeshWaiters(version);
  }

  private buildRequest(record: ChunkRecord): ChunkMeshRequest {
    const extractToken = profiler.begin("main.chunk.extractBorders");
    const borders: ChunkFaceBuffers = {};
    const borderLights: ChunkFaceBuffers = {};
    const neighbors = this.store.neighborsOfKey(record.key);
    let slabsCopied = 0;
    let slabsSynthesizedFromOpenSky = 0;
    let facesWithoutNeighbor = 0;
    let borderBytes = 0;
    for (let direction = 0; direction < neighbors.length; direction++) {
      const neighbor = neighbors[direction];
      const face = BORDER_FACE_BY_DIRECTION[direction]!;
      if (!neighbor && face === "top" && this.hooks.isOpenSkyAbove?.(record)) {
        borders[face] = new Uint8Array(BORDER_CELLS).buffer;
        borderLights[face] = new Uint8Array(BORDER_CELLS).fill(SKY_LIT_AIR_LIGHT).buffer;
        slabsSynthesizedFromOpenSky++;
        borderBytes += BORDER_CELLS * 2;
        profiler.recordBreakdown(DIMENSIONS.borderFace, face, { units: BORDER_CELLS * 2, calls: 1 });
        continue;
      }
      if (!neighbor?.blocks) {
        facesWithoutNeighbor++;
        continue;
      }
      borders[face] = extractBorderSlab(neighbor.blocks, face);
      let faceBytes = (borders[face] as ArrayBuffer).byteLength;
      if (neighbor.isLit && neighbor.light) {
        borderLights[face] = extractBorderSlab(neighbor.light, face);
        faceBytes += (borderLights[face] as ArrayBuffer).byteLength;
      }
      slabsCopied++;
      borderBytes += faceBytes;
      profiler.recordBytes(BORDER_FACE_BYTE_METERS[direction]!, faceBytes);
      profiler.recordBreakdown(DIMENSIONS.borderFace, face, { units: faceBytes, calls: 1 });
    }
    profiler.addCounter("game.mesh.borderSlabsCopied", slabsCopied);
    profiler.addCounter("game.mesh.borderSlabsSynthesizedFromOpenSky", slabsSynthesizedFromOpenSky);
    profiler.addCounter("game.mesh.borderFacesWithoutNeighbor", facesWithoutNeighbor);
    profiler.recordBytes("bytes.mesh.requestBorders", borderBytes);
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
    if (profiler.enabled) {
      profiler.recordBytes("bytes.mesh.requestBlocks", request.blocks.byteLength);
      profiler.recordBytes("bytes.mesh.requestLight", request.light.byteLength);
      profiler.recordBytes("bytes.mesh.requestTotal", request.blocks.byteLength + request.light.byteLength + borderBytes);
    }
    return request;
  }
}
