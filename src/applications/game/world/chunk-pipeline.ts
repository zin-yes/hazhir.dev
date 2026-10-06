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
import { DIMENSIONS } from "../profiler/dimensions";
import {
  applyBlockEdits as applyBlockEditsToChunks,
  type BulkEditOptions,
  type BulkEditResult,
} from "../edits/apply-block-edits";
import { BlockEditBatch, type BlockEdit } from "../edits/block-edit-batch";
import { CELLS_PER_CHUNK, type LightChunkSource } from "../edits/chunk-cluster";
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
  type ChunkStage,
  ChunkRecord,
  ColumnRecord,
  SHARED_DARK_LIGHT,
  isSealedUniformBlock,
  sharedUniformBlocks,
} from "./chunk-record";
import { publishChunkCompressionProfilerStats } from "./chunk-compression";
import { ChunkStore } from "./chunk-store";
import { drainLoadOrderMembershipStats, type LoadOrder } from "./load-order";
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
  loadedVolumeOf,
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

const CHUNK_STAGES: readonly ChunkStage[] = ["pending", "generating", "generated", "lighting", "lit"];
const STAGE_COUNT_GAUGES = Object.fromEntries(CHUNK_STAGES.map((stage) => [stage, `game.chunks.stage.${stage}`])) as Record<
  ChunkStage,
  string
>;
const UNLOADED_WHILE_COUNTERS = Object.fromEntries(
  CHUNK_STAGES.map((stage) => [stage, `game.chunks.unloadedWhile.${stage}`]),
) as Record<ChunkStage, string>;

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

function countSetFaceBits(changedFaces: number): number {
  let count = 0;
  for (let faceBit = 0; faceBit < FACE_NEIGHBOR_KEY_DELTAS.length; faceBit++) {
    if ((changedFaces & (1 << faceBit)) !== 0) count++;
  }
  return count;
}

/** The affinity tile a column belongs to, as one number. */
export function affinityTileKeyOf(chunkX: number, chunkZ: number): number {
  const tileSize = AFFINITY_TILE_SIZE_IN_CHUNKS;
  return packColumnKey(Math.floor(chunkX / tileSize), Math.floor(chunkZ / tileSize));
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
    getBlocks: (chunkX, chunkY, chunkZ) => {
      const blocks = this.store.get(chunkX, chunkY, chunkZ)?.blocks ?? undefined;
      this.lookupStats.sourceBlockLookups++;
      if (blocks === undefined) this.lookupStats.sourceBlockMisses++;
      return blocks;
    },
    getLight: (chunkX, chunkY, chunkZ) => {
      const record = this.store.get(chunkX, chunkY, chunkZ);
      const light = record?.isLit ? (record.light ?? undefined) : undefined;
      this.lookupStats.sourceLightLookups++;
      if (light === undefined) this.lookupStats.sourceLightMisses++;
      return light;
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
  private readonly lightingQueue = new PriorityScheduler<number>({ profilerLane: "lighting" });
  private readonly columnsBeingLit = new Set<number>();
  private readonly meshes: MeshCoordinator;
  private readonly playerChunk = createChunkCoordinates();
  private readonly lastRankedForward = { x: 0, y: 0, z: 0 };
  private readonly columnScratch = createColumnCoordinates();
  private startArea: StartAreaProgress | null = null;
  private isDisposed = false;
  private readonly removeProfilerSampler: () => void;
  private readonly generationWorkerBusyGauges: string[];
  private readonly generationWorkerDispatchCounters: string[];
  /** Hot lookups counted as plain integers and published once a second by publishProfilerGauges. */
  private readonly lookupStats = {
    blockLookups: 0,
    blockLookupsLoaded: 0,
    blockLookupsAssumedAir: 0,
    blockLookupsUnknown: 0,
    lightLookups: 0,
    lightLookupsUnknown: 0,
    sourceBlockLookups: 0,
    sourceBlockMisses: 0,
    sourceLightLookups: 0,
    sourceLightMisses: 0,
    readyToShowChecks: 0,
    readyToShowBlockedByNeighbor: 0,
    columnPriorityComputations: 0,
  };

  constructor(private readonly options: ChunkPipelineOptions) {
    this.renderSettings = normalizeRenderSettings(options.renderSettings ?? {});
    this.drawnVolume = renderVolumeOf(this.renderSettings);
    this.planner = new ChunkStreamPlanner(streamConfigFor(this.renderSettings, this.surfaceChunkYFor));
    const preferredWorker = options.preferredGenerationWorker ?? chunkColumnAffinityKey;
    this.generationQueues = new AffinityQueues(
      options.generation.workerCount,
      (columnKey) => {
        const column = unpackColumnKey(columnKey, this.columnScratch);
        return preferredWorker(column.chunkX, column.chunkZ);
      },
      START_AREA_GENERATION_AFFINITY_GAP,
      (columnKey) => {
        const column = unpackColumnKey(columnKey, this.columnScratch);
        return affinityTileKeyOf(column.chunkX, column.chunkZ);
      },
      "generation",
    );
    this.generationQueues.transfersWholeGroups = false;
    this.generationWorkerBusy = new Array(options.generation.workerCount).fill(false);
    this.generationWorkerBusyGauges = this.generationWorkerBusy.map((_, workerIndex) => `game.generation.worker${workerIndex}.busy`);
    this.generationWorkerDispatchCounters = this.generationWorkerBusy.map(
      (_, workerIndex) => `game.generation.worker${workerIndex}.dispatched`,
    );
    this.meshes = new MeshCoordinator(this.store, options.meshing, {
      priorityOf: (key) => this.planner.priorityOfKey(key),
      isInDrawnVolume: (record) => this.isInDrawnVolume(record),
      onMeshReady: (record, mesh, isFirstMesh) => this.onMeshReady(record, mesh, isFirstMesh),
      isOpenSkyAbove: (record) => this.isOpenSkyAbove(record),
    });
    this.removeProfilerSampler = profiler.addSampler(() => this.publishProfilerGauges());
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
    profiler.addCounter("game.pipeline.updates");
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
      const unloadToken = profiler.begin("main.chunk.applyPlan.unload");
      for (const key of plan.toUnload) this.removeChunk(key);
      profiler.end(unloadToken);
      const loadToken = profiler.begin("main.chunk.applyPlan.load");
      for (let index = 0; index < plan.toLoad.length; index++) this.addChunk(plan.toLoad[index]!);
      profiler.end(loadToken);
      this.rankQueuedWork(forward, "playerMoved");
      const revisitToken = profiler.begin("main.chunk.revisitWaitingMeshes");
      this.meshes.revisitWaiting();
      profiler.end(revisitToken);
    } else if (this.hasTurnedFar(forward)) {
      this.rankQueuedWork(forward, "cameraTurned");
    }
    this.pump();
  }

  /**
   * New distances. A smaller volume applies at once: chunks outside the new loaded volume unload (the unload
   * hysteresis is for walking back and forth, not for settings) and meshes outside the new drawn volume leave the
   * screen.
   */
  setRenderSettings(settings: Partial<RenderSettings>): void {
    const settingsToken = profiler.begin("main.chunk.setRenderSettings");
    try {
      this.applyRenderSettings(settings);
    } finally {
      profiler.end(settingsToken);
    }
  }

  private applyRenderSettings(settings: Partial<RenderSettings>): void {
    profiler.addCounter("game.pipeline.renderSettingsChanges");
    this.renderSettings = normalizeRenderSettings({ ...this.renderSettings, ...settings });
    this.drawnVolume = renderVolumeOf(this.renderSettings);
    this.planner.setConfig(streamConfigFor(this.renderSettings, this.surfaceChunkYFor));
    if (!this.startArea) return;
    const loadedVolume = loadedVolumeOf(this.renderSettings);
    const keysToUnload: number[] = [];
    const recordsLeavingView: ChunkRecord[] = [];
    this.store.forEach((record) => {
      const offsetX = record.chunkX - this.playerChunk.chunkX;
      const offsetY = record.chunkY - this.playerChunk.chunkY;
      const offsetZ = record.chunkZ - this.playerChunk.chunkZ;
      if (!loadedVolume.contains(offsetX, offsetY, offsetZ)) keysToUnload.push(record.key);
      else if (!this.drawnVolume.contains(offsetX, offsetY, offsetZ)) recordsLeavingView.push(record);
    });
    for (const key of keysToUnload) this.removeChunk(key);
    for (const record of recordsLeavingView) this.meshes.dropMesh(record);
    profiler.addCounter("game.pipeline.settingsUnloadedChunks", keysToUnload.length);
    profiler.addCounter("game.pipeline.settingsDroppedMeshes", recordsLeavingView.length);
    if (keysToUnload.length > 0) this.planner.invalidate();
  }

  getBlock(x: number, y: number, z: number): number | null {
    const chunkX = Math.floor(x / CHUNK_WIDTH);
    const chunkY = Math.floor(y / CHUNK_HEIGHT);
    const chunkZ = Math.floor(z / CHUNK_LENGTH);
    const record = this.store.get(chunkX, chunkY, chunkZ);
    this.lookupStats.blockLookups++;
    if (record?.blocks) {
      this.lookupStats.blockLookupsLoaded++;
      return record.blocks[
        ((x - chunkX * CHUNK_WIDTH) << 10) | ((y - chunkY * CHUNK_HEIGHT) << 5) | (z - chunkZ * CHUNK_LENGTH)
      ]!;
    }
    if (record) {
      this.lookupStats.blockLookupsUnknown++;
      return null;
    }
    const surfaceChunkY = this.surfaceChunkYFor(chunkX, chunkZ);
    if (surfaceChunkY !== undefined && chunkY > surfaceChunkY) {
      this.lookupStats.blockLookupsAssumedAir++;
      return BlockType.AIR;
    }
    this.lookupStats.blockLookupsUnknown++;
    return null;
  }

  getLight(x: number, y: number, z: number): number | null {
    const chunkX = Math.floor(x / CHUNK_WIDTH);
    const chunkY = Math.floor(y / CHUNK_HEIGHT);
    const chunkZ = Math.floor(z / CHUNK_LENGTH);
    const record = this.store.get(chunkX, chunkY, chunkZ);
    this.lookupStats.lightLookups++;
    if (!record?.isLit || !record.light) {
      this.lookupStats.lightLookupsUnknown++;
      return null;
    }
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
    const editToken = profiler.begin("main.edit.pipelineApply");
    try {
      const batch = edits instanceof BlockEditBatch ? edits : BlockEditBatch.fromEdits(edits);
      profiler.addCounter("game.edit.batches");
      profiler.sampleGauge("game.edit.batchSize", batch.length);
      this.takeOwnershipOfEditedChunks(batch);
      const result = applyBlockEditsToChunks(this.lightSource, batch, options);
      const versionToken = profiler.begin("main.edit.bumpEditVersions");
      for (const chunk of result.changedChunks) {
        const record = this.store.get(chunk.x, chunk.y, chunk.z);
        if (record) record.editVersion++;
      }
      profiler.end(versionToken);
      this.markEditedChunksMixed(result);
      const remeshToken = profiler.begin("main.edit.queueRemeshes");
      const meshesApplied: Promise<void>[] = [];
      for (const chunk of result.chunksToRemesh) {
        const record = this.store.get(chunk.x, chunk.y, chunk.z);
        if (!record) {
          profiler.addCounter("game.edit.remeshTargetsMissing");
          continue;
        }
        this.meshes.markInputsChanged(record, true);
        meshesApplied.push(this.meshes.waitForMesh(record));
      }
      profiler.end(remeshToken);
      profiler.addCounter("game.edit.chunksQueuedForRemesh", meshesApplied.length);
      profiler.addCounter("game.edit.chunksVersionBumped", result.changedChunks.length);
      this.pump();
      return { ...result, meshesApplied };
    } finally {
      profiler.end(editToken);
    }
  }

  /**
   * Whether a meshed chunk can be shown without exposing what its neighbors will cover: every face neighbor that will
   * be drawn has its first mesh too. Until then the chunk's cave walls and buried faces would show through the
   * neighbor's missing surface, unlit and black.
   */
  isReadyToShow(record: ChunkRecord): boolean {
    this.lookupStats.readyToShowChecks++;
    if (record.appliedMeshVersion < 0) return false;
    if (this.isNextToPlayer(record)) return true;
    for (const delta of FACE_NEIGHBOR_KEY_DELTAS) {
      const neighbor = this.store.getByKey(record.key + delta);
      if (neighbor && neighbor.appliedMeshVersion < 0 && this.isInDrawnVolume(neighbor)) {
        this.lookupStats.readyToShowBlockedByNeighbor++;
        return false;
      }
    }
    return true;
  }

  /** The loaded face neighbors of a chunk (reused array: read it before the next call). */
  faceNeighborsOf(record: ChunkRecord): ReadonlyArray<ChunkRecord | undefined> {
    return this.store.neighborsOfKey(record.key);
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
    const statsToken = profiler.begin("main.chunk.stats");
    try {
      return this.collectStats();
    } finally {
      profiler.end(statsToken);
    }
  }

  private collectStats() {
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

  /**
   * Once a second while profiling: chunks per stage, owned and shared chunk memory, queue and worker levels, and
   * the lookup and cache traffic that is too hot to record call by call.
   */
  private publishProfilerGauges(): void {
    const scopeToken = profiler.begin("main.chunk.publishProfilerGauges");
    try {
      this.publishChunkInventory();
      this.store.publishProfilerStats();
      this.generationQueues.publishProfilerGauges();
      this.lightingQueue.publishProfilerGauges();
      this.meshes.publishProfilerGauges();
      this.publishLookupTraffic();
      publishChunkCompressionProfilerStats();
      profiler.sampleGauge("game.pipeline.columns", this.columns.size);
      profiler.sampleGauge("game.pipeline.columnsBeingLit", this.columnsBeingLit.size);
      profiler.sampleGauge("game.pipeline.surfaceHints", this.surfaceChunkYByColumn.size);
      profiler.sampleGauge("game.pipeline.generationRetriesTracked", this.generationAttemptsByColumn.size);
      profiler.sampleGauge("game.pipeline.busyGenerationWorkers", this.countBusyGenerationWorkers());
      for (let workerIndex = 0; workerIndex < this.generationWorkerBusy.length; workerIndex++) {
        profiler.sampleGauge(this.generationWorkerBusyGauges[workerIndex]!, this.generationWorkerBusy[workerIndex] ? 1 : 0);
      }
    } finally {
      profiler.end(scopeToken);
    }
  }

  private publishChunkInventory(): void {
    const chunkCountByStage: Record<ChunkStage, number> = { pending: 0, generating: 0, generated: 0, lighting: 0, lit: 0 };
    let chunksWithMesh = 0;
    let uniformChunks = 0;
    let airChunks = 0;
    let ownedBlockBytes = 0;
    let ownedLightBytes = 0;
    let sharedBlockChunks = 0;
    let sharedLightChunks = 0;
    this.store.forEach((record) => {
      chunkCountByStage[record.stage]++;
      if (record.appliedMeshVersion >= 0) chunksWithMesh++;
      if (record.uniformBlock >= 0) uniformChunks++;
      if (record.uniformBlock === BlockType.AIR) airChunks++;
      if (record.blocks) {
        if (record.ownsBlocks) ownedBlockBytes += record.blocks.byteLength;
        else sharedBlockChunks++;
      }
      if (record.light) {
        if (record.ownsLight) ownedLightBytes += record.light.byteLength;
        else sharedLightChunks++;
      }
    });
    for (const stage of CHUNK_STAGES) {
      profiler.sampleGauge(STAGE_COUNT_GAUGES[stage], chunkCountByStage[stage]);
      profiler.recordBreakdown(DIMENSIONS.chunkStage, stage, { units: chunkCountByStage[stage], calls: 1 });
    }
    profiler.sampleGauge("game.chunks.withMesh", chunksWithMesh);
    profiler.sampleGauge("game.chunks.uniform", uniformChunks);
    profiler.sampleGauge("game.chunks.air", airChunks);
    profiler.sampleGauge("memory.chunkRecords.ownedBlockBytes", ownedBlockBytes, "bytes");
    profiler.sampleGauge("memory.chunkRecords.ownedLightBytes", ownedLightBytes, "bytes");
    profiler.sampleGauge("game.chunks.sharedBlockArrays", sharedBlockChunks);
    profiler.sampleGauge("game.chunks.sharedLightArrays", sharedLightChunks);
  }

  private publishLookupTraffic(): void {
    const stats = this.lookupStats;
    profiler.addCounter("game.pipeline.getBlock.calls", stats.blockLookups);
    profiler.addCounter("game.pipeline.getBlock.loaded", stats.blockLookupsLoaded);
    profiler.addCounter("game.pipeline.getBlock.assumedAir", stats.blockLookupsAssumedAir);
    profiler.addCounter("game.pipeline.getBlock.unknown", stats.blockLookupsUnknown);
    profiler.addCounter("game.pipeline.getLight.calls", stats.lightLookups);
    profiler.addCounter("game.pipeline.getLight.unknown", stats.lightLookupsUnknown);
    profiler.addCounter("game.pipeline.lightSource.blockLookups", stats.sourceBlockLookups);
    profiler.addCounter("game.pipeline.lightSource.blockMisses", stats.sourceBlockMisses);
    profiler.addCounter("game.pipeline.lightSource.lightLookups", stats.sourceLightLookups);
    profiler.addCounter("game.pipeline.lightSource.lightMisses", stats.sourceLightMisses);
    profiler.addCounter("game.pipeline.readyToShow.checks", stats.readyToShowChecks);
    profiler.addCounter("game.pipeline.readyToShow.blockedByNeighbor", stats.readyToShowBlockedByNeighbor);
    profiler.addCounter("game.pipeline.columnPriorityComputations", stats.columnPriorityComputations);
    const membership = drainLoadOrderMembershipStats();
    profiler.addCounter("game.streaming.membershipTests", membership.tests);
    profiler.addCounter("game.streaming.membershipInside", membership.inside);
    for (const name of Object.keys(stats) as (keyof typeof stats)[]) stats[name] = 0;
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
    this.removeProfilerSampler();
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
    const startAreaToken = profiler.begin("main.chunk.createStartArea");
    try {
      return this.buildStartArea();
    } finally {
      profiler.end(startAreaToken);
    }
  }

  private buildStartArea(): StartAreaProgress {
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
        this.generationQueues.transfersWholeGroups = true;
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

  private rankQueuedWork(forward: PlannerForwardVector, reason: "playerMoved" | "cameraTurned"): void {
    const rankToken = profiler.begin("main.chunk.rankQueuedWork");
    profiler.addCounter(reason === "playerMoved" ? "game.pipeline.reranksAfterMove" : "game.pipeline.reranksAfterTurn");
    const length = Math.hypot(forward.x, forward.y, forward.z) || 1;
    this.lastRankedForward.x = forward.x / length;
    this.lastRankedForward.y = forward.y / length;
    this.lastRankedForward.z = forward.z / length;
    this.generationQueues.reprioritizeAll((columnKey) => this.columnPriority(columnKey));
    this.lightingQueue.reprioritizeAll((columnKey) => this.columnPriority(columnKey));
    this.meshes.reprioritizeAll();
    profiler.end(rankToken);
  }

  private columnPriority(columnKey: number): number {
    this.lookupStats.columnPriorityComputations++;
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

  /** The chunk above is skipped as air (more than SKIP_ABOVE_SURFACE_MARGIN above the column's surface). */
  private isOpenSkyAbove(record: ChunkRecord): boolean {
    const surfaceChunkY = this.surfaceChunkYFor(record.chunkX, record.chunkZ);
    return surfaceChunkY !== undefined && record.chunkY + 1 > surfaceChunkY + SKIP_ABOVE_SURFACE_MARGIN;
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
    profiler.addCounter("game.chunks.requested");
    let column = this.columns.get(record.columnKey);
    if (!column) {
      column = new ColumnRecord(record.columnKey, record.chunkX, record.chunkZ);
      this.columns.set(column.key, column);
      profiler.addCounter("game.columns.created");
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
    profiler.addCounter(UNLOADED_WHILE_COUNTERS[record.stage]);
    if (record.stage === "generating" || record.stage === "lighting") profiler.addCounter("game.chunks.unloadedWhileInFlight");
    if (record.appliedMeshVersion >= 0) profiler.addCounter("game.chunks.unloadedWithMesh");
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
        profiler.addCounter("game.columns.removed");
      } else {
        this.scheduleLighting(column);
      }
    }
    this.meshes.considerNeighborhood(key);
  }

  private pump(): void {
    if (this.isDisposed) return;
    profiler.addCounter("game.pipeline.pumps");
    const pumpToken = profiler.begin("main.chunk.pump");
    try {
      this.pumpGeneration();
      this.pumpLighting();
      const meshPumpToken = profiler.begin("main.chunk.pump.meshes");
      this.meshes.pump();
      profiler.end(meshPumpToken);
    } finally {
      profiler.end(pumpToken);
    }
  }

  private pumpGeneration(): void {
    const generationToken = profiler.begin("main.chunk.pump.generation");
    try {
      this.takeGenerationWork();
    } finally {
      profiler.end(generationToken);
    }
  }

  private takeGenerationWork(): void {
    for (let workerIndex = 0; workerIndex < this.generationWorkerBusy.length; workerIndex++) {
      while (!this.generationWorkerBusy[workerIndex]) {
        const columnKey = this.generationQueues.takeFor(workerIndex);
        if (columnKey === undefined) break;
        const column = this.columns.get(columnKey);
        if (!column || column.isGenerating || column.pendingChunkKeys.size === 0) {
          profiler.addCounter("game.generation.staleColumnsSkipped");
          continue;
        }
        this.dispatchGeneration(column, workerIndex);
      }
    }
  }

  private dispatchGeneration(column: ColumnRecord, workerIndex: number): void {
    const dispatchToken = profiler.begin("main.chunk.dispatchGeneration");
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
    profiler.addCounter("game.generation.dispatched");
    profiler.addCounter(this.generationWorkerDispatchCounters[workerIndex]!);
    profiler.sampleGauge("game.generation.chunksPerDispatch", records.length);
    profiler.end(dispatchToken);
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
          profiler.addCounter("game.generation.failures");
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
      profiler.addCounter("game.generation.retries");
      this.generationQueues.schedule(column.key, this.columnPriority(column.key));
    } else {
      profiler.addCounter("game.generation.gaveUp");
    }
  }

  private acceptGeneratedColumn(column: ColumnRecord, records: ChunkRecord[], generated: GeneratedColumn): void {
    const acceptToken = profiler.begin("main.chunk.acceptGeneratedColumn");
    try {
      this.storeGeneratedColumn(column, records, generated);
    } finally {
      profiler.end(acceptToken);
    }
  }

  private storeGeneratedColumn(column: ColumnRecord, records: ChunkRecord[], generated: GeneratedColumn): void {
    column.isGenerating = false;
    profiler.addCounter("game.generation.columnsReturned");
    profiler.sampleGauge("game.generation.chunksReturnedPerColumn", generated.chunks.length);
    if (generated.surfaceChunkY === null) profiler.addCounter("game.generation.columnsWithoutSurface");
    if (generated.surfaceChunkY !== null) {
      column.surfaceChunkY = generated.surfaceChunkY;
      this.surfaceChunkYByColumn.set(column.key, generated.surfaceChunkY);
    }
    const generatedByChunkY = new Map<number, GeneratedColumnChunk>();
    for (const chunk of generated.chunks) generatedByChunkY.set(chunk.chunkY, chunk);
    const nowMs = profiler.now();
    for (const record of records) {
      const chunk = generatedByChunkY.get(record.chunkY);
      if (!chunk || this.store.getByKey(record.key) !== record) {
        profiler.addCounter(chunk ? "game.generation.resultsForUnloadedChunks" : "game.generation.chunksMissingFromResult");
        continue;
      }
      this.storeGeneratedBlocks(record, chunk);
      record.stage = "generated";
      this.counters.chunksGenerated++;
      profiler.addCounter("game.chunks.generated");
      profiler.recordTimer("chunk.pipeline.generate", nowMs - record.requestedAtMs, "latency");
      this.options.events.onChunkGenerated?.(record);
      this.startArea?.markReached(record.key, START_STAGE_GENERATED);
    }
    if (this.columns.get(column.key) !== column) {
      profiler.addCounter("game.generation.columnsUnloadedWhileGenerating");
      return;
    }
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
      profiler.addCounter("game.chunks.generatedMixed");
      profiler.recordBytes("bytes.chunks.generatedBlocks", record.blocks.byteLength);
    } else {
      record.blocks = sharedUniformBlocks(chunk.uniformBlock);
      record.ownsBlocks = false;
      record.uniformBlock = chunk.uniformBlock;
      profiler.addCounter("game.chunks.generatedUniform");
    }
    const savedEdits = this.options.events.savedEditsFor?.(record.chunkX, record.chunkY, record.chunkZ);
    if (!savedEdits || savedEdits.size === 0) return;
    const applyToken = profiler.begin("main.chunk.applySavedEdits");
    const blocks = record.ensureOwnBlocks();
    savedEdits.forEach((block, index) => {
      blocks[index] = block;
    });
    const uniformToken = profiler.begin("main.chunk.applySavedEdits.uniformScan");
    record.uniformBlock = uniformByteValue(blocks);
    profiler.end(uniformToken);
    profiler.addCounter("game.chunks.savedEditsApplied", savedEdits.size);
    profiler.addCounter("game.chunks.withSavedEdits");
    profiler.sampleGauge("game.chunks.savedEditsPerChunk", savedEdits.size);
    profiler.end(applyToken);
  }

  /** Chunks well above a column's surface are all air: drop them unless the player is right there. */
  private dropChunksAboveSurface(column: ColumnRecord): void {
    const surfaceChunkY = this.surfaceChunkYFor(column.chunkX, column.chunkZ);
    if (surfaceChunkY === undefined) return;
    const dropToken = profiler.begin("main.chunk.dropAboveSurface");
    const highestKeptChunkY = surfaceChunkY + SKIP_ABOVE_SURFACE_MARGIN;
    for (const key of Array.from(column.chunkKeys)) {
      const record = this.store.getByKey(key);
      if (!record || record.chunkY <= highestKeptChunkY) continue;
      if (this.isNextToPlayer(record)) {
        profiler.addCounter("game.chunks.keptAboveSurfaceNearPlayer");
        continue;
      }
      this.counters.chunksSkippedAboveSurface++;
      profiler.addCounter("game.chunks.skippedAboveSurface");
      this.removeChunk(key);
    }
    profiler.end(dropToken);
  }

  private scheduleLighting(column: ColumnRecord): void {
    if (column.isGenerating || column.isLighting || column.pendingChunkKeys.size > 0) {
      profiler.addCounter("game.lighting.scheduleSkippedColumnBusy");
      return;
    }
    if (!this.hasChunkWaitingForLight(column)) {
      profiler.addCounter("game.lighting.scheduleSkippedNothingWaiting");
      return;
    }
    profiler.addCounter("game.lighting.scheduled");
    this.lightingQueue.schedule(column.key, column.key, this.columnPriority(column.key));
  }

  private hasChunkWaitingForLight(column: ColumnRecord): boolean {
    for (const key of column.chunkKeys) {
      if (this.store.getByKey(key)?.stage === "generated") return true;
    }
    return false;
  }

  private pumpLighting(): void {
    const lightingToken = profiler.begin("main.chunk.pump.lighting");
    try {
      this.takeLightingWork();
    } finally {
      profiler.end(lightingToken);
    }
  }

  private takeLightingWork(): void {
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
      if (!column || column.isLighting || column.isGenerating || column.pendingChunkKeys.size > 0) {
        profiler.addCounter("game.lighting.staleColumnsSkipped");
        continue;
      }
      if (this.touchesColumnBeingLit(column)) {
        deferredColumnKeys.push(columnKey);
        continue;
      }
      this.dispatchLighting(column);
    }
    profiler.addCounter("game.lighting.candidatesExamined", candidatesExamined);
    profiler.addCounter("game.lighting.deferredByNeighborColumn", deferredColumnKeys.length);
    if (candidatesExamined >= MAX_LIGHTING_CANDIDATES_PER_DISPATCH) profiler.addCounter("game.lighting.candidateLimitHit");
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
    const slabToken = profiler.begin("main.light.collectRegionInputs.surroundingSlabs");
    const slabs = collectSurroundingSlabs(region, this.getLitChunkView);
    profiler.end(slabToken);
    const involved: { record: ChunkRecord; editVersion: number }[] = region.map((record) => ({
      record,
      editVersion: record.editVersion,
    }));
    let slabBytes = 0;
    let slabsWithBlocks = 0;
    let slabsWithLight = 0;
    for (const slab of slabs) {
      const surrounding = this.store.get(slab.chunkX, slab.chunkY, slab.chunkZ);
      if (surrounding) involved.push({ record: surrounding, editVersion: surrounding.editVersion });
      slabBytes += (slab.blocks?.byteLength ?? 0) + (slab.light?.byteLength ?? 0);
      if (slab.blocks) slabsWithBlocks++;
      if (slab.light) slabsWithLight++;
    }
    const copyToken = profiler.begin("main.light.collectRegionInputs.copyRegionBlocks");
    let regionBlockBytesCopied = 0;
    let regionUniformChunks = 0;
    const regionChunks = region.map((record) => {
      if (record.uniformBlock >= 0) regionUniformChunks++;
      else regionBlockBytesCopied += CELLS_PER_CHUNK;
      return {
        chunkX: record.chunkX,
        chunkY: record.chunkY,
        chunkZ: record.chunkZ,
        blocks: record.uniformBlock >= 0 ? null : (record.blocks as Uint8Array).slice(),
        uniformBlock: record.uniformBlock,
      };
    });
    profiler.end(copyToken);
    profiler.end(collectToken);
    this.counters.slabBytesSent += slabBytes;
    profiler.recordBytes("bytes.light.surroundingSlabs", slabBytes);
    profiler.recordBytes("bytes.light.regionBlocksCopied", regionBlockBytesCopied);
    profiler.addCounter("game.lighting.dispatched");
    profiler.addCounter("game.lighting.regionUniformChunks", regionUniformChunks);
    profiler.addCounter("game.lighting.slabsSent", slabs.length);
    profiler.addCounter("game.lighting.slabsWithBlocks", slabsWithBlocks);
    profiler.addCounter("game.lighting.slabsWithLight", slabsWithLight);
    profiler.sampleGauge("game.lighting.regionChunks", region.length);
    profiler.sampleGauge("game.lighting.involvedRecords", involved.length);
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
          profiler.addCounter("game.lighting.failures");
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
    const staleCheckToken = profiler.begin("main.light.checkStaleRegion");
    const isStale = involved.some(
      ({ record, editVersion }) => this.store.getByKey(record.key) === record && record.editVersion !== editVersion,
    );
    profiler.end(staleCheckToken);
    profiler.addCounter("game.light.regionResultsReturned");
    if (isStale) {
      this.counters.regionLightingRetries++;
      profiler.addCounter("game.light.regionRetries");
      this.returnRegionToGenerated(region);
      if (this.columns.get(column.key) === column) this.scheduleLighting(column);
      return;
    }
    const mergeToken = profiler.begin("main.light.mergeRegion");
    const assignToken = profiler.begin("main.light.mergeRegion.assignLight");
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
      if (isSealed) profiler.addCounter("game.light.sealedChunksSharedDark");
      else profiler.recordBytes("bytes.light.regionLightReceived", chunkLight.light.byteLength);
      this.startArea?.markReached(key, START_STAGE_LIT);
    }
    profiler.end(assignToken);
    profiler.addCounter("game.light.regionChunksLitFromResult", newlyLit.length);
    const surroundingToken = profiler.begin("main.light.mergeRegion.surroundings");
    let mergesChangedLight = 0;
    let mergesSkippedNotLit = 0;
    let faceBitsChanged = 0;
    for (const update of result.surroundingUpdates) {
      const surrounding = this.store.get(update.chunkX, update.chunkY, update.chunkZ);
      if (!surrounding?.isLit) {
        mergesSkippedNotLit++;
        continue;
      }
      const changedFaces = mergeLightReportingFaces(surrounding.ensureOwnLight() as Uint8Array, update.light);
      if (changedFaces !== 0) {
        mergesChangedLight++;
        faceBitsChanged += countSetFaceBits(changedFaces);
        this.meshes.markLightChanged(surrounding, changedFaces);
      }
    }
    profiler.end(surroundingToken);
    profiler.end(mergeToken);
    profiler.addCounter("game.light.surroundingUpdates", result.surroundingUpdates.length);
    profiler.addCounter("game.light.surroundingMergesChanged", mergesChangedLight);
    profiler.addCounter("game.light.surroundingMergesUnchanged", result.surroundingUpdates.length - mergesChangedLight - mergesSkippedNotLit);
    profiler.addCounter("game.light.surroundingMergesSkippedNotLit", mergesSkippedNotLit);
    profiler.addCounter("game.light.mergeFacesChanged", faceBitsChanged);
    profiler.recordBytes("bytes.light.surroundingMergeBytes", (result.surroundingUpdates.length - mergesSkippedNotLit) * CELLS_PER_CHUNK);
    const neighborRemeshToken = profiler.begin("main.light.markNeighborMeshes");
    for (const record of newlyLit) {
      for (const delta of FACE_NEIGHBOR_KEY_DELTAS) {
        const neighbor = this.store.getByKey(record.key + delta);
        if (neighbor?.hasMeshActivity) this.meshes.markInputsChanged(neighbor, false);
      }
    }
    profiler.end(neighborRemeshToken);
    const considerToken = profiler.begin("main.light.considerNeighborhoods");
    for (const record of newlyLit) this.meshes.considerNeighborhood(record.key);
    profiler.end(considerToken);
  }

  private onMeshReady(
    record: ChunkRecord,
    mesh: Parameters<ChunkPipelineEvents["onMeshReady"]>[1],
    isFirstMesh: boolean,
  ): void {
    if (isFirstMesh) {
      profiler.addCounter("game.mesh.firstMeshesApplied");
      profiler.recordTimer("chunk.pipeline.total", profiler.now() - record.requestedAtMs, "latency");
    } else {
      profiler.addCounter(mesh ? "game.mesh.rebuildsApplied" : "game.mesh.removalsApplied");
    }
    if (!mesh) profiler.addCounter("game.mesh.appliedEmpty");
    this.startArea?.markReached(record.key, START_STAGE_MESHED);
    this.options.events.onMeshReady(record, mesh);
  }

  private takeOwnershipOfEditedChunks(batch: BlockEditBatch): void {
    const ownershipToken = profiler.begin("main.edit.takeOwnership");
    let lastChunkKey = Number.NaN;
    let chunkRunsVisited = 0;
    let chunksWithoutBlocks = 0;
    for (let position = 0; position < batch.length; position++) {
      const key = packChunkKey(batch.xs[position]! >> 5, batch.ys[position]! >> 5, batch.zs[position]! >> 5);
      if (key === lastChunkKey) continue;
      lastChunkKey = key;
      chunkRunsVisited++;
      const record = this.store.getByKey(key);
      if (!record?.blocks) {
        chunksWithoutBlocks++;
        continue;
      }
      record.ensureOwnBlocks();
      if (record.isLit) record.ensureOwnLight();
    }
    profiler.end(ownershipToken);
    profiler.addCounter("game.edit.chunkRunsVisited", chunkRunsVisited);
    profiler.addCounter("game.edit.chunkRunsWithoutBlocks", chunksWithoutBlocks);
  }

  private markEditedChunksMixed(result: BulkEditResult): void {
    const mixedToken = profiler.begin("main.edit.markChunksMixed");
    try {
      this.markChunksNoLongerUniform(result);
    } finally {
      profiler.end(mixedToken);
    }
  }

  private markChunksNoLongerUniform(result: BulkEditResult): void {
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
