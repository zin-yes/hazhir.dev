// Where tile builds run. In the game: the LOD worker pool (WorkerPool, so the profiler sees queue waits, transfer
// sizes and worker sections). In tests and the headless benchmark: in-process, same builder.

import { WorkerPool } from "../../worker-pool";
import { buildLodTile, type LodTileBuildRequest, type LodTileBuildResult } from "../worker/lod-tile-builder";

export interface TileBuildExecutor {
  build(request: LodTileBuildRequest, transfer: Transferable[]): Promise<LodTileBuildResult>;
  terminate(): void;
}

export const LOD_WORKER_POOL_NAME = "lod";

export function createWorkerPoolExecutor(workerFactory: () => Worker, workerCount: number): TileBuildExecutor {
  const pool = new WorkerPool(workerFactory, workerCount, LOD_WORKER_POOL_NAME);
  pool.warmUp();
  return {
    build: (request, transfer) => pool.execLazy("buildLodTile", () => ({ params: [request], transfer })),
    terminate: () => pool.terminate(),
  };
}

/** Builds on the calling thread, resolving on a later microtask like a worker reply would. */
export function createInProcessExecutor(): TileBuildExecutor {
  let terminated = false;
  return {
    build: (request) =>
      new Promise((resolve, reject) => {
        queueMicrotask(() => {
          if (terminated) return;
          try {
            resolve(buildLodTile(request));
          } catch (error) {
            reject(error);
          }
        });
      }),
    terminate: () => {
      terminated = true;
    },
  };
}
