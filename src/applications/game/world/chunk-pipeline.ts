// Streams, generates, lights and meshes the chunks around the player, and applies block edits to them.
//
// Flow per chunk: the planner asks for it (nearest first, view direction first) -> its column is generated in one
// worker call on the worker that holds the column's neighbors -> once no chunk of the column is still waiting for
// generation, the column's new chunks are lit in one worker call, reading lit neighbors as slabs -> the mesh
// coordinator builds its mesh once its 3 x 3 x 3 neighborhood is lit. Work for chunks that left the desired set is
// dropped before it reaches a worker; results for chunks that left meanwhile are ignored.
//
// All worker access goes through the injected backends, so the logic runs in tests with fake workers.

import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "../config";
import { BlockType } from "../blocks";
import { profiler } from "../profiler";
import {
  applyBlockEdits as applyBlockEditsToChunks,
  type BulkEditOptions,
  type BulkEditResult,
} from "../edits/apply-block-edits";
import { BlockEditBatch, type BlockEdit } from "../edits/block-edit-batch";
import type { LightChunkSource } from "../edits/chunk-cluster";
import { mergeLightReportingFaces } from "../edits/merge-light";
import { AFFINITY_TILE_SIZE_IN_CHUNKS, chunkColumnAffinityKey } from "../worker-pool";
import { collectSurroundingSlabs, type LitChunkView } from "../workers/region-surroundings";
import type { RegionLightResult } from "../workers/region-lighting";
import { AffinityQueues } from "./affinity-queues";
import {
  FACE_NEIGHBOR_KEY_DELTAS,
  createChunkCoordinates,
  packChunkKey,
  packColumnKey,
  unpackColumnKey,
  createColumnCoordinates,
} from "./chunk-key";
import {
  ChunkRecord,
  ColumnRecord,
  SHARED_DARK_LIGHT,
  isSealedUniformBlock,
  sharedUniformBlocks,
} from "./chunk-record";
import { ChunkStore } from "./chunk-store";
import type { LoadOrder } from "./load-order";
import { MeshCoordinator } from "./mesh-coordinator";
import type {
  ChunkPipelineEvents,
  GeneratedColumn,
  GeneratedColumnChunk,
  GenerationBackend,
  LightingBackend,
  MeshBackend,
} from "./pipeline-backends";
import { PriorityScheduler } from "./priority-scheduler";
import {
  SKIP_ABOVE_SURFACE_MARGIN,
  WORLD_HIGHEST_CHUNK_Y,
  WORLD_LOWEST_CHUNK_Y,
  normalizeRenderSettings,
  renderVolumeOf,
  streamConfigFor,
  type RenderSettings,
} from "./render-settings";
import { START_STAGE_GENERATED, START_STAGE_LIT, START_STAGE_MESHED, StartAreaProgress } from "./start-area-progress";
import { ChunkStreamPlanner, type PlannerForwardVector } from "./streaming-plan";
import { uniformByteValue } from "./uniform-bytes";

const DEFAULT_START_AREA_RADIUS = 3;
/** Queued work is re-ranked when the camera turns more than this since the last ranking. */
const REPRIORITIZE_TURN_COSINE = Math.cos((30 * Math.PI) / 180);
/** Columns examined per lighting dispatch while skipping ones next to a column being lit. */
const MAX_LIGHTING_CANDIDATES_PER_DISPATCH = 16;
const MAX_GENERATION_ATTEMPTS = 3;
/**
 * A generation worker runs another worker's column instead of its own when that column is this much nearer.
 * Tight while the start area loads (nearest first matters most), looser afterwards (worker caches matter more).
 */
const START_AREA_GENERATION_AFFINITY_GAP = 0.75;
const STREAMING_GENERATION_AFFINITY_GAP = 2;
const NO_FORWARD: PlannerForwardVector = { x: 0, y: 0, z: 0 };

/**
 * Generation order once the start area is on screen: every column of an affinity tile shares the priority of the
 * tile's center and they run in a serpentine through the tile, so a worker generates neighbors back to back and the
 * worldgen caches (base terrain of the surrounding 16 block columns, decoration origins) serve each next column
 * instead of being rebuilt. Strict nearest-first order rebuilt about four times the base terrain it needed.
 */
export function tileCoherentPriority(
  chunkX: number,
  chunkZ: number,
  priorityOfColumn: (chunkX: number, chunkZ: number) => number,
): number {
  const tileSize = AFFINITY_TILE_SIZE_IN_CHUNKS;
  const tileX = Math.floor(chunkX / tileSize);
  const tileZ = Math.floor(chunkZ / tileSize);
  const centerOffset = Math.floor(tileSize / 2);
  const tilePriority = priorityOfColumn(tileX * tileSize + centerOffset, tileZ * tileSize + centerOffset);
  const localX = chunkX - tileX * tileSize;
  const localZ = chunkZ - tileZ * tileSize;
  const serpentineIndex = localZ * tileSize + (localZ % 2 === 0 ? localX : tileSize - 1 - localX);
  // Tiles at the same distance must not interleave: a per-tile tie breaker, far larger than the order inside a tile.
  const tieBreaker =
    (((tileX * 7919 + tileZ * 104729) % TILE_TIE_BREAKER_BUCKETS) + TILE_TIE_BREAKER_BUCKETS) % TILE_TIE_BREAKER_BUCKETS;
  return tilePriority + tieBreaker * TILE_TIE_BREAKER_STEP + serpentineIndex * TILE_ORDER_STEP;
}

/** Orders columns inside a tile; tileSize^2 steps stay below one tie breaker step. */
const TILE_ORDER_STEP = 1e-6;
const TILE_TIE_BREAKER_STEP = 1e-4;
const TILE_TIE_BREAKER_BUCKETS = 1009;

export interface ChunkPipelineOptions {
  renderSettings?: Partial<RenderSettings>;
  generation: GenerationBackend;
  lighting: LightingBackend;
  meshing: MeshBackend;
  events: ChunkPipelineEvents;
  /** The generation worker whose caches suit a column; defaults to the worker pool's column tiles. */
  preferredGenerationWorker?: (chunkX: number, chunkZ: number) => number;
  /** Horizontal radius, in chunks, of the area that must be on screen before the start area counts as ready. */
  startAreaRadius?: number;
}

export interface PipelineCounters {
  chunksRequested: number;
  chunksGenerated: number;
  chunksLit: number;
  chunksUnloaded: number;
  chunksSkippedAboveSurface: number;
  columnGenerations: number;
  regionLightings: number;
  regionLightingRetries: number;
  slabBytesSent: number;
}

export interface PipelineEditResult extends BulkEditResult {
  /** One promise per chunk being rebuilt, resolved when its new mesh is on screen. */
  meshesApplied: Promise<void>[];
}

export interface Position3 {
  x: number;
  y: number;
  z: number;
}

export class ChunkPipeline {
  readonly store = new ChunkStore<ChunkRecord>();
  readonly counters: PipelineCounters = {
    chunksRequested: 0,
    chunksGenerated: 0,
    chunksLit: 0,
    chunksUnloaded: 0,
    chunksSkippedAboveSurface: 0,
    columnGenerations: 0,
    regionLightings: 0,
    regionLightingRetries: 0,
    slabBytesSent: 0,
  };
  readonly lightSource: LightChunkSource = {
    getBlocks: (chunkX, chunkY, chunkZ) => this.store.get(chunkX, chunkY, chunkZ)?.blocks ?? undefined,
    getLight: (chunkX, chunkY, chunkZ) => {
      const record = this.store.get(chunkX, chunkY, chunkZ);
      return record?.isLit ? (record.light ?? undefined) : undefined;
    },
  };

  private renderSettings: RenderSettings;
  private drawnVolume: LoadOrder;
  private readonly planner: ChunkStreamPlanner;
  private readonly columns = new Map<number, ColumnRecord>();
  private readonly surfaceChunkYByColumn = new Map<number, number>();
  private readonly generationAttemptsByColumn = new Map<number, number>();
  private readonly generationQueues: AffinityQueues;
  private readonly generationWorkerBusy: boolean[];
  private readonly lightingQueue = new PriorityScheduler<number>();
  private readonly columnsBeingLit = new Set<number>();
  private readonly meshes: MeshCoordinator;
  private readonly playerChunk = createChunkCoordinates();
  private readonly lastRankedForward = { x: 0, y: 0, z: 0 };
  private readonly columnScratch = createColumnCoordinates();
  private startArea: StartAreaProgress | null = null;
  private isDisposed = false;

  constructor(private readonly options: ChunkPipelineOptions) {
    this.renderSettings = normalizeRenderSettings(options.renderSettings ?? {});
    this.drawnVolume = renderVolumeOf(this.renderSettings);
    this.planner = new ChunkStreamPlanner(streamConfigFor(this.renderSettings, this.surfaceChunkYFor));
    const preferredWorker = options.preferredGenerationWorker ?? chunkColumnAffinityKey;
    this.generationQueues = new AffinityQueues(options.generation.workerCount, (columnKey) => {
      const column = unpackColumnKey(columnKey, this.columnScratch);
      return preferredWorker(column.chunkX, column.chunkZ);
    }, START_AREA_GENERATION_AFFINITY_GAP);
    this.generationWorkerBusy = new Array(options.generation.workerCount).fill(false);
    this.meshes = new MeshCoordinator(this.store, options.meshing, {
      priorityOf: (key) => this.planner.priorityOfKey(key),
      isInDrawnVolume: (record) => this.isInDrawnVolume(record),
      onMeshReady: (record, mesh, isFirstMesh) => this.onMeshReady(record, mesh, isFirstMesh),
    });
  }

  get settings(): Readonly<RenderSettings> {
    return this.renderSettings;
  }

  get meshCounters() {
    return this.meshes.counters;
  }

  /** Streams around the camera. Cheap when the player stays in the same chunk; call it often. */
  update(position: Position3, cameraForward: PlannerForwardVector): void {
    if (this.isDisposed) return;
    // Until the start area is on screen it loads as a disc around the player, not a cone ahead of the camera.
    const forward = this.startArea?.isReady ? cameraForward : NO_FORWARD;
    const playerChunk = {
      chunkX: Math.floor(position.x / CHUNK_WIDTH),
      chunkY: Math.floor(position.y / CHUNK_HEIGHT),
      chunkZ: Math.floor(position.z / CHUNK_LENGTH),
    };
    const planToken = profiler.begin("main.chunk.planStreaming");
    const plan = this.planner.update(playerChunk, forward, this.store.asKnownChunkKeys());
    profiler.end(planToken);
    if (plan.playerChunkChanged) {
      profiler.addCounter("game.streaming.plannerOperations", this.planner.lastUpdateOperations);
      this.playerChunk.chunkX = playerChunk.chunkX;
      this.playerChunk.chunkY = playerChunk.chunkY;
      this.playerChunk.chunkZ = playerChunk.chunkZ;
      if (!this.startArea) this.startArea = this.createStartArea();
      for (const key of plan.toUnload) this.removeChunk(key);
      for (let index = 0; index < plan.toLoad.length; index++) this.addChunk(plan.toLoad[index]!);
      this.rankQueuedWork(forward);
      this.meshes.revisitWaiting();
    } else if (this.hasTurnedFar(forward)) {
      this.rankQueuedWork(forward);
    }
    this.pump();
  }

  setRenderSettings(settings: Partial<RenderSettings>): void {
    this.renderSettings = normalizeRenderSettings({ ...this.renderSettings, ...settings });
    this.drawnVolume = renderVolumeOf(this.renderSettings);
    this.planner.setConfig(streamConfigFor(this.renderSettings, this.surfaceChunkYFor));
  }

  getBlock(x: number, y: number, z: number): number | null {
    const chunkX = Math.floor(x / CHUNK_WIDTH);
    const chunkY = Math.floor(y / CHUNK_HEIGHT);
    const chunkZ = Math.floor(z / CHUNK_LENGTH);
    const record = this.store.get(chunkX, chunkY, chunkZ);
    if (record?.blocks) {
      return record.blocks[
        ((x - chunkX * CHUNK_WIDTH) << 10) | ((y - chunkY * CHUNK_HEIGHT) << 5) | (z - chunkZ * CHUNK_LENGTH)
      ]!;
    }
    if (record) return null;
    const surfaceChunkY = this.surfaceChunkYFor(chunkX, chunkZ);
    return surfaceChunkY !== undefined && chunkY > surfaceChunkY ? BlockType.AIR : null;
  }

  getLight(x: number, y: number, z: number): number | null {
    const chunkX = Math.floor(x / CHUNK_WIDTH);
    const chunkY = Math.floor(y / CHUNK_HEIGHT);
    const chunkZ = Math.floor(z / CHUNK_LENGTH);
    const record = this.store.get(chunkX, chunkY, chunkZ);
    if (!record?.isLit || !record.light) return null;
    return record.light[
      ((x - chunkX * CHUNK_WIDTH) << 10) | ((y - chunkY * CHUNK_HEIGHT) << 5) | (z - chunkZ * CHUNK_LENGTH)
    ]!;
  }

  hasBlocksAt(x: number, y: number, z: number): boolean {
    return Boolean(this.store.get(Math.floor(x / CHUNK_WIDTH), Math.floor(y / CHUNK_HEIGHT), Math.floor(z / CHUNK_LENGTH))?.blocks);
  }

  /**
   * Writes the edits into the loaded chunks, relights once for the batch and queues the rebuilds ahead of
   * streaming. Edits in chunks without blocks are skipped (counted in stats.editsInUnloadedChunks).
   */
  applyBlockEdits(edits: BlockEditBatch | ArrayLike<BlockEdit>, options: BulkEditOptions = {}): PipelineEditResult {
    const batch = edits instanceof BlockEditBatch ? edits : BlockEditBatch.fromEdits(edits);
    this.takeOwnershipOfEditedChunks(batch);
    const result = applyBlockEditsToChunks(this.lightSource, batch, options);
    for (const chunk of result.changedChunks) {
      const record = this.store.get(chunk.x, chunk.y, chunk.z);
      if (record) record.editVersion++;
    }
    this.markEditedChunksMixed(result);
    const meshesApplied: Promise<void>[] = [];
    for (const chunk of result.chunksToRemesh) {
      const record = this.store.get(chunk.x, chunk.y, chunk.z);
      if (!record) continue;
      this.meshes.markInputsChanged(record, true);
      meshesApplied.push(this.meshes.waitForMesh(record));
    }
    this.pump();
    return { ...result, meshesApplied };
  }

  /** Every loaded chunk; do not add or remove chunks while visiting. */
  forEachChunk(visit: (record: ChunkRecord) => void): void {
    this.store.forEach(visit);
  }

  /** Queue sizes for per-frame gauges; constant time. */
  queueGauges() {
    return {
      loadedChunks: this.store.size,
      queuedColumnGenerations: this.generationQueues.size,
      busyGenerationWorkers: this.countBusyGenerationWorkers(),
      queuedLightings: this.lightingQueue.size,
      columnsBeingLit: this.columnsBeingLit.size,
      queuedMeshes: this.meshes.queuedCount,
      meshBuildsInFlight: this.meshes.inFlightCount,
      chunksWaitingForMesh: this.meshes.waitingCount,
    };
  }

  /** Counts and memory; walks every loaded chunk, so not for every frame. */
  stats() {
    let generatedChunks = 0;
    let litChunks = 0;
    let meshedChunks = 0;
    let ownedBytes = 0;
    this.store.forEach((record) => {
      if (record.blocks) generatedChunks++;
      if (record.isLit) litChunks++;
      if (record.appliedMeshVersion >= 0) meshedChunks++;
      if (record.ownsBlocks && record.blocks) ownedBytes += record.blocks.byteLength;
      if (record.ownsLight && record.light) ownedBytes += record.light.byteLength;
    });
    return {
      ...this.queueGauges(),
      columns: this.columns.size,
      generatedChunks,
      litChunks,
      meshedChunks,
      ownedChunkDataBytes: ownedBytes,
      ...this.counters,
      meshBuilds: this.meshes.counters.builds,
      meshesSkippedUniform: this.meshes.counters.skippedUniform,
      staleMeshesDropped: this.meshes.counters.staleDropped,
    };
  }

  private countBusyGenerationWorkers(): number {
    let busyWorkers = 0;
    for (const isBusy of this.generationWorkerBusy) if (isBusy) busyWorkers++;
    return busyWorkers;
  }

  /** Drops every chunk (each one reported through onChunkUnloaded) and ignores whatever workers still return. */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.meshes.dispose();
    this.generationQueues.clear();
    this.lightingQueue.clear();
    this.store.forEach((record) => {
      record.resolveAllMeshWaiters();
      this.options.events.onChunkUnloaded(record);
    });
    this.store.clear();
    this.columns.clear();
  }

  private readonly surfaceChunkYFor = (chunkX: number, chunkZ: number): number | undefined => {
    const generatedSurface = this.surfaceChunkYByColumn.get(packColumnKey(chunkX, chunkZ));
    const editedTop = this.options.events.highestEditedChunkY?.(chunkX, chunkZ);
    if (generatedSurface === undefined) return undefined;
    return editedTop === undefined ? generatedSurface : Math.max(generatedSurface, editedTop);
  };

  private createStartArea(): StartAreaProgress {
    const radius = Math.min(this.options.startAreaRadius ?? DEFAULT_START_AREA_RADIUS, this.renderSettings.horizontalRadius);
    const targetKeys: number[] = [];
    const volume = this.drawnVolume;
    for (let index = 0; index < volume.offsetCount; index++) {
      const offsetX = volume.offsetX[index]!;
      const offsetZ = volume.offsetZ[index]!;
      if (offsetX * offsetX + offsetZ * offsetZ > radius * radius) continue;
      const chunkY = this.playerChunk.chunkY + volume.offsetY[index]!;
      if (chunkY < WORLD_LOWEST_CHUNK_Y || chunkY > WORLD_HIGHEST_CHUNK_Y) continue;
      targetKeys.push(packChunkKey(this.playerChunk.chunkX + offsetX, chunkY, this.playerChunk.chunkZ + offsetZ));
    }
    const startedAtMs = profiler.now();
    const progress = new StartAreaProgress(
      targetKeys,
      (fractions) => this.options.events.onStartAreaProgress?.(fractions),
      () => {
        this.generationQueues.maxPriorityGapForAffinity = STREAMING_GENERATION_AFFINITY_GAP;
        profiler.recordTimer("chunk.load.total", profiler.now() - startedAtMs, "latency");
        this.options.events.onStartAreaReady?.();
      },
    );
    progress.reportInitial();
    return progress;
  }

  private hasTurnedFar(forward: PlannerForwardVector): boolean {
    const length = Math.hypot(forward.x, forward.y, forward.z) || 1;
    const cosine =
      (forward.x * this.lastRankedForward.x + forward.y * this.lastRankedForward.y + forward.z * this.lastRankedForward.z) /
      length;
    return cosine < REPRIORITIZE_TURN_COSINE;
  }

  private rankQueuedWork(forward: PlannerForwardVector): void {
    const length = Math.hypot(forward.x, forward.y, forward.z) || 1;
    this.lastRankedForward.x = forward.x / length;
    this.lastRankedForward.y = forward.y / length;
    this.lastRankedForward.z = forward.z / length;
    this.generationQueues.reprioritizeAll((columnKey) => this.columnPriority(columnKey));
    this.lightingQueue.reprioritizeAll((columnKey) => this.columnPriority(columnKey));
    this.meshes.reprioritizeAll();
  }

  private columnPriority(columnKey: number): number {
    const column = unpackColumnKey(columnKey, this.columnScratch);
    if (!this.startArea?.isReady) return this.planner.priorityOfChunk(column.chunkX, this.playerChunk.chunkY, column.chunkZ);
    return tileCoherentPriority(column.chunkX, column.chunkZ, (chunkX, chunkZ) =>
      this.planner.priorityOfChunk(chunkX, this.playerChunk.chunkY, chunkZ),
    );
  }

  private isInDrawnVolume(record: ChunkRecord): boolean {
    return this.drawnVolume.contains(
      record.chunkX - this.playerChunk.chunkX,
      record.chunkY - this.playerChunk.chunkY,
      record.chunkZ - this.playerChunk.chunkZ,
    );
  }

  private isNextToPlayer(record: ChunkRecord): boolean {
    return (
      Math.abs(record.chunkX - this.playerChunk.chunkX) <= 1 &&
      Math.abs(record.chunkY - this.playerChunk.chunkY) <= 1 &&
      Math.abs(record.chunkZ - this.playerChunk.chunkZ) <= 1
    );
  }

  private addChunk(key: number): void {
    if (this.store.hasKey(key)) return;
    const record = new ChunkRecord(key, profiler.now());
    this.store.setByKey(key, record);
    this.counters.chunksRequested++;
    let column = this.columns.get(record.columnKey);
    if (!column) {
      column = new ColumnRecord(record.columnKey, record.chunkX, record.chunkZ);
      this.columns.set(column.key, column);
    }
    column.chunkKeys.add(key);
    column.pendingChunkKeys.add(key);
    if (!column.isGenerating) this.generationQueues.schedule(column.key, this.columnPriority(column.key));
  }

  private removeChunk(key: number): void {
    const record = this.store.getByKey(key);
    if (!record) return;
    this.store.deleteByKey(key);
    this.counters.chunksUnloaded++;
    profiler.addCounter("game.chunks.unloaded");
    this.meshes.forget(record);
    this.options.events.onChunkUnloaded(record);
    this.startArea?.markRemoved(key);
    const column = this.columns.get(record.columnKey);
    if (column) {
      column.chunkKeys.delete(key);
      column.pendingChunkKeys.delete(key);
      if (column.chunkKeys.size === 0) {
        this.columns.delete(column.key);
        this.generationQueues.remove(column.key);
        this.lightingQueue.remove(column.key);
      } else {
        this.scheduleLighting(column);
      }
    }
    this.meshes.considerNeighborhood(key);
  }

  private pump(): void {
    if (this.isDisposed) return;
    this.pumpGeneration();
    this.pumpLighting();
    this.meshes.pump();
  }

  private pumpGeneration(): void {
    for (let workerIndex = 0; workerIndex < this.generationWorkerBusy.length; workerIndex++) {
      while (!this.generationWorkerBusy[workerIndex]) {
        const columnKey = this.generationQueues.takeFor(workerIndex);
        if (columnKey === undefined) break;
        const column = this.columns.get(columnKey);
        if (!column || column.isGenerating || column.pendingChunkKeys.size === 0) continue;
        this.dispatchGeneration(column, workerIndex);
      }
    }
  }

  private dispatchGeneration(column: ColumnRecord, workerIndex: number): void {
    const records: ChunkRecord[] = [];
    for (const key of column.pendingChunkKeys) {
      const record = this.store.getByKey(key);
      if (!record) continue;
      record.stage = "generating";
      records.push(record);
    }
    column.pendingChunkKeys.clear();
    column.isGenerating = true;
    this.generationWorkerBusy[workerIndex] = true;
    this.counters.columnGenerations++;
    this.options.generation
      .generateColumn({
        chunkX: column.chunkX,
        chunkZ: column.chunkZ,
        chunkYs: records.map((record) => record.chunkY),
        workerIndex,
      })
      .then(
        (generated) => {
          this.generationWorkerBusy[workerIndex] = false;
          if (!this.isDisposed) this.acceptGeneratedColumn(column, records, generated);
        },
        (error) => {
          this.generationWorkerBusy[workerIndex] = false;
          console.error(error);
          if (!this.isDisposed) this.retryGeneration(column, records);
        },
      )
      .finally(() => this.pump());
  }

  private retryGeneration(column: ColumnRecord, records: ChunkRecord[]): void {
    column.isGenerating = false;
    const attempts = (this.generationAttemptsByColumn.get(column.key) ?? 0) + 1;
    this.generationAttemptsByColumn.set(column.key, attempts);
    for (const record of records) {
      if (this.store.getByKey(record.key) !== record) continue;
      record.stage = "pending";
      column.pendingChunkKeys.add(record.key);
    }
    if (attempts < MAX_GENERATION_ATTEMPTS && this.columns.get(column.key) === column) {
      this.generationQueues.schedule(column.key, this.columnPriority(column.key));
    }
  }

  private acceptGeneratedColumn(column: ColumnRecord, records: ChunkRecord[], generated: GeneratedColumn): void {
    column.isGenerating = false;
    if (generated.surfaceChunkY !== null) {
      column.surfaceChunkY = generated.surfaceChunkY;
      this.surfaceChunkYByColumn.set(column.key, generated.surfaceChunkY);
    }
    const generatedByChunkY = new Map<number, GeneratedColumnChunk>();
    for (const chunk of generated.chunks) generatedByChunkY.set(chunk.chunkY, chunk);
    const nowMs = profiler.now();
    for (const record of records) {
      const chunk = generatedByChunkY.get(record.chunkY);
      if (!chunk || this.store.getByKey(record.key) !== record) continue;
      this.storeGeneratedBlocks(record, chunk);
      record.stage = "generated";
      this.counters.chunksGenerated++;
      profiler.addCounter("game.chunks.generated");
      profiler.recordTimer("chunk.pipeline.generate", nowMs - record.requestedAtMs, "latency");
      this.options.events.onChunkGenerated?.(record);
      this.startArea?.markReached(record.key, START_STAGE_GENERATED);
    }
    if (this.columns.get(column.key) !== column) return;
    this.dropChunksAboveSurface(column);
    if (this.columns.get(column.key) !== column) return;
    if (column.pendingChunkKeys.size > 0) {
      this.generationQueues.schedule(column.key, this.columnPriority(column.key));
    } else {
      this.scheduleLighting(column);
    }
  }

  private storeGeneratedBlocks(record: ChunkRecord, chunk: GeneratedColumnChunk): void {
    if (chunk.blocks) {
      record.blocks = new Uint8Array(chunk.blocks);
      record.ownsBlocks = true;
      record.uniformBlock = -1;
    } else {
      record.blocks = sharedUniformBlocks(chunk.uniformBlock);
      record.ownsBlocks = false;
      record.uniformBlock = chunk.uniformBlock;
    }
    const savedEdits = this.options.events.savedEditsFor?.(record.chunkX, record.chunkY, record.chunkZ);
    if (!savedEdits || savedEdits.size === 0) return;
    const applyToken = profiler.begin("main.chunk.applySavedEdits");
    const blocks = record.ensureOwnBlocks();
    savedEdits.forEach((block, index) => {
      blocks[index] = block;
    });
    record.uniformBlock = uniformByteValue(blocks);
    profiler.addCounter("game.chunks.savedEditsApplied", savedEdits.size);
    profiler.end(applyToken);
  }

  /** Chunks well above a column's surface are all air: drop them unless the player is right there. */
  private dropChunksAboveSurface(column: ColumnRecord): void {
    const surfaceChunkY = this.surfaceChunkYFor(column.chunkX, column.chunkZ);
    if (surfaceChunkY === undefined) return;
    const highestKeptChunkY = surfaceChunkY + SKIP_ABOVE_SURFACE_MARGIN;
    for (const key of Array.from(column.chunkKeys)) {
      const record = this.store.getByKey(key);
      if (!record || record.chunkY <= highestKeptChunkY || this.isNextToPlayer(record)) continue;
      this.counters.chunksSkippedAboveSurface++;
      profiler.addCounter("game.chunks.skippedAboveSurface");
      this.removeChunk(key);
    }
  }

  private scheduleLighting(column: ColumnRecord): void {
    if (column.isGenerating || column.isLighting || column.pendingChunkKeys.size > 0) return;
    if (!this.hasChunkWaitingForLight(column)) return;
    this.lightingQueue.schedule(column.key, column.key, this.columnPriority(column.key));
  }

  private hasChunkWaitingForLight(column: ColumnRecord): boolean {
    for (const key of column.chunkKeys) {
      if (this.store.getByKey(key)?.stage === "generated") return true;
    }
    return false;
  }

  private pumpLighting(): void {
    const deferredColumnKeys: number[] = [];
    let candidatesExamined = 0;
    while (
      this.columnsBeingLit.size < this.options.lighting.workerCount &&
      candidatesExamined < MAX_LIGHTING_CANDIDATES_PER_DISPATCH
    ) {
      const columnKey = this.lightingQueue.pop();
      if (columnKey === undefined) break;
      candidatesExamined++;
      const column = this.columns.get(columnKey);
      if (!column || column.isLighting || column.isGenerating || column.pendingChunkKeys.size > 0) continue;
      if (this.touchesColumnBeingLit(column)) {
        deferredColumnKeys.push(columnKey);
        continue;
      }
      this.dispatchLighting(column);
    }
    for (const columnKey of deferredColumnKeys) {
      this.lightingQueue.schedule(columnKey, columnKey, this.columnPriority(columnKey));
    }
  }

  /** Columns lit side by side would not see each other's light, so neighbors (diagonals too) wait their turn. */
  private touchesColumnBeingLit(column: ColumnRecord): boolean {
    for (const otherKey of this.columnsBeingLit) {
      const other = this.columns.get(otherKey);
      if (!other) continue;
      if (Math.abs(other.chunkX - column.chunkX) <= 1 && Math.abs(other.chunkZ - column.chunkZ) <= 1) return true;
    }
    return false;
  }

  private readonly getLitChunkView = (chunkX: number, chunkY: number, chunkZ: number): LitChunkView | undefined => {
    const record = this.store.get(chunkX, chunkY, chunkZ);
    if (!record?.isLit || !record.blocks || !record.light) return undefined;
    return { blocks: record.blocks, light: record.light, uniformBlock: record.uniformBlock };
  };

  private dispatchLighting(column: ColumnRecord): void {
    const region: ChunkRecord[] = [];
    for (const key of column.chunkKeys) {
      const record = this.store.getByKey(key);
      if (record?.stage === "generated") region.push(record);
    }
    if (region.length === 0) return;
    const collectToken = profiler.begin("main.light.collectRegionInputs");
    const slabs = collectSurroundingSlabs(region, this.getLitChunkView);
    const involved: { record: ChunkRecord; editVersion: number }[] = region.map((record) => ({
      record,
      editVersion: record.editVersion,
    }));
    let slabBytes = 0;
    for (const slab of slabs) {
      const surrounding = this.store.get(slab.chunkX, slab.chunkY, slab.chunkZ);
      if (surrounding) involved.push({ record: surrounding, editVersion: surrounding.editVersion });
      slabBytes += (slab.blocks?.byteLength ?? 0) + (slab.light?.byteLength ?? 0);
    }
    const regionChunks = region.map((record) => ({
      chunkX: record.chunkX,
      chunkY: record.chunkY,
      chunkZ: record.chunkZ,
      blocks: record.uniformBlock >= 0 ? null : (record.blocks as Uint8Array).slice(),
      uniformBlock: record.uniformBlock,
    }));
    profiler.end(collectToken);
    this.counters.slabBytesSent += slabBytes;
    profiler.recordBytes("bytes.light.surroundingSlabs", slabBytes);
    for (const record of region) record.stage = "lighting";
    column.isLighting = true;
    this.columnsBeingLit.add(column.key);
    this.counters.regionLightings++;
    const finishLighting = () => {
      column.isLighting = false;
      this.columnsBeingLit.delete(column.key);
    };
    this.options.lighting
      .lightRegion({ regionChunks, slabs })
      .then(
        (result) => {
          finishLighting();
          if (!this.isDisposed) this.acceptRegionLight(column, region, involved, result);
        },
        (error) => {
          finishLighting();
          console.error(error);
          if (!this.isDisposed) this.returnRegionToGenerated(region);
        },
      )
      .finally(() => this.pump());
  }

  private returnRegionToGenerated(region: ChunkRecord[]): void {
    for (const record of region) {
      if (this.store.getByKey(record.key) === record) record.stage = "generated";
    }
  }

  private acceptRegionLight(
    column: ColumnRecord,
    region: ChunkRecord[],
    involved: { record: ChunkRecord; editVersion: number }[],
    result: RegionLightResult,
  ): void {
    const isStale = involved.some(
      ({ record, editVersion }) => this.store.getByKey(record.key) === record && record.editVersion !== editVersion,
    );
    if (isStale) {
      this.counters.regionLightingRetries++;
      profiler.addCounter("game.light.regionRetries");
      this.returnRegionToGenerated(region);
      if (this.columns.get(column.key) === column) this.scheduleLighting(column);
      return;
    }
    const mergeToken = profiler.begin("main.light.mergeRegion");
    const regionByKey = new Map<number, ChunkRecord>();
    for (const record of region) regionByKey.set(record.key, record);
    const newlyLit: ChunkRecord[] = [];
    const nowMs = profiler.now();
    for (const chunkLight of result.chunkLights) {
      const key = packChunkKey(chunkLight.chunkX, chunkLight.chunkY, chunkLight.chunkZ);
      const record = regionByKey.get(key);
      if (!record || this.store.getByKey(key) !== record) continue;
      const isSealed = isSealedUniformBlock(record.uniformBlock);
      record.light = isSealed ? SHARED_DARK_LIGHT : chunkLight.light;
      record.ownsLight = !isSealed;
      record.stage = "lit";
      newlyLit.push(record);
      this.counters.chunksLit++;
      profiler.addCounter("game.chunks.lit");
      profiler.recordTimer("chunk.pipeline.light", nowMs - record.requestedAtMs, "latency");
      this.startArea?.markReached(key, START_STAGE_LIT);
    }
    for (const update of result.surroundingUpdates) {
      const surrounding = this.store.get(update.chunkX, update.chunkY, update.chunkZ);
      if (!surrounding?.isLit) continue;
      const changedFaces = mergeLightReportingFaces(surrounding.ensureOwnLight() as Uint8Array, update.light);
      if (changedFaces !== 0) this.meshes.markLightChanged(surrounding, changedFaces);
    }
    profiler.end(mergeToken);
    for (const record of newlyLit) {
      for (const delta of FACE_NEIGHBOR_KEY_DELTAS) {
        const neighbor = this.store.getByKey(record.key + delta);
        if (neighbor?.hasMeshActivity) this.meshes.markInputsChanged(neighbor, false);
      }
    }
    for (const record of newlyLit) this.meshes.considerNeighborhood(record.key);
  }

  private onMeshReady(
    record: ChunkRecord,
    mesh: Parameters<ChunkPipelineEvents["onMeshReady"]>[1],
    isFirstMesh: boolean,
  ): void {
    if (isFirstMesh) {
      profiler.recordTimer("chunk.pipeline.total", profiler.now() - record.requestedAtMs, "latency");
    }
    this.startArea?.markReached(record.key, START_STAGE_MESHED);
    this.options.events.onMeshReady(record, mesh);
  }

  private takeOwnershipOfEditedChunks(batch: BlockEditBatch): void {
    let lastChunkKey = Number.NaN;
    for (let position = 0; position < batch.length; position++) {
      const key = packChunkKey(batch.xs[position]! >> 5, batch.ys[position]! >> 5, batch.zs[position]! >> 5);
      if (key === lastChunkKey) continue;
      lastChunkKey = key;
      const record = this.store.getByKey(key);
      if (!record?.blocks) continue;
      record.ensureOwnBlocks();
      if (record.isLit) record.ensureOwnLight();
    }
  }

  private markEditedChunksMixed(result: BulkEditResult): void {
    const { changes } = result;
    if (changes.count === 0 && result.changedChunks.length > 0) {
      for (const chunk of result.changedChunks) {
        const record = this.store.get(chunk.x, chunk.y, chunk.z);
        if (record) record.uniformBlock = -1;
      }
      return;
    }
    let lastChunkKey = Number.NaN;
    for (let position = 0; position < changes.count; position++) {
      const key = packChunkKey(changes.x[position]! >> 5, changes.y[position]! >> 5, changes.z[position]! >> 5);
      if (key === lastChunkKey) continue;
      lastChunkKey = key;
      const record = this.store.getByKey(key);
      if (record) record.uniformBlock = -1;
    }
  }
}
