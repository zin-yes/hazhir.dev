// One LOD tile from request to transferable result: the surface comes from the four children when they are all
// known (a pure downsample), otherwise from the worldgen sampler seeded by a coarser ancestor; real chunk data in the
// overlay replaces its cells either way. The surface is then meshed and packed. Pure and deterministic, so the worker,
// the benchmark and the tests all run exactly this.

import { addWorkerCounter, endWorkerSection, isWorkerProfiling, startWorkerSection } from "../../profiler/worker-recorder";
import { TILE_CELL_COUNT } from "../core/lod-constants";
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
    sampler = new WorldgenTileSampler(getSeedWorldgenContext(seed));
    samplersBySeed.set(seed, sampler);
  }
  return sampler;
}

function surfaceFromChildren(children: PackedTileSurface[]): TileSurface {
  const parent = createTileSurface();
  children.forEach((packedChild, childIndex) => {
    downsampleChildIntoParent(unpackTileSurface(packedChild), parent, childIndex & 1, childIndex >> 1);
  });
  return parent;
}

function applyOverlay(surface: TileSurface, overlay: NonNullable<LodTileBuildRequest["overlay"]>): void {
  for (let index = 0; index < TILE_CELL_COUNT; index++) {
    if (overlay.coveredCells[index] !== 1) continue;
    surface.heights[index] = overlay.surface.heights[index]!;
    surface.topBlocks[index] = overlay.surface.topBlocks[index]!;
    surface.sideBlocks[index] = overlay.surface.sideBlocks[index]!;
    surface.waterLevels[index] = overlay.surface.waterLevels[index]!;
  }
}

function inSection<Result>(name: string, work: () => Result): Result {
  if (!isWorkerProfiling()) return work();
  startWorkerSection(name);
  try {
    return work();
  } finally {
    endWorkerSection();
  }
}

export function buildLodTile(request: LodTileBuildRequest): LodTileBuildResult {
  const sampleStartedAt = performance.now();
  const children = request.children;
  const hasAllChildren = children !== undefined && children.length === 4 && children.every((child) => child !== null);
  let surface: TileSurface;
  let sampling: TileSamplingStatistics | null = null;
  if (hasAllChildren) {
    surface = inSection("lod.downsampleChildren", () => surfaceFromChildren(children as PackedTileSurface[]));
    if (request.overlay !== undefined) applyOverlay(surface, request.overlay);
  } else {
    const hint = request.hint === undefined ? undefined : { address: request.hint.address, surface: unpackTileSurface(request.hint.packedSurface) };
    const sampled = inSection("lod.sampleWorldgen", () => samplerForSeed(request.seed).sample(request.address, hint, request.overlay));
    surface = sampled.surface;
    sampling = sampled.statistics;
  }
  const sampleMilliseconds = performance.now() - sampleStartedAt;
  const meshStartedAt = performance.now();
  const mesh = inSection("lod.mesh", () => meshTileSurface(surface));
  const packedSurface = inSection("lod.pack", () => packTileSurface(surface));
  const meshMilliseconds = performance.now() - meshStartedAt;
  if (isWorkerProfiling()) {
    addWorkerCounter("lodTilesBuilt", 1);
    addWorkerCounter("lodVertices", mesh.vertices.length / 2);
    addWorkerCounter("lodPackedSurfaceBytes", packedSurface.byteLength);
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
