// The chunk pipeline's backends on top of the game's worker pools. Every buffer sent is a fresh copy the main
// thread no longer needs, so all of them are transferred instead of cloned.

import { profiler } from "../profiler";
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

function totalByteLength(buffers: ArrayBuffer[]): number {
  let total = 0;
  for (const buffer of buffers) total += buffer.byteLength;
  return total;
}

/** Times a backend call from request to result as wall-clock latency (queue wait, transfer and execution). */
function recordRoundTrip<Result>(timerName: string, pending: Promise<Result>): Promise<Result> {
  if (!profiler.enabled) return pending;
  const startedAtMs = profiler.now();
  const record = () => profiler.recordTimer(timerName, profiler.now() - startedAtMs, "latency");
  pending.then(record, record);
  return pending;
}

export function createWorkerBackends(pools: WorkerPoolsForPipeline, seed: number) {
  const generation: GenerationBackend = {
    workerCount: pools.generationWorkerCount,
    generateColumn: ({ chunkX, chunkZ, chunkYs, workerIndex }) => {
      profiler.addCounter("game.backend.generation.requests");
      profiler.sampleGauge("game.backend.generation.chunksPerColumn", chunkYs.length);
      return recordRoundTrip(
        "latency.backend.generation.roundTrip",
        pools.generation.execLazy(
          "generateChunkColumn",
          () => ({ params: [seed, chunkX, chunkZ, chunkYs] }),
          { affinityKey: workerIndex },
        ),
      );
    },
  };
  const lighting: LightingBackend = {
    workerCount: pools.lightingWorkerCount,
    lightRegion: ({ regionChunks, slabs }) => {
      profiler.addCounter("game.backend.lighting.requests");
      profiler.sampleGauge("game.backend.lighting.chunksPerRegion", regionChunks.length);
      profiler.sampleGauge("game.backend.lighting.slabsPerRegion", slabs.length);
      return recordRoundTrip(
        "latency.backend.lighting.roundTrip",
        pools.lighting.execLazy("lightRegionFromSlabs", () => {
          const transfer = [
            ...regionChunks.flatMap((chunk) => (chunk.blocks ? [chunk.blocks.buffer as ArrayBuffer] : [])),
            ...listSlabTransferables(slabs),
          ];
          if (profiler.enabled) {
            profiler.addCounter("game.backend.lighting.buffersTransferred", transfer.length);
            profiler.recordBytes("bytes.backend.lighting.transferred", totalByteLength(transfer));
          }
          return { params: [regionChunks, slabs], transfer };
        }),
      );
    },
  };
  const meshing: MeshBackend = {
    workerCount: pools.meshWorkerCount,
    buildMesh: ({ chunkX, chunkY, chunkZ, blocks, light, borders, borderLights }) => {
      profiler.addCounter("game.backend.meshing.requests");
      return recordRoundTrip(
        "latency.backend.meshing.roundTrip",
        pools.meshing.execLazy("generateMesh", () => {
          const transfer = [blocks, light, ...faceBuffers(borders), ...faceBuffers(borderLights)];
          if (profiler.enabled) {
            profiler.addCounter("game.backend.meshing.buffersTransferred", transfer.length);
            profiler.recordBytes("bytes.backend.meshing.transferred", totalByteLength(transfer));
            profiler.sampleGauge("game.backend.meshing.borderFacesWithBlocks", faceBuffers(borders).length);
          }
          return {
            params: [blocks, light, borders, borderLights, seed, chunkX, chunkY, chunkZ],
            transfer,
          };
        }),
      );
    },
  };
  return { generation, lighting, meshing };
}
