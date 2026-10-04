// What the chunk pipeline needs from the outside world. The game passes worker pools (world/worker-backends.ts);
// tests pass fakes that resolve when told to.

import type { ChunkFaceBuffers, ChunkMeshResult } from "../workers/mesh-types";
import type { GeneratedColumn } from "../workers/generation";
import type { RegionLightResult } from "../workers/region-lighting";
import type { RegionChunkInput, SurroundingSlab } from "../workers/region-surroundings";
import type { ChunkRecord } from "./chunk-record";

export type { GeneratedColumn, GeneratedColumnChunk } from "../workers/generation";

export interface ColumnGenerationRequest {
  chunkX: number;
  chunkZ: number;
  chunkYs: number[];
  /** The worker that should run it (its caches hold the neighboring columns). */
  workerIndex: number;
}

export interface GenerationBackend {
  readonly workerCount: number;
  generateColumn(request: ColumnGenerationRequest): Promise<GeneratedColumn>;
}

export interface RegionLightingRequest {
  regionChunks: RegionChunkInput[];
  slabs: SurroundingSlab[];
}

export interface LightingBackend {
  readonly workerCount: number;
  lightRegion(request: RegionLightingRequest): Promise<RegionLightResult>;
}

export interface ChunkMeshRequest {
  chunkX: number;
  chunkY: number;
  chunkZ: number;
  /** Copies the worker may take over. */
  blocks: ArrayBuffer;
  light: ArrayBuffer;
  borders: ChunkFaceBuffers;
  borderLights: ChunkFaceBuffers;
}

export interface MeshBackend {
  readonly workerCount: number;
  buildMesh(request: ChunkMeshRequest): Promise<ChunkMeshResult | null>;
}

export interface ChunkPipelineEvents {
  /** Blocks are in place (saved edits applied); light is not known yet. */
  onChunkGenerated?(record: ChunkRecord): void;
  /** A mesh for the chunk is ready; null means it draws nothing (remove whatever it drew before). */
  onMeshReady(record: ChunkRecord, mesh: ChunkMeshResult | null): void;
  /** The chunk left the loaded set: dispose what it drew. */
  onChunkUnloaded(record: ChunkRecord): void;
  /** Saved edits of a chunk, as chunk cell index to block, applied right after generation. */
  savedEditsFor?(chunkX: number, chunkY: number, chunkZ: number): ReadonlyMap<number, number> | undefined;
  /** Highest chunk y of a column holding a saved edit, so built-up columns are never cut off as sky. */
  highestEditedChunkY?(chunkX: number, chunkZ: number): number | undefined;
  /** Progress of the area around the start position, each between 0 and 1. */
  onStartAreaProgress?(progress: StartAreaProgress): void;
  /** Every chunk around the start position is on screen. */
  onStartAreaReady?(): void;
}

export interface StartAreaProgress {
  generated: number;
  lit: number;
  meshed: number;
}
