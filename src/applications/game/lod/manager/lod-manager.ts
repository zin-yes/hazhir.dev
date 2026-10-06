// The LOD engine behind a small integration surface. Each frame `update` selects the quadtree tiles for the camera,
// works out what can be drawn now (stand-ins while tiles build), queues builds by urgency, cross-fades the scene to
// the new set and keeps the cache under budget; `render` draws the LOD pass. Real chunks feed in through the chunk
// callbacks: their surfaces refine the near tiles and their coverage hides the LOD where the real renderer draws.

import * as THREE from "three";
import { profiler } from "../../profiler";
import { DIMENSIONS } from "../../profiler/dimensions";
import { BuildQueue, BuildUrgency, type BuildCandidate } from "../cache/build-queue";
import { LodTileCache } from "../cache/tile-cache";
import { BLOCK_RENDER_OFFSET, CHUNK_SIZE_BLOCKS, MAX_LOD_LEVEL, tileSizeOfLevel } from "../core/lod-constants";
import { lodLevelKey, metricNameOfLevel, perLevelMetricNames } from "../core/lod-level-keys";
import { ancestorAddressAt, childAddressesOf, tileBoundsOf, tileKeyOf, type TileAddress } from "../core/tile-address";
import { writeCoverageTexels } from "../coverage/real-chunk-coverage";
import { packedHeightRange } from "../data/packed-tile-surface";
import type { HeightRange } from "../data/tile-surface";
import { createLodMaterials, srgbHexToVector, type LodMaterials } from "../rendering/lod-materials";
import { LodRenderPass } from "../rendering/lod-render-pass";
import { createLodTileMesh, liveLodTileMeshCount, takeTileFadeUniformUpdateCount, type LodTileMesh } from "../rendering/lod-tile-mesh";
import {
  distanceToTile,
  horizontalDistanceToBounds,
  projectionScaleOf,
  selectTiles,
  type SelectionParameters,
} from "../selection/quadtree-selection";
import { computeRenderSet } from "../selection/render-set";
import type { LodTileBuildRequest, LodTileBuildResult } from "../worker/lod-tile-builder";
import { createEmptyLevelStatistics, type LodStats } from "./lod-stats";
import { RealDataTracker } from "./real-data-tracker";
import { TileDisplay } from "./tile-display";
import { createWorkerPoolExecutor, type TileBuildExecutor } from "./tile-build-executor";

export interface LodManagerOptions {
  seed: number;
  /** Creates one LOD worker; required unless `executor` is given. */
  workerFactory?: () => Worker;
  workerCount?: number;
  /** Replaces the worker pool (tests, headless benchmark). */
  executor?: TileBuildExecutor;
  /** LOD radius in chunks (32 blocks each). */
  renderDistanceChunks?: number;
  /** Largest on-screen size of a level-0 cell before its tile splits (pixels). */
  maximumCellPixels?: number;
  /** Per-level growth of that threshold, so detail thins out towards the horizon. */
  thresholdGrowthPerLevel?: number;
  minimumLevel?: number;
  /** GPU geometry plus packed surfaces of cached tiles. */
  memoryBudgetBytes?: number;
  /** Real chunk surfaces kept for the LOD (the sparse pyramid). */
  realDataBudgetBytes?: number;
  maximumBuildsInFlight?: number;
  fadeMilliseconds?: number;
  /** sRGB horizon colour the far terrain fades into. */
  fogColor?: number;
  realColumnsPerUpdate?: number;
  /** Minimum age before a drawn tile is rebuilt for newer real chunk data. */
  refreshIntervalMilliseconds?: number;
  now?: () => number;
}

export interface LodManager {
  /** The LOD scene (tiles and the adopted background), for debugging and profiling. */
  readonly scene: THREE.Scene;
  /** Selects, schedules and cross-fades tiles for this camera. Call once per frame before `render`. */
  update(camera: THREE.PerspectiveCamera, viewportHeightPixels: number): void;
  /** Draws the LOD pass (background first, then tiles) and clears depth for the main scene. */
  render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void;
  /** Called with the LOD camera after the tiles are drawn, right before the LOD pass clears depth. */
  setBeforeDepthClear(handler: ((camera: THREE.PerspectiveCamera) => void) | null): void;
  /** Moves the sky into the LOD pass so it draws behind the tiles. */
  adoptBackground(background: THREE.Object3D): void;
  setFogColor(srgbHex: number): void;
  /**
   * Renders the adopted background into a cube map and fades the far terrain into it, so the fog matches the sky
   * behind every tile. Call again when the sky changes.
   */
  captureBackgroundHaze(renderer: THREE.WebGLRenderer): void;
  /** Changes the LOD radius in place: cached tiles and real data are kept. */
  setRenderDistanceChunks(renderDistanceChunks: number): void;
  readonly renderDistanceChunks: number;
  /** True while the camera is well below the LOD surface; the pass then draws only the background. */
  readonly isCameraUnderground: boolean;
  /** A real chunk's blocks arrived (game layout, 32^3, index x * 1024 + y * 32 + z). */
  onRealChunkLoaded(chunkX: number, chunkY: number, chunkZ: number, blocks: Uint8Array): void;
  /** A real chunk's mesh is in the scene (call it for chunks without faces too). */
  onRealChunkMeshed(chunkX: number, chunkY: number, chunkZ: number): void;
  /** A real chunk is no longer drawn (its mesh was dropped or is held hidden) but its blocks stay known. */
  onRealChunkUnmeshed(chunkX: number, chunkY: number, chunkZ: number): void;
  onRealChunkUnloaded(chunkX: number, chunkY: number, chunkZ: number): void;
  /** Blocks of a loaded chunk changed (player edits, water, network). */
  onBlocksEdited(chunkX: number, chunkY: number, chunkZ: number, blocks: Uint8Array): void;
  getStats(): LodStats;
  dispose(): void;
}

interface FramePlan {
  drawn: TileAddress[];
  missingLeafCount: number;
  selectedLeafCount: number;
  hasUncoveredArea: boolean;
}

interface CachedTilePayload {
  tileMesh: LodTileMesh;
  builtAtMilliseconds: number;
}

const DEFAULT_RENDER_DISTANCE_CHUNKS = 256;
/** Largest LOD radius `setRenderDistanceChunks` accepts; the real data pyramid is built tall enough for it. */
export const MAXIMUM_RENDER_DISTANCE_CHUNKS = 512;
/** The terrain pass is skipped while the camera is this far below the lowest LOD surface around it. */
const UNDERGROUND_MARGIN_BLOCKS = 12;
const DEFAULT_MAXIMUM_CELL_PIXELS = 8;
const DEFAULT_THRESHOLD_GROWTH_PER_LEVEL = 1.2;
const DEFAULT_MEMORY_BUDGET_BYTES = 160 * 1024 * 1024;
const DEFAULT_REAL_DATA_BUDGET_BYTES = 24 * 1024 * 1024;
const DEFAULT_WORKER_COUNT = 2;
const DEFAULT_FADE_MILLISECONDS = 350;
const DEFAULT_FOG_COLOR = 0xbcd0e6;
const DEFAULT_REAL_COLUMNS_PER_UPDATE = 8;
const DEFAULT_REFRESH_INTERVAL_MILLISECONDS = 4000;
const MINIMUM_NEAR_PLANE = 0.5;
const MAXIMUM_NEAR_PLANE = 64;
/** A point at distance d can sit at view depth d * cos(corner angle); 0.45 covers wide screens at 85 degrees. */
const NEAR_PLANE_DEPTH_FACTOR = 0.45;
const NEAR_TILE_SEARCH_DISTANCE = 512;
const FOG_START_FRACTION = 0.2;
/** View direction quantization for re-planning (build priorities favour the frustum). */
const PLAN_DIRECTION_STEPS = 8;
/** Re-plan at least this often so time-based refreshes are picked up while standing still. */
const PLAN_MAXIMUM_AGE_MILLISECONDS = 1000;
const MINIMUM_FOG_START_BLOCKS = 512;
const DISSOLVE_START_FRACTION = 0.85;

const TILES_BUILT_PER_LEVEL = perLevelMetricNames("game.lod.tilesBuilt.");
const BUILT_VERTICES_PER_LEVEL = perLevelMetricNames("game.lod.build.vertices.");
const BUILT_TRIANGLES_PER_LEVEL = perLevelMetricNames("game.lod.build.triangles.");
const GEOMETRY_BYTES_PER_LEVEL = perLevelMetricNames("bytes.lod.tileGeometry.");
const PACKED_BYTES_PER_LEVEL = perLevelMetricNames("bytes.lod.packedSurface.");
const BUILD_FAILED_PER_LEVEL = perLevelMetricNames("game.lod.build.failed.");
/** Indexes of the plan key parts, grouped by what changed (see `update`). */
const REPLAN_REASON_COUNTERS = [
  { firstPart: 0, lastPart: 2, counterName: "game.lod.plan.reason.cameraMoved" },
  { firstPart: 3, lastPart: 5, counterName: "game.lod.plan.reason.cameraTurned" },
  { firstPart: 6, lastPart: 8, counterName: "game.lod.plan.reason.viewportChanged" },
  { firstPart: 9, lastPart: 9, counterName: "game.lod.plan.reason.stateChanged" },
  { firstPart: 10, lastPart: 10, counterName: "game.lod.plan.reason.coverageChanged" },
  { firstPart: 11, lastPart: 11, counterName: "game.lod.plan.reason.timeElapsed" },
];

/** Why the plan was invalidated: one counter per place that bumps the state version. */
const enum StateChange {
  TileEvicted = "game.lod.stateVersion.tileEvicted",
  RadiusChanged = "game.lod.stateVersion.radiusChanged",
  RealDataChanged = "game.lod.stateVersion.realDataChanged",
  TileBuilt = "game.lod.stateVersion.tileBuilt",
  BuildFailed = "game.lod.stateVersion.buildFailed",
  BudgetEvicted = "game.lod.stateVersion.budgetEvicted",
}

/** Work counted inside one plan or update, flushed to the profiler once per frame. */
interface PlanActivity {
  heightRangeLookups: number;
  heightRangeLevelsWalked: number;
  heightRangeUnresolved: number;
  standInChecks: number;
  standInFound: number;
  frustumTests: number;
  frustumRejected: number;
}

function createPlanActivity(): PlanActivity {
  return {
    heightRangeLookups: 0,
    heightRangeLevelsWalked: 0,
    heightRangeUnresolved: 0,
    standInChecks: 0,
    standInFound: 0,
    frustumTests: 0,
    frustumRejected: 0,
  };
}

function clearPlanActivity(activity: PlanActivity): void {
  activity.heightRangeLookups = 0;
  activity.heightRangeLevelsWalked = 0;
  activity.heightRangeUnresolved = 0;
  activity.standInChecks = 0;
  activity.standInFound = 0;
  activity.frustumTests = 0;
  activity.frustumRejected = 0;
}

export function createLodManager(options: LodManagerOptions): LodManager {
  return profiler.measure("main.lod.create", () => new LodManagerImplementation(options));
}

function clampRenderDistanceChunks(renderDistanceChunks: number): number {
  return Math.max(1, Math.min(MAXIMUM_RENDER_DISTANCE_CHUNKS, Math.round(renderDistanceChunks)));
}

export function maximumLevelForRadius(radiusBlocks: number): number {
  return Math.min(MAX_LOD_LEVEL, Math.max(0, Math.ceil(Math.log2(radiusBlocks / tileSizeOfLevel(0)))));
}

class LodManagerImplementation implements LodManager {
  private readonly pass = new LodRenderPass();
  private readonly materials: LodMaterials;
  private readonly executor: TileBuildExecutor;
  private readonly cache: LodTileCache<CachedTilePayload>;
  private readonly realData: RealDataTracker;
  private readonly display: TileDisplay;
  private readonly queue = new BuildQueue();
  private readonly frustum = new THREE.Frustum();
  private readonly projectionView = new THREE.Matrix4();
  private readonly tileBox = new THREE.Box3();
  private radiusBlocks: number;
  private maximumLevel: number;
  private cameraUnderground = false;
  private readonly maximumBuildsInFlight: number;
  private readonly now: () => number;
  private readonly createdAtMilliseconds: number;
  private previouslySplit = new Set<number>();
  private lastUpdateMilliseconds: number | undefined;
  private lastCoverageVersion = -1;
  private lastCoverageCenter = { chunkX: Number.NaN, chunkZ: Number.NaN };
  private nearPlane = MAXIMUM_NEAR_PLANE;
  private farPlane: number;
  private isDisposed = false;
  private readonly stats: LodStats;
  /** Bumped when the cache or the real data changes, which invalidates the current plan. */
  private stateVersion = 0;
  private lastPlanKey = "";
  private lastPlanKeyParts: readonly number[] = [];
  private lastPlan: FramePlan | undefined;
  private readonly planActivity = createPlanActivity();

  constructor(private readonly options: LodManagerOptions) {
    this.now = options.now ?? (() => performance.now());
    this.createdAtMilliseconds = this.now();
    this.radiusBlocks = clampRenderDistanceChunks(options.renderDistanceChunks ?? DEFAULT_RENDER_DISTANCE_CHUNKS) * CHUNK_SIZE_BLOCKS;
    this.maximumLevel = maximumLevelForRadius(this.radiusBlocks);
    this.farPlane = this.radiusBlocks * 1.25;
    const workerCount = options.workerCount ?? DEFAULT_WORKER_COUNT;
    this.maximumBuildsInFlight = options.maximumBuildsInFlight ?? workerCount * 2;
    if (options.executor !== undefined) {
      this.executor = options.executor;
    } else if (options.workerFactory !== undefined) {
      this.executor = createWorkerPoolExecutor(options.workerFactory, workerCount);
    } else {
      throw new Error("createLodManager needs a workerFactory (or an executor)");
    }
    this.materials = createLodMaterials(options.fogColor ?? DEFAULT_FOG_COLOR);
    this.applyRadiusUniforms();
    this.display = new TileDisplay(this.pass.tiles, options.fadeMilliseconds ?? DEFAULT_FADE_MILLISECONDS);
    this.cache = new LodTileCache<CachedTilePayload>(options.memoryBudgetBytes ?? DEFAULT_MEMORY_BUDGET_BYTES, (tile) => {
      this.invalidatePlan(StateChange.TileEvicted);
      this.display.remove(tile.address, tile.payload.tileMesh);
      const token = profiler.begin("main.lod.tileMesh.dispose", DIMENSIONS.lodLevel, lodLevelKey(tile.address.level));
      try {
        tile.payload.tileMesh.dispose();
      } finally {
        profiler.end(token);
      }
    });
    this.realData = new RealDataTracker(
      options.realDataBudgetBytes ?? DEFAULT_REAL_DATA_BUDGET_BYTES,
      maximumLevelForRadius(MAXIMUM_RENDER_DISTANCE_CHUNKS * CHUNK_SIZE_BLOCKS),
    );
    this.stats = {
      selectedTiles: 0,
      drawnTiles: 0,
      missingTiles: 0,
      queuedBuilds: 0,
      buildsInFlight: 0,
      builtTiles: 0,
      failedBuilds: 0,
      cachedTiles: 0,
      cacheBytes: 0,
      cacheBudgetBytes: this.cache.budgetBytes,
      evictedTiles: 0,
      realDataNodes: 0,
      realDataBytes: 0,
      coveredColumns: 0,
      pendingRealColumns: 0,
      firstHorizonMilliseconds: undefined,
      fullDetailMilliseconds: undefined,
      nearPlane: this.nearPlane,
      farPlane: this.farPlane,
      buildsByLevel: {},
    };
  }

  get scene(): THREE.Scene {
    return this.pass.scene;
  }

  get renderDistanceChunks(): number {
    return this.radiusBlocks / CHUNK_SIZE_BLOCKS;
  }

  get isCameraUnderground(): boolean {
    return this.cameraUnderground;
  }

  private invalidatePlan(change: StateChange): void {
    this.stateVersion++;
    profiler.addCounter(change);
  }

  private applyRadiusUniforms(): void {
    profiler.addCounter("game.lod.uniforms.radiusUpdates");
    const sceneUniforms = this.materials.sceneUniforms;
    sceneUniforms.hazeStart.value = Math.max(MINIMUM_FOG_START_BLOCKS, this.radiusBlocks * FOG_START_FRACTION);
    sceneUniforms.hazeEnd.value = this.radiusBlocks;
    sceneUniforms.dissolveStart.value = this.radiusBlocks * DISSOLVE_START_FRACTION;
    sceneUniforms.dissolveEnd.value = this.radiusBlocks;
  }

  setRenderDistanceChunks(renderDistanceChunks: number): void {
    const radiusBlocks = clampRenderDistanceChunks(renderDistanceChunks) * CHUNK_SIZE_BLOCKS;
    if (radiusBlocks === this.radiusBlocks) return;
    this.radiusBlocks = radiusBlocks;
    this.maximumLevel = maximumLevelForRadius(radiusBlocks);
    this.previouslySplit = new Set();
    this.applyRadiusUniforms();
    profiler.addCounter("game.lod.config.radiusChanges");
    this.invalidatePlan(StateChange.RadiusChanged);
  }

  captureBackgroundHaze(renderer: THREE.WebGLRenderer): void {
    const hazeCube = this.pass.captureBackground(renderer);
    profiler.addCounter("game.lod.uniforms.hazeCubeUpdates");
    const sceneUniforms = this.materials.sceneUniforms;
    sceneUniforms.hazeCube.value = hazeCube;
    sceneUniforms.useHazeCube.value = hazeCube === null ? 0 : 1;
  }

  /** Well below the lowest surface of the finest cached tile over the camera column (nothing cached: never). */
  private isBelowLodSurface(cameraBlockPosition: THREE.Vector3): boolean {
    const blockX = Math.floor(cameraBlockPosition.x);
    const blockZ = Math.floor(cameraBlockPosition.z);
    const tileSize = tileSizeOfLevel(0);
    const finestAddress: TileAddress = { level: 0, tileX: Math.floor(blockX / tileSize), tileZ: Math.floor(blockZ / tileSize) };
    const range = this.heightRangeFor(finestAddress);
    return range !== undefined && cameraBlockPosition.y < range.minHeight - UNDERGROUND_MARGIN_BLOCKS;
  }

  setBeforeDepthClear(handler: ((camera: THREE.PerspectiveCamera) => void) | null): void {
    this.pass.beforeDepthClear = handler;
  }

  adoptBackground(background: THREE.Object3D): void {
    this.pass.adoptBackground(background);
  }

  setFogColor(srgbHex: number): void {
    profiler.addCounter("game.lod.uniforms.fogColorUpdates");
    this.materials.sceneUniforms.hazeColor.value.copy(srgbHexToVector(srgbHex));
  }

  onRealChunkLoaded(chunkX: number, chunkY: number, chunkZ: number, blocks: Uint8Array): void {
    profiler.addCounter("game.lod.real.chunkLoaded");
    this.realData.recordChunkBlocks(chunkX, chunkY, chunkZ, blocks);
  }

  onBlocksEdited(chunkX: number, chunkY: number, chunkZ: number, blocks: Uint8Array): void {
    profiler.addCounter("game.lod.real.chunkEdited");
    this.realData.recordChunkBlocks(chunkX, chunkY, chunkZ, blocks);
  }

  onRealChunkMeshed(chunkX: number, chunkY: number, chunkZ: number): void {
    profiler.addCounter("game.lod.real.chunkMeshed");
    this.realData.coverage.markMeshed(chunkX, chunkY, chunkZ);
  }

  onRealChunkUnmeshed(chunkX: number, chunkY: number, chunkZ: number): void {
    profiler.addCounter("game.lod.real.chunkUnmeshed");
    this.realData.coverage.markUnloaded(chunkX, chunkY, chunkZ);
  }

  onRealChunkUnloaded(chunkX: number, chunkY: number, chunkZ: number): void {
    profiler.addCounter("game.lod.real.chunkUnloaded");
    this.realData.coverage.markUnloaded(chunkX, chunkY, chunkZ);
    this.realData.forgetChunk(chunkX, chunkY, chunkZ);
  }

  private heightRangeFor(address: TileAddress): HeightRange | undefined {
    this.planActivity.heightRangeLookups++;
    for (let level = address.level; level <= this.maximumLevel; level++) {
      this.planActivity.heightRangeLevelsWalked++;
      const tile = this.cache.get(level === address.level ? address : ancestorAddressAt(address, level));
      if (tile !== undefined) return tile.heightRange;
    }
    this.planActivity.heightRangeUnresolved++;
    return undefined;
  }

  private nearestCachedAncestor(address: TileAddress): TileAddress | undefined {
    for (let level = address.level + 1; level <= this.maximumLevel; level++) {
      const ancestor = ancestorAddressAt(address, level);
      if (this.cache.has(ancestor)) return ancestor;
    }
    return undefined;
  }

  private hasStandIn(address: TileAddress): boolean {
    this.planActivity.standInChecks++;
    const hasStandIn =
      this.nearestCachedAncestor(address) !== undefined || (address.level > 0 && childAddressesOf(address).every((child) => this.cache.has(child)));
    if (hasStandIn) this.planActivity.standInFound++;
    return hasStandIn;
  }

  private isInFrustum(address: TileAddress): boolean {
    const bounds = tileBoundsOf(address);
    const range = this.heightRangeFor(address) ?? { minHeight: 0, maxHeight: 256 };
    this.tileBox.min.set(bounds.minX, range.minHeight, bounds.minZ).subScalar(BLOCK_RENDER_OFFSET);
    this.tileBox.max.set(bounds.maxX, range.maxHeight, bounds.maxZ).subScalar(BLOCK_RENDER_OFFSET);
    this.planActivity.frustumTests++;
    const isInFrustum = this.frustum.intersectsBox(this.tileBox);
    if (!isInFrustum) this.planActivity.frustumRejected++;
    return isInFrustum;
  }

  update(camera: THREE.PerspectiveCamera, viewportHeightPixels: number): void {
    if (this.isDisposed) return;
    const updateToken = profiler.begin("main.lod.update");
    try {
      const nowMilliseconds = this.now();
      const elapsedMilliseconds = this.lastUpdateMilliseconds === undefined ? 0 : nowMilliseconds - this.lastUpdateMilliseconds;
      this.lastUpdateMilliseconds = nowMilliseconds;

      const changedRealAddresses = this.realData.applyPendingColumns(this.options.realColumnsPerUpdate ?? DEFAULT_REAL_COLUMNS_PER_UPDATE);
      if (changedRealAddresses.length > 0) this.invalidatePlan(StateChange.RealDataChanged);

      camera.updateMatrixWorld();
      const cameraBlockPosition = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld).addScalar(BLOCK_RENDER_OFFSET);
      const viewDirection = camera.getWorldDirection(new THREE.Vector3());
      const planKeyParts = [
        Math.round(cameraBlockPosition.x),
        Math.round(cameraBlockPosition.y),
        Math.round(cameraBlockPosition.z),
        Math.round(viewDirection.x * PLAN_DIRECTION_STEPS),
        Math.round(viewDirection.y * PLAN_DIRECTION_STEPS),
        Math.round(viewDirection.z * PLAN_DIRECTION_STEPS),
        viewportHeightPixels,
        camera.fov,
        camera.zoom,
        this.stateVersion,
        this.realData.coverage.version,
        Math.floor(nowMilliseconds / PLAN_MAXIMUM_AGE_MILLISECONDS),
      ];
      const planKey = planKeyParts.join(",");
      if (planKey !== this.lastPlanKey || this.lastPlan === undefined) {
        if (profiler.enabled) this.countReplanReasons(planKeyParts);
        this.lastPlanKey = planKey;
        this.lastPlanKeyParts = planKeyParts;
        this.lastPlan = this.plan(camera, cameraBlockPosition, viewportHeightPixels, nowMilliseconds);
        profiler.addCounter("game.lod.plan.rebuilt");
      } else {
        profiler.addCounter("game.lod.plan.reused");
        this.dispatchBuilds();
      }
      const plan = this.lastPlan;

      const wasUnderground = this.cameraUnderground;
      this.cameraUnderground = this.isBelowLodSurface(cameraBlockPosition);
      if (this.cameraUnderground !== wasUnderground) profiler.addCounter("game.lod.underground.transitions");
      this.display.advance(elapsedMilliseconds);
      this.display.reconcile(plan.drawn, (address) => this.cache.get(address)!.payload.tileMesh, (this.options.fadeMilliseconds ?? DEFAULT_FADE_MILLISECONDS) <= 0);
      this.updateCoverageTexture(cameraBlockPosition);

      const sinceCreation = nowMilliseconds - this.createdAtMilliseconds;
      if (this.stats.firstHorizonMilliseconds === undefined && !plan.hasUncoveredArea && plan.drawn.length > 0) {
        this.stats.firstHorizonMilliseconds = sinceCreation;
      }
      if (this.stats.fullDetailMilliseconds === undefined && plan.missingLeafCount === 0 && plan.drawn.length > 0) {
        this.stats.fullDetailMilliseconds = sinceCreation;
      }
      this.refreshStats(plan.selectedLeafCount, plan.drawn.length, plan.missingLeafCount);
      this.reportFrameActivity();
    } finally {
      profiler.end(updateToken);
    }
  }

  /** Counts which parts of the plan key changed since the plan before, so the report shows what forces replans. */
  private countReplanReasons(planKeyParts: readonly number[]): void {
    const previousParts = this.lastPlanKeyParts;
    if (previousParts.length === 0) {
      profiler.addCounter("game.lod.plan.reason.firstPlan");
      return;
    }
    for (const reason of REPLAN_REASON_COUNTERS) {
      for (let part = reason.firstPart; part <= reason.lastPart; part++) {
        if (planKeyParts[part] !== previousParts[part]) {
          profiler.addCounter(reason.counterName);
          break;
        }
      }
    }
  }

  /** Flushes the per-frame operation counts of the cache, real data, display and plan helpers. */
  private reportFrameActivity(): void {
    this.cache.reportToProfiler();
    this.realData.reportToProfiler();
    this.display.reportDrawnToProfiler();
    const activity = this.planActivity;
    if (profiler.enabled) {
      profiler.addCounter("game.lod.heightRange.lookups", activity.heightRangeLookups);
      profiler.addCounter("game.lod.heightRange.levelsWalked", activity.heightRangeLevelsWalked);
      profiler.addCounter("game.lod.heightRange.unresolved", activity.heightRangeUnresolved);
      profiler.addCounter("game.lod.standIn.checks", activity.standInChecks);
      profiler.addCounter("game.lod.standIn.found", activity.standInFound);
      profiler.addCounter("game.lod.frustum.tests", activity.frustumTests);
      profiler.addCounter("game.lod.frustum.rejected", activity.frustumRejected);
    }
    clearPlanActivity(activity);
  }

  /**
   * Selection, render set, build candidates, eviction and clip planes for one camera state. Re-run only when the camera
   * moved a block, turned, or the cache or the real data changed.
   */
  private plan(camera: THREE.PerspectiveCamera, cameraBlockPosition: THREE.Vector3, viewportHeightPixels: number, nowMilliseconds: number): FramePlan {
    const planToken = profiler.begin("main.lod.plan");
    try {
      return this.buildPlan(camera, cameraBlockPosition, viewportHeightPixels, nowMilliseconds);
    } finally {
      profiler.end(planToken);
    }
  }

  private buildPlan(camera: THREE.PerspectiveCamera, cameraBlockPosition: THREE.Vector3, viewportHeightPixels: number, nowMilliseconds: number): FramePlan {
    this.projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projectionView);

    const selectionToken = profiler.begin("main.lod.select");
    const parameters: SelectionParameters = {
      cameraX: cameraBlockPosition.x,
      cameraY: cameraBlockPosition.y,
      cameraZ: cameraBlockPosition.z,
      projectionScale: projectionScaleOf(camera.fov, viewportHeightPixels) * camera.zoom,
      maximumCellPixels: this.options.maximumCellPixels ?? DEFAULT_MAXIMUM_CELL_PIXELS,
      thresholdGrowthPerLevel: this.options.thresholdGrowthPerLevel ?? DEFAULT_THRESHOLD_GROWTH_PER_LEVEL,
      radiusBlocks: this.radiusBlocks,
      minimumLevel: this.options.minimumLevel ?? 0,
      maximumLevel: this.maximumLevel,
      heightRangeOf: (address) => this.heightRangeFor(address),
      previouslySplit: this.previouslySplit,
    };
    let selection: ReturnType<typeof selectTiles>;
    let visibleLeaves: TileAddress[];
    let renderSet: ReturnType<typeof computeRenderSet>;
    try {
      selection = selectTiles(parameters);
      this.previouslySplit = selection.split;
      const coverage = this.realData.coverage;
      const cullToken = profiler.begin("main.lod.select.coverageCull");
      try {
        visibleLeaves = selection.leaves.filter((leaf) => !coverage.isTileFullyCovered(leaf));
      } finally {
        profiler.end(cullToken);
      }
      profiler.addCounter("game.lod.select.leavesHiddenByRealChunks", selection.leaves.length - visibleLeaves.length);
      const renderSetToken = profiler.begin("main.lod.select.renderSet");
      try {
        renderSet = computeRenderSet({ leaves: visibleLeaves, split: selection.split }, parameters, (address) => this.cache.has(address));
      } finally {
        profiler.end(renderSetToken);
      }
    } finally {
      profiler.end(selectionToken);
    }
    profiler.sampleGauge("game.lod.select.selectedLeaves", selection.leaves.length);

    const candidatesToken = profiler.begin("main.lod.plan.candidates");
    const candidates: BuildCandidate[] = [];
    let hasUncoveredArea = false;
    let refineCandidates = 0;
    let uncoveredCandidates = 0;
    let refreshCandidates = 0;
    let refreshSkippedAsRecent = 0;
    try {
      for (const leaf of renderSet.missingLeaves) {
        const root = ancestorAddressAt(leaf, this.maximumLevel);
        if (this.hasStandIn(leaf) || this.queue.isInFlight(root)) {
          candidates.push({ address: leaf, urgency: BuildUrgency.Refine, inFrustum: this.isInFrustum(leaf), distance: distanceToTile(leaf, parameters) });
          refineCandidates++;
        } else {
          hasUncoveredArea = true;
          candidates.push({ address: root, urgency: BuildUrgency.Uncovered, inFrustum: this.isInFrustum(root), distance: distanceToTile(root, parameters) });
          uncoveredCandidates++;
        }
      }
      const refreshInterval = this.options.refreshIntervalMilliseconds ?? DEFAULT_REFRESH_INTERVAL_MILLISECONDS;
      for (const address of renderSet.drawn) {
        const tile = this.cache.get(address)!;
        this.cache.touch(address);
        if (tile.realDataVersion === this.realData.realDataVersionOf(address)) continue;
        if (nowMilliseconds - tile.payload.builtAtMilliseconds < refreshInterval) {
          refreshSkippedAsRecent++;
          continue;
        }
        candidates.push({ address, urgency: BuildUrgency.Refresh, inFrustum: this.isInFrustum(address), distance: distanceToTile(address, parameters) });
        refreshCandidates++;
      }
    } finally {
      profiler.end(candidatesToken);
    }
    if (profiler.enabled) {
      profiler.addCounter("game.lod.plan.candidates.refine", refineCandidates);
      profiler.addCounter("game.lod.plan.candidates.uncovered", uncoveredCandidates);
      profiler.addCounter("game.lod.plan.candidates.refresh", refreshCandidates);
      profiler.addCounter("game.lod.plan.refreshSkippedAsRecent", refreshSkippedAsRecent);
      profiler.addCounter("game.lod.plan.drawnTilesTouched", renderSet.drawn.length);
    }
    const queueToken = profiler.begin("main.lod.plan.queueReplace");
    try {
      this.queue.replaceCandidates(candidates);
    } finally {
      profiler.end(queueToken);
    }
    this.dispatchBuilds();

    const evictToken = profiler.begin("main.lod.plan.pinAndEvict");
    try {
      const pinned = new Set<number>(this.display.keys);
      for (const address of renderSet.drawn) pinned.add(tileKeyOf(address.level, address.tileX, address.tileZ));
      profiler.sampleGauge("game.lod.cache.pinned", pinned.size);
      if (this.cache.enforceBudget(pinned) > 0) this.invalidatePlan(StateChange.BudgetEvicted);
    } finally {
      profiler.end(evictToken);
    }
    const clipToken = profiler.begin("main.lod.plan.clipPlanes");
    try {
      this.updateClipPlanes(cameraBlockPosition, renderSet.drawn);
    } finally {
      profiler.end(clipToken);
    }
    return {
      drawn: renderSet.drawn,
      missingLeafCount: renderSet.missingLeaves.length,
      selectedLeafCount: selection.leaves.length,
      hasUncoveredArea,
    };
  }

  private dispatchBuilds(): void {
    const token = profiler.begin("main.lod.dispatchBuilds");
    try {
      while (this.queue.inFlightCount < this.maximumBuildsInFlight) {
        const candidate = this.queue.takeNext();
        if (candidate === undefined) break;
        this.dispatchBuild(candidate);
      }
      if (this.queue.inFlightCount >= this.maximumBuildsInFlight && this.queue.waitingCount > 0) {
        profiler.addCounter("game.lod.queue.dispatchSaturated");
      }
    } finally {
      profiler.end(token);
    }
  }

  private dispatchBuild(candidate: BuildCandidate): void {
    const address = candidate.address;
    const levelKey = lodLevelKey(address.level);
    const overlay = this.realData.overlayFor(address);
    const request: LodTileBuildRequest = { seed: this.options.seed, address };
    const transfer: Transferable[] = [];
    if (overlay !== undefined) {
      request.overlay = { surface: overlay.surface, coveredCells: overlay.coveredCells };
      transfer.push(
        overlay.surface.heights.buffer,
        overlay.surface.topBlocks.buffer,
        overlay.surface.sideBlocks.buffer,
        overlay.surface.waterLevels.buffer,
        overlay.coveredCells.buffer,
      );
    }
    const sourcesToken = profiler.begin("main.lod.dispatch.sources", DIMENSIONS.lodLevel, levelKey);
    try {
      if (address.level > 0) {
        const children = childAddressesOf(address).map((child) => this.cache.get(child)?.packedSurface ?? null);
        if (children.every((child) => child !== null)) request.children = children;
      }
      if (request.children === undefined) {
        const hintAddress = this.nearestCachedAncestor(address);
        if (hintAddress !== undefined) request.hint = { address: hintAddress, packedSurface: this.cache.get(hintAddress)!.packedSurface };
      }
    } finally {
      profiler.end(sourcesToken);
    }
    if (profiler.enabled) this.countBuildRequest(request);
    const realDataVersion = overlay?.version ?? this.realData.realDataVersionOf(address);
    const executeToken = profiler.begin("main.lod.dispatch.execute", DIMENSIONS.lodLevel, levelKey);
    try {
      this.executor
        .build(request, transfer)
        .then((result) => this.onTileBuilt(result, realDataVersion))
        .catch((error) => {
          this.queue.markFinished(address);
          this.invalidatePlan(StateChange.BuildFailed);
          this.stats.failedBuilds++;
          profiler.addCounter("game.lod.build.failed");
          profiler.addCounter(metricNameOfLevel(BUILD_FAILED_PER_LEVEL, address.level));
          if (!this.isDisposed) console.error("LOD tile build failed", address, error);
        });
    } finally {
      profiler.end(executeToken);
    }
  }

  /** What each build request carries: real data overlay, the four finer tiles to downsample, a coarser hint, or nothing. */
  private countBuildRequest(request: LodTileBuildRequest): void {
    profiler.addCounter("game.lod.build.requests");
    if (request.overlay !== undefined) {
      profiler.addCounter("game.lod.build.withOverlay");
      const { surface, coveredCells } = request.overlay;
      profiler.recordBytes(
        "bytes.lod.build.overlayRequest",
        surface.heights.byteLength + surface.topBlocks.byteLength + surface.sideBlocks.byteLength + surface.waterLevels.byteLength + coveredCells.byteLength,
      );
    }
    if (request.children !== undefined) {
      profiler.addCounter("game.lod.build.withChildren");
      let childrenBytes = 0;
      for (const child of request.children) childrenBytes += child!.byteLength;
      profiler.recordBytes("bytes.lod.build.childrenRequest", childrenBytes);
    } else if (request.hint !== undefined) {
      profiler.addCounter("game.lod.build.withHint");
      profiler.recordBytes("bytes.lod.build.hintRequest", request.hint.packedSurface.byteLength);
    } else {
      profiler.addCounter("game.lod.build.cold");
    }
  }

  private onTileBuilt(result: LodTileBuildResult, realDataVersion: number): void {
    this.queue.markFinished(result.address);
    if (this.isDisposed) {
      profiler.addCounter("game.lod.build.completedAfterDispose");
      return;
    }
    this.invalidatePlan(StateChange.TileBuilt);
    const levelKey = lodLevelKey(result.address.level);
    const token = profiler.begin("main.lod.createTileMesh", DIMENSIONS.lodLevel, levelKey);
    try {
      const geometryToken = profiler.begin("main.lod.createTileMesh.geometry");
      const tileMesh = createLodTileMesh(result.address, result, this.materials);
      profiler.end(geometryToken);
      const displayToken = profiler.begin("main.lod.createTileMesh.display");
      this.display.replaceMesh(result.address, tileMesh);
      profiler.end(displayToken);
      const cacheToken = profiler.begin("main.lod.createTileMesh.cache");
      this.cache.set({
        address: result.address,
        packedSurface: result.packedSurface,
        heightRange: packedHeightRange(result.packedSurface),
        geometryBytes: tileMesh.geometryBytes,
        payload: { tileMesh, builtAtMilliseconds: this.now() },
        realDataVersion,
      });
      profiler.end(cacheToken);
      const levelStatistics = (this.stats.buildsByLevel[result.address.level] ??= createEmptyLevelStatistics());
      levelStatistics.tiles++;
      levelStatistics.totalSampleMilliseconds += result.sampleMilliseconds;
      levelStatistics.totalMeshMilliseconds += result.meshMilliseconds;
      levelStatistics.totalVertices += result.vertices.length / 2;
      levelStatistics.totalGeometryBytes += tileMesh.geometryBytes;
      levelStatistics.totalPackedSurfaceBytes += result.packedSurface.byteLength;
      this.stats.builtTiles++;
      profiler.addCounter("game.lod.tilesBuilt");
      profiler.recordBytes("bytes.lod.tileGeometry", tileMesh.geometryBytes);
      if (profiler.enabled) this.countBuiltTile(result, tileMesh);
    } finally {
      profiler.end(token);
    }
  }

  private countBuiltTile(result: LodTileBuildResult, tileMesh: LodTileMesh): void {
    const level = result.address.level;
    const vertexCount = result.vertices.length / 2;
    const triangleCount = (result.terrainQuadCount + result.waterQuadCount) * 2;
    profiler.addCounter(metricNameOfLevel(TILES_BUILT_PER_LEVEL, level));
    profiler.addCounter(result.source === "children" ? "game.lod.build.source.children" : "game.lod.build.source.worldgen");
    profiler.addCounter("game.lod.build.vertices", vertexCount);
    profiler.addCounter(metricNameOfLevel(BUILT_VERTICES_PER_LEVEL, level), vertexCount);
    profiler.addCounter("game.lod.build.triangles", triangleCount);
    profiler.addCounter(metricNameOfLevel(BUILT_TRIANGLES_PER_LEVEL, level), triangleCount);
    profiler.addCounter("game.lod.build.terrainQuads", result.terrainQuadCount);
    profiler.addCounter("game.lod.build.waterQuads", result.waterQuadCount);
    profiler.recordBytes(metricNameOfLevel(GEOMETRY_BYTES_PER_LEVEL, level), tileMesh.geometryBytes);
    profiler.recordBytes("bytes.lod.packedSurface", result.packedSurface.byteLength);
    profiler.recordBytes(metricNameOfLevel(PACKED_BYTES_PER_LEVEL, level), result.packedSurface.byteLength);
  }

  private updateCoverageTexture(cameraBlockPosition: THREE.Vector3): void {
    const coverage = this.realData.coverage;
    const centerChunkX = Math.floor(cameraBlockPosition.x / CHUNK_SIZE_BLOCKS);
    const centerChunkZ = Math.floor(cameraBlockPosition.z / CHUNK_SIZE_BLOCKS);
    if (
      coverage.version === this.lastCoverageVersion &&
      centerChunkX === this.lastCoverageCenter.chunkX &&
      centerChunkZ === this.lastCoverageCenter.chunkZ
    ) {
      profiler.addCounter("game.lod.coverage.textureUpdatesSkipped");
      return;
    }
    this.lastCoverageVersion = coverage.version;
    this.lastCoverageCenter = { chunkX: centerChunkX, chunkZ: centerChunkZ };
    const token = profiler.begin("main.lod.coverageTexture");
    try {
      const uniforms = this.materials.sceneUniforms;
      const texelsWritten = writeCoverageTexels(coverage, centerChunkX, centerChunkZ, uniforms.coverageSize.value, this.materials.coverageTexels);
      uniforms.coverageTexture.value.needsUpdate = true;
      uniforms.coverageCenterChunk.value.set(centerChunkX, centerChunkZ);
      profiler.addCounter("game.lod.coverage.textureUpdates");
      profiler.addCounter("game.lod.coverage.texelsWritten", texelsWritten);
      profiler.addCounter("game.lod.coverage.columnsVisitedForTexture", coverage.coveredColumnCount);
      profiler.recordBytes("bytes.lod.coverageTexture", this.materials.coverageTexels.byteLength);
    } finally {
      profiler.end(token);
    }
  }

  /**
   * Near plane just inside the closest LOD geometry that can actually show (covered columns are discarded anyway),
   * far plane past the dissolve band.
   */
  private updateClipPlanes(cameraBlockPosition: THREE.Vector3, drawn: readonly TileAddress[]): void {
    const coverage = this.realData.coverage;
    let nearestDistance = Infinity;
    let tilesScanned = 0;
    let tilesSearchedByColumn = 0;
    let columnsChecked = 0;
    for (const address of drawn) {
      const bounds = tileBoundsOf(address);
      const distance = horizontalDistanceToBounds(bounds, cameraBlockPosition.x, cameraBlockPosition.z);
      tilesScanned++;
      if (distance >= nearestDistance) continue;
      const chunksPerSide = (bounds.maxX - bounds.minX) / CHUNK_SIZE_BLOCKS;
      if (distance > NEAR_TILE_SEARCH_DISTANCE || chunksPerSide > 8 || !coverage.isTilePartiallyCovered(address)) {
        nearestDistance = distance;
        continue;
      }
      tilesSearchedByColumn++;
      for (let offsetZ = 0; offsetZ < chunksPerSide; offsetZ++) {
        for (let offsetX = 0; offsetX < chunksPerSide; offsetX++) {
          const chunkX = bounds.minX / CHUNK_SIZE_BLOCKS + offsetX;
          const chunkZ = bounds.minZ / CHUNK_SIZE_BLOCKS + offsetZ;
          columnsChecked++;
          if (coverage.isColumnCovered(chunkX, chunkZ)) continue;
          const columnBounds = { minX: chunkX * CHUNK_SIZE_BLOCKS, minZ: chunkZ * CHUNK_SIZE_BLOCKS, maxX: (chunkX + 1) * CHUNK_SIZE_BLOCKS, maxZ: (chunkZ + 1) * CHUNK_SIZE_BLOCKS };
          nearestDistance = Math.min(nearestDistance, horizontalDistanceToBounds(columnBounds, cameraBlockPosition.x, cameraBlockPosition.z));
        }
      }
    }
    this.nearPlane = Math.max(MINIMUM_NEAR_PLANE, Math.min(MAXIMUM_NEAR_PLANE, nearestDistance * NEAR_PLANE_DEPTH_FACTOR));
    this.farPlane = this.radiusBlocks * 1.25 + Math.abs(cameraBlockPosition.y);
    if (profiler.enabled) {
      profiler.addCounter("game.lod.clipPlanes.tilesScanned", tilesScanned);
      profiler.addCounter("game.lod.clipPlanes.tilesSearchedByColumn", tilesSearchedByColumn);
      profiler.addCounter("game.lod.clipPlanes.columnsChecked", columnsChecked);
    }
  }

  private refreshStats(selectedTiles: number, drawnTiles: number, missingTiles: number): void {
    const stats = this.stats;
    stats.selectedTiles = selectedTiles;
    stats.drawnTiles = drawnTiles;
    stats.missingTiles = missingTiles;
    stats.queuedBuilds = this.queue.waitingCount;
    stats.buildsInFlight = this.queue.inFlightCount;
    stats.cachedTiles = this.cache.size;
    stats.cacheBytes = this.cache.totalBytes;
    stats.evictedTiles = this.cache.evictionCount;
    stats.realDataNodes = this.realData.pyramid.nodeCount;
    stats.realDataBytes = this.realData.pyramid.byteSize;
    stats.coveredColumns = this.realData.coverage.coveredColumnCount;
    stats.pendingRealColumns = this.realData.pendingColumnCount;
    stats.nearPlane = this.nearPlane;
    stats.farPlane = this.farPlane;
    profiler.sampleGauge("game.lod.drawnTiles", drawnTiles);
    profiler.sampleGauge("game.lod.missingTiles", missingTiles);
    profiler.sampleGauge("queue.lod.waitingBuilds", stats.queuedBuilds);
    profiler.sampleGauge("memory.lod.tileCache", stats.cacheBytes, "bytes");
    profiler.sampleGauge("memory.lod.realData", stats.realDataBytes, "bytes");
    profiler.sampleGauge("queue.lod.inFlight", stats.buildsInFlight);
    profiler.sampleGauge("game.lod.selectedTiles", selectedTiles);
    profiler.sampleGauge("game.lod.cachedTiles", stats.cachedTiles);
    profiler.sampleGauge("game.lod.coveredColumns", stats.coveredColumns);
    profiler.sampleGauge("game.lod.nearPlane", stats.nearPlane, "blocks");
    profiler.sampleGauge("game.lod.farPlane", stats.farPlane, "blocks");
    profiler.sampleGauge("game.lod.underground", this.cameraUnderground ? 1 : 0);
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
    if (this.isDisposed) return;
    const token = profiler.begin("main.lod.render");
    try {
      this.pass.tiles.visible = !this.cameraUnderground;
      if (this.cameraUnderground) profiler.addCounter("game.lod.render.skippedUnderground");
      this.pass.render(renderer, camera, this.nearPlane, this.farPlane);
      profiler.addCounter("game.lod.render.tileFadeUniformUpdates", takeTileFadeUniformUpdateCount());
      profiler.sampleGauge("game.lod.render.liveTileMeshes", liveLodTileMeshCount());
    } finally {
      profiler.end(token);
    }
  }

  getStats(): LodStats {
    return { ...this.stats, buildsByLevel: structuredClone(this.stats.buildsByLevel) };
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    const token = profiler.begin("main.lod.dispose");
    try {
      this.executor.terminate();
      this.display.clear();
      this.cache.clear();
      this.pass.releaseBackground();
      this.pass.dispose();
      this.materials.dispose();
      profiler.addCounter("game.lod.managersDisposed");
    } finally {
      profiler.end(token);
    }
  }
}
