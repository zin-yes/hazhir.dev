// One LOD tile from request to transferable result: the surface comes from the four children when they are all
// known (a pure downsample), otherwise from the worldgen sampler seeded by a coarser ancestor; real chunk data in the
// overlay replaces its cells either way. The surface is then meshed and packed. Pure and deterministic, so the worker,
// the benchmark and the tests all run exactly this.

import { DIMENSIONS } from "../../profiler/dimensions";
import { addWorkerCounter, addWorkerKeyedUnits, endWorkerSection, isWorkerProfiling, startWorkerSection } from "../../profiler/worker-recorder";
import { TILE_CELL_COUNT } from "../core/lod-constants";
import { lodLevelKey } from "../core/lod-level-keys";
import type { TileAddress } from "../core/tile-address";
import { packTileSurface, unpackTileSurface, type PackedTileSurface } from "../data/packed-tile-surface";
import { createTileSurface, downsampleChildIntoParent, type TileSurface } from "../data/tile-surface";
import { meshTileSurface } from "../meshing/heightfield-mesher";
import { getSeedWorldgenContext } from "../sampling/seed-worldgen-context";
import { WorldgenTileSampler, type TileSamplingStatistics } from "../sampling/worldgen-tile-sampler";

export interface SerializedTileSurface {
  heights: Int16Array;
  topBlocks: Uint8Array;
  sideBlocks: Uint8Array;
  waterLevels: Int16Array;
}

export interface LodTileBuildRequest {
  seed: number;
  address: TileAddress;
  /** A coarser tile covering this one, used to seed height searches. */
  hint?: { address: TileAddress; packedSurface: PackedTileSurface };
  /** Packed surfaces of the four children (order of childAddressesOf); used when none is missing. */
  children?: (PackedTileSurface | null)[];
  /** Real chunk data for this tile from the real surface pyramid. */
  overlay?: { surface: SerializedTileSurface; coveredCells: Uint8Array };
}

export type LodTileSource = "worldgen" | "children";

export interface LodTileBuildResult {
  address: TileAddress;
  source: LodTileSource;
  packedSurface: PackedTileSurface;
  vertices: Uint32Array;
  terrainQuadCount: number;
  waterQuadCount: number;
  minY: number;
  maxY: number;
  sampleMilliseconds: number;
  meshMilliseconds: number;
  sampling: TileSamplingStatistics | null;
}

const samplersBySeed = new Map<number, WorldgenTileSampler>();

function samplerForSeed(seed: number): WorldgenTileSampler {
  let sampler = samplersBySeed.get(seed);
  if (sampler === undefined) {
    if (samplersBySeed.size >= 2) samplersBySeed.delete(samplersBySeed.keys().next().value as number);
    const context = getSeedWorldgenContext(seed);
    sampler = inSection("lod.createSampler", () => new WorldgenTileSampler(context));
    samplersBySeed.set(seed, sampler);
    addWorkerCounter("lodSamplersCreated", 1);
  } else {
    addWorkerCounter("lodSamplerReuses", 1);
  }
  return sampler;
}

function surfaceFromChildren(children: PackedTileSurface[]): TileSurface {
  const parent = createTileSurface();
  children.forEach((packedChild, childIndex) => {
    const childSurface = inSection("lod.unpackChild", () => unpackTileSurface(packedChild));
    inSection("lod.downsampleChild", () => downsampleChildIntoParent(childSurface, parent, childIndex & 1, childIndex >> 1));
  });
  return parent;
}

function applyOverlay(surface: TileSurface, overlay: NonNullable<LodTileBuildRequest["overlay"]>): void {
  let appliedCells = 0;
  for (let index = 0; index < TILE_CELL_COUNT; index++) {
    if (overlay.coveredCells[index] !== 1) continue;
    appliedCells++;
    surface.heights[index] = overlay.surface.heights[index]!;
    surface.topBlocks[index] = overlay.surface.topBlocks[index]!;
    surface.sideBlocks[index] = overlay.surface.sideBlocks[index]!;
    surface.waterLevels[index] = overlay.surface.waterLevels[index]!;
  }
  addWorkerCounter("lodOverlayCellsApplied", appliedCells);
}

function inSection<Result>(name: string, work: () => Result, dimension?: string, key?: string): Result {
  if (!isWorkerProfiling()) return work();
  startWorkerSection(name, dimension, key);
  try {
    return work();
  } finally {
    endWorkerSection();
  }
}

/** What the request carried into the worker, so the report can relate build time to hint, child and overlay data. */
function countRequestPayload(request: LodTileBuildRequest, hasAllChildren: boolean): void {
  if (request.hint !== undefined) {
    addWorkerCounter("lodRequestsWithHint", 1);
    addWorkerCounter("lodRequestHintBytes", request.hint.packedSurface.byteLength);
  }
  if (hasAllChildren) {
    addWorkerCounter("lodRequestsWithChildren", 1);
    for (const child of request.children!) addWorkerCounter("lodRequestChildrenBytes", child!.byteLength);
  }
  if (request.overlay !== undefined) {
    addWorkerCounter("lodRequestsWithOverlay", 1);
    const { surface, coveredCells } = request.overlay;
    addWorkerCounter(
      "lodRequestOverlayBytes",
      surface.heights.byteLength + surface.topBlocks.byteLength + surface.sideBlocks.byteLength + surface.waterLevels.byteLength + coveredCells.byteLength,
    );
  }
  if (!hasAllChildren && request.hint === undefined) addWorkerCounter("lodColdRequests", 1);
}

export function buildLodTile(request: LodTileBuildRequest): LodTileBuildResult {
  const sampleStartedAt = performance.now();
  const children = request.children;
  const hasAllChildren = children !== undefined && children.length === 4 && children.every((child) => child !== null);
  const levelKey = lodLevelKey(request.address.level);
  let surface: TileSurface;
  let sampling: TileSamplingStatistics | null = null;
  if (isWorkerProfiling()) countRequestPayload(request, hasAllChildren);
  if (hasAllChildren) {
    surface = inSection("lod.downsampleChildren", () => surfaceFromChildren(children as PackedTileSurface[]), DIMENSIONS.lodLevel, levelKey);
    if (request.overlay !== undefined) inSection("lod.applyOverlay", () => applyOverlay(surface, request.overlay!), DIMENSIONS.lodLevel, levelKey);
  } else {
    const hint =
      request.hint === undefined
        ? undefined
        : { address: request.hint.address, surface: inSection("lod.unpackHint", () => unpackTileSurface(request.hint!.packedSurface)) };
    const sampler = inSection("lod.selectSampler", () => samplerForSeed(request.seed));
    const sampled = inSection("lod.sampleWorldgen", () => sampler.sample(request.address, hint, request.overlay), DIMENSIONS.lodLevel, levelKey);
    surface = sampled.surface;
    sampling = sampled.statistics;
  }
  const sampleMilliseconds = performance.now() - sampleStartedAt;
  const meshStartedAt = performance.now();
  const mesh = inSection("lod.mesh", () => meshTileSurface(surface), DIMENSIONS.lodLevel, levelKey);
  const packedSurface = inSection("lod.pack", () => packTileSurface(surface), DIMENSIONS.lodLevel, levelKey);
  const meshMilliseconds = performance.now() - meshStartedAt;
  if (isWorkerProfiling()) {
    const vertexCount = mesh.vertices.length / 2;
    addWorkerCounter("lodTilesBuilt", 1);
    addWorkerCounter(hasAllChildren ? "lodTilesFromChildren" : "lodTilesFromWorldgen", 1);
    addWorkerCounter("lodVertices", vertexCount);
    addWorkerCounter("lodTerrainQuads", mesh.terrainQuadCount);
    addWorkerCounter("lodWaterQuads", mesh.waterQuadCount);
    addWorkerCounter("lodTriangles", (mesh.terrainQuadCount + mesh.waterQuadCount) * 2);
    addWorkerCounter("lodVertexBytes", mesh.vertices.byteLength);
    addWorkerCounter("lodPackedSurfaceBytes", packedSurface.byteLength);
    addWorkerKeyedUnits(DIMENSIONS.lodLevel, levelKey, vertexCount);
  }
  return {
    address: request.address,
    source: hasAllChildren ? "children" : "worldgen",
    packedSurface,
    vertices: mesh.vertices,
    terrainQuadCount: mesh.terrainQuadCount,
    waterQuadCount: mesh.waterQuadCount,
    minY: mesh.minY,
    maxY: mesh.maxY,
    sampleMilliseconds,
    meshMilliseconds,
    sampling,
  };
}

export function listLodTileTransferables(result: LodTileBuildResult): Transferable[] {
  return [result.packedSurface, result.vertices.buffer];
}
