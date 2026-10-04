// The LOD engine behind a small integration surface. Each frame `update` selects the quadtree tiles for the camera,
// works out what can be drawn now (stand-ins while tiles build), queues builds by urgency, cross-fades the scene to
// the new set and keeps the cache under budget; `render` draws the LOD pass. Real chunks feed in through the chunk
// callbacks: their surfaces refine the near tiles and their coverage hides the LOD where the real renderer draws.

import * as THREE from "three";
import { profiler } from "../../profiler";
import { BuildQueue, BuildUrgency, type BuildCandidate } from "../cache/build-queue";
import { LodTileCache } from "../cache/tile-cache";
import { BLOCK_RENDER_OFFSET, CHUNK_SIZE_BLOCKS, MAX_LOD_LEVEL, tileSizeOfLevel } from "../core/lod-constants";
import { ancestorAddressAt, childAddressesOf, tileBoundsOf, tileKeyOf, type TileAddress } from "../core/tile-address";
import { writeCoverageTexels } from "../coverage/real-chunk-coverage";
import { packedHeightRange } from "../data/packed-tile-surface";
import type { HeightRange } from "../data/tile-surface";
import { createLodMaterials, srgbHexToVector, type LodMaterials } from "../rendering/lod-materials";
import { LodRenderPass } from "../rendering/lod-render-pass";
import { createLodTileMesh, type LodTileMesh } from "../rendering/lod-tile-mesh";
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

export function createLodManager(options: LodManagerOptions): LodManager {
  return new LodManagerImplementation(options);
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
  private lastPlan: FramePlan | undefined;

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
      this.stateVersion++;
      this.display.remove(tile.address, tile.payload.tileMesh);
      tile.payload.tileMesh.dispose();
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

  private applyRadiusUniforms(): void {
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
    this.stateVersion++;
  }

  captureBackgroundHaze(renderer: THREE.WebGLRenderer): void {
    const hazeCube = this.pass.captureBackground(renderer);
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

  adoptBackground(background: THREE.Object3D): void {
    this.pass.adoptBackground(background);
  }

  setFogColor(srgbHex: number): void {
    this.materials.sceneUniforms.hazeColor.value.copy(srgbHexToVector(srgbHex));
  }

  onRealChunkLoaded(chunkX: number, chunkY: number, chunkZ: number, blocks: Uint8Array): void {
    this.realData.recordChunkBlocks(chunkX, chunkY, chunkZ, blocks);
  }

  onBlocksEdited(chunkX: number, chunkY: number, chunkZ: number, blocks: Uint8Array): void {
    this.realData.recordChunkBlocks(chunkX, chunkY, chunkZ, blocks);
  }

  onRealChunkMeshed(chunkX: number, chunkY: number, chunkZ: number): void {
    this.realData.coverage.markMeshed(chunkX, chunkY, chunkZ);
  }

  onRealChunkUnloaded(chunkX: number, chunkY: number, chunkZ: number): void {
    this.realData.coverage.markUnloaded(chunkX, chunkY, chunkZ);
    this.realData.forgetChunk(chunkX, chunkY, chunkZ);
  }

  private heightRangeFor(address: TileAddress): HeightRange | undefined {
    for (let level = address.level; level <= this.maximumLevel; level++) {
      const tile = this.cache.get(level === address.level ? address : ancestorAddressAt(address, level));
      if (tile !== undefined) return tile.heightRange;
    }
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
    if (this.nearestCachedAncestor(address) !== undefined) return true;
    return address.level > 0 && childAddressesOf(address).every((child) => this.cache.has(child));
  }

  private isInFrustum(address: TileAddress): boolean {
    const bounds = tileBoundsOf(address);
    const range = this.heightRangeFor(address) ?? { minHeight: 0, maxHeight: 256 };
    this.tileBox.min.set(bounds.minX, range.minHeight, bounds.minZ).subScalar(BLOCK_RENDER_OFFSET);
    this.tileBox.max.set(bounds.maxX, range.maxHeight, bounds.maxZ).subScalar(BLOCK_RENDER_OFFSET);
    return this.frustum.intersectsBox(this.tileBox);
  }

  update(camera: THREE.PerspectiveCamera, viewportHeightPixels: number): void {
    if (this.isDisposed) return;
    const updateToken = profiler.begin("main.lod.update");
    try {
      const nowMilliseconds = this.now();
      const elapsedMilliseconds = this.lastUpdateMilliseconds === undefined ? 0 : nowMilliseconds - this.lastUpdateMilliseconds;
      this.lastUpdateMilliseconds = nowMilliseconds;

      const changedRealAddresses = this.realData.applyPendingColumns(this.options.realColumnsPerUpdate ?? DEFAULT_REAL_COLUMNS_PER_UPDATE);
      if (changedRealAddresses.length > 0) this.stateVersion++;

      camera.updateMatrixWorld();
      const cameraBlockPosition = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld).addScalar(BLOCK_RENDER_OFFSET);
      const viewDirection = camera.getWorldDirection(new THREE.Vector3());
      const planKey = [
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
      ].join(",");
      if (planKey !== this.lastPlanKey || this.lastPlan === undefined) {
        this.lastPlanKey = planKey;
        this.lastPlan = this.plan(camera, cameraBlockPosition, viewportHeightPixels, nowMilliseconds);
      } else {
        this.dispatchBuilds();
      }
      const plan = this.lastPlan;

      this.cameraUnderground = this.isBelowLodSurface(cameraBlockPosition);
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
    } finally {
      profiler.end(updateToken);
    }
  }

  /**
   * Selection, render set, build candidates, eviction and clip planes for one camera state. Re-run only when the camera
   * moved a block, turned, or the cache or the real data changed.
   */
  private plan(camera: THREE.PerspectiveCamera, cameraBlockPosition: THREE.Vector3, viewportHeightPixels: number, nowMilliseconds: number): FramePlan {
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
    const selection = selectTiles(parameters);
    this.previouslySplit = selection.split;
    const coverage = this.realData.coverage;
    const visibleLeaves = selection.leaves.filter((leaf) => !coverage.isTileFullyCovered(leaf));
    const renderSet = computeRenderSet({ leaves: visibleLeaves, split: selection.split }, parameters, (address) => this.cache.has(address));
    profiler.end(selectionToken);

    const candidates: BuildCandidate[] = [];
    let hasUncoveredArea = false;
    for (const leaf of renderSet.missingLeaves) {
      const root = ancestorAddressAt(leaf, this.maximumLevel);
      if (this.hasStandIn(leaf) || this.queue.isInFlight(root)) {
        candidates.push({ address: leaf, urgency: BuildUrgency.Refine, inFrustum: this.isInFrustum(leaf), distance: distanceToTile(leaf, parameters) });
      } else {
        hasUncoveredArea = true;
        candidates.push({ address: root, urgency: BuildUrgency.Uncovered, inFrustum: this.isInFrustum(root), distance: distanceToTile(root, parameters) });
      }
    }
    const refreshInterval = this.options.refreshIntervalMilliseconds ?? DEFAULT_REFRESH_INTERVAL_MILLISECONDS;
    for (const address of renderSet.drawn) {
      const tile = this.cache.get(address)!;
      this.cache.touch(address);
      if (tile.realDataVersion === this.realData.realDataVersionOf(address)) continue;
      if (nowMilliseconds - tile.payload.builtAtMilliseconds < refreshInterval) continue;
      candidates.push({ address, urgency: BuildUrgency.Refresh, inFrustum: this.isInFrustum(address), distance: distanceToTile(address, parameters) });
    }
    this.queue.replaceCandidates(candidates);
    this.dispatchBuilds();

    const pinned = new Set<number>(this.display.keys);
    for (const address of renderSet.drawn) pinned.add(tileKeyOf(address.level, address.tileX, address.tileZ));
    if (this.cache.enforceBudget(pinned) > 0) this.stateVersion++;
    this.updateClipPlanes(cameraBlockPosition, renderSet.drawn);
    return {
      drawn: renderSet.drawn,
      missingLeafCount: renderSet.missingLeaves.length,
      selectedLeafCount: selection.leaves.length,
      hasUncoveredArea,
    };
  }

  private dispatchBuilds(): void {
    while (this.queue.inFlightCount < this.maximumBuildsInFlight) {
      const candidate = this.queue.takeNext();
      if (candidate === undefined) break;
      const address = candidate.address;
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
      if (address.level > 0) {
        const children = childAddressesOf(address).map((child) => this.cache.get(child)?.packedSurface ?? null);
        if (children.every((child) => child !== null)) request.children = children;
      }
      if (request.children === undefined) {
        const hintAddress = this.nearestCachedAncestor(address);
        if (hintAddress !== undefined) request.hint = { address: hintAddress, packedSurface: this.cache.get(hintAddress)!.packedSurface };
      }
      const realDataVersion = overlay?.version ?? this.realData.realDataVersionOf(address);
      this.executor
        .build(request, transfer)
        .then((result) => this.onTileBuilt(result, realDataVersion))
        .catch((error) => {
          this.queue.markFinished(address);
          this.stateVersion++;
          this.stats.failedBuilds++;
          if (!this.isDisposed) console.error("LOD tile build failed", address, error);
        });
    }
  }

  private onTileBuilt(result: LodTileBuildResult, realDataVersion: number): void {
    this.queue.markFinished(result.address);
    if (this.isDisposed) return;
    this.stateVersion++;
    const token = profiler.begin("main.lod.createTileMesh");
    try {
      const tileMesh = createLodTileMesh(result.address, result, this.materials);
      this.display.replaceMesh(result.address, tileMesh);
      this.cache.set({
        address: result.address,
        packedSurface: result.packedSurface,
        heightRange: packedHeightRange(result.packedSurface),
        geometryBytes: tileMesh.geometryBytes,
        payload: { tileMesh, builtAtMilliseconds: this.now() },
        realDataVersion,
      });
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
    } finally {
      profiler.end(token);
    }
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
      return;
    }
    this.lastCoverageVersion = coverage.version;
    this.lastCoverageCenter = { chunkX: centerChunkX, chunkZ: centerChunkZ };
    const uniforms = this.materials.sceneUniforms;
    writeCoverageTexels(coverage, centerChunkX, centerChunkZ, uniforms.coverageSize.value, this.materials.coverageTexels);
    uniforms.coverageTexture.value.needsUpdate = true;
    uniforms.coverageCenterChunk.value.set(centerChunkX, centerChunkZ);
  }

  /**
   * Near plane just inside the closest LOD geometry that can actually show (covered columns are discarded anyway),
   * far plane past the dissolve band.
   */
  private updateClipPlanes(cameraBlockPosition: THREE.Vector3, drawn: readonly TileAddress[]): void {
    const coverage = this.realData.coverage;
    let nearestDistance = Infinity;
    for (const address of drawn) {
      const bounds = tileBoundsOf(address);
      const distance = horizontalDistanceToBounds(bounds, cameraBlockPosition.x, cameraBlockPosition.z);
      if (distance >= nearestDistance) continue;
      const chunksPerSide = (bounds.maxX - bounds.minX) / CHUNK_SIZE_BLOCKS;
      if (distance > NEAR_TILE_SEARCH_DISTANCE || chunksPerSide > 8 || !coverage.isTilePartiallyCovered(address)) {
        nearestDistance = distance;
        continue;
      }
      for (let offsetZ = 0; offsetZ < chunksPerSide; offsetZ++) {
        for (let offsetX = 0; offsetX < chunksPerSide; offsetX++) {
          const chunkX = bounds.minX / CHUNK_SIZE_BLOCKS + offsetX;
          const chunkZ = bounds.minZ / CHUNK_SIZE_BLOCKS + offsetZ;
          if (coverage.isColumnCovered(chunkX, chunkZ)) continue;
          const columnBounds = { minX: chunkX * CHUNK_SIZE_BLOCKS, minZ: chunkZ * CHUNK_SIZE_BLOCKS, maxX: (chunkX + 1) * CHUNK_SIZE_BLOCKS, maxZ: (chunkZ + 1) * CHUNK_SIZE_BLOCKS };
          nearestDistance = Math.min(nearestDistance, horizontalDistanceToBounds(columnBounds, cameraBlockPosition.x, cameraBlockPosition.z));
        }
      }
    }
    this.nearPlane = Math.max(MINIMUM_NEAR_PLANE, Math.min(MAXIMUM_NEAR_PLANE, nearestDistance * NEAR_PLANE_DEPTH_FACTOR));
    this.farPlane = this.radiusBlocks * 1.25 + Math.abs(cameraBlockPosition.y);
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
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
    if (this.isDisposed) return;
    const token = profiler.begin("main.lod.render");
    try {
      this.pass.tiles.visible = !this.cameraUnderground;
      this.pass.render(renderer, camera, this.nearPlane, this.farPlane);
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
    this.executor.terminate();
    this.display.clear();
    this.cache.clear();
    this.pass.releaseBackground();
    this.pass.dispose();
    this.materials.dispose();
  }
}
