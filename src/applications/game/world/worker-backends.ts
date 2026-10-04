// The chunk pipeline's backends on top of the game's worker pools. Every buffer sent is a fresh copy the main
// thread no longer needs, so all of them are transferred instead of cloned.

import type { WorkerPool } from "../worker-pool";
import type { ChunkFaceBuffers } from "../workers/mesh-types";
import { listSlabTransferables } from "../workers/region-surroundings";
import type {
  GenerationBackend,
  LightingBackend,
  MeshBackend,
} from "./pipeline-backends";

export interface WorkerPoolsForPipeline {
  generation: WorkerPool;
  generationWorkerCount: number;
  lighting: WorkerPool;
  lightingWorkerCount: number;
  meshing: WorkerPool;
  meshWorkerCount: number;
}

function faceBuffers(faces: ChunkFaceBuffers): ArrayBuffer[] {
  return Object.values(faces).filter((buffer): buffer is ArrayBuffer => Boolean(buffer));
}

export function createWorkerBackends(pools: WorkerPoolsForPipeline, seed: number) {
  const generation: GenerationBackend = {
    workerCount: pools.generationWorkerCount,
    generateColumn: ({ chunkX, chunkZ, chunkYs, workerIndex }) =>
      pools.generation.execLazy(
        "generateChunkColumn",
        () => ({ params: [seed, chunkX, chunkZ, chunkYs] }),
        { affinityKey: workerIndex },
      ),
  };
  const lighting: LightingBackend = {
    workerCount: pools.lightingWorkerCount,
    lightRegion: ({ regionChunks, slabs }) =>
      pools.lighting.execLazy("lightRegionFromSlabs", () => ({
        params: [regionChunks, slabs],
        transfer: [
          ...regionChunks.flatMap((chunk) => (chunk.blocks ? [chunk.blocks.buffer as ArrayBuffer] : [])),
          ...listSlabTransferables(slabs),
        ],
      })),
  };
  const meshing: MeshBackend = {
    workerCount: pools.meshWorkerCount,
    buildMesh: ({ chunkX, chunkY, chunkZ, blocks, light, borders, borderLights }) =>
      pools.meshing.execLazy("generateMesh", () => ({
        params: [blocks, light, borders, borderLights, seed, chunkX, chunkY, chunkZ],
        transfer: [blocks, light, ...faceBuffers(borders), ...faceBuffers(borderLights)],
      })),
  };
  return { generation, lighting, meshing };
}
