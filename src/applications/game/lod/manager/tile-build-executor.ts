// Where tile builds run. In the game: the LOD worker pool (WorkerPool, so the profiler sees queue waits, transfer
// sizes and worker sections). In tests and the headless benchmark: in-process, same builder.

import { profiler } from "../../profiler";
import { WorkerPool } from "../../worker-pool";
import { buildLodTile, type LodTileBuildRequest, type LodTileBuildResult } from "../worker/lod-tile-builder";

export interface TileBuildExecutor {
  build(request: LodTileBuildRequest, transfer: Transferable[]): Promise<LodTileBuildResult>;
  terminate(): void;
  /** Builds the worldgen state ahead of the first tile: the shared registries, or a seed's noise router. */
  prepare?(seed?: number): void;
}

export const LOD_WORKER_POOL_NAME = "lod";

export function createWorkerPoolExecutor(workerFactory: () => Worker, workerCount: number): TileBuildExecutor {
  const pool = new WorkerPool(workerFactory, workerCount, LOD_WORKER_POOL_NAME);
  pool.warmUp();
  return {
    build: (request, transfer) => pool.execLazy("buildLodTile", () => ({ params: [request], transfer })),
    terminate: () => pool.terminate(),
    prepare: (seed) => {
      profiler.addCounter("game.lod.executor.prepareCalls");
      profiler.addCounter("game.lod.executor.prepareTasks", workerCount);
      for (let worker = 0; worker < workerCount; worker++) void pool.exec("prepareWorldgen", [seed]).catch(() => undefined);
    },
  };
}

/**
 * The same executor for every LOD manager of a session: managers come and go with worlds and settings while the
 * workers (and their decoded worldgen registries) stay warm. Only `terminateShared` stops them.
 */
export function shareExecutor(executor: TileBuildExecutor): TileBuildExecutor & { terminateShared(): void } {
  return {
    build: (request, transfer) => executor.build(request, transfer),
    terminate: () => undefined,
    prepare: (seed) => executor.prepare?.(seed),
    terminateShared: () => executor.terminate(),
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
