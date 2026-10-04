// LOD worker entry. Speaks the WorkerPool protocol of the other game workers ({ id, method, params, profile, trace }
// in, { id, result, profile } plus a resultTail out), so it runs in a WorkerPool and reports to the profiler.
// Construct it with a literal URL so the bundler emits it:
//   new Worker(new URL("./lod/worker/lod-worker.ts", import.meta.url), { name: "lod" })

import { beginWorkerTask, finishWorkerTask } from "../../profiler/worker-recorder";
import { buildLodTile, listLodTileTransferables, type LodTileBuildRequest } from "./lod-tile-builder";

const workerScope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
};

workerScope.addEventListener("message", (event: MessageEvent) => {
  const { id, method, params } = event.data;
  const isProfiling = event.data.profile === true;
  beginWorkerTask(isProfiling, event.data.trace === true);
  try {
    let result: unknown;
    let transfer: Transferable[] = [];
    if (method === "ping") {
      result = true;
    } else if (method === "buildLodTile") {
      const built = buildLodTile(params[0] as LodTileBuildRequest);
      result = built;
      transfer = listLodTileTransferables(built);
    } else {
      throw new Error(`Unknown LOD worker method: ${method}`);
    }
    const profile = finishWorkerTask();
    const postStartedAtMs = performance.now();
    workerScope.postMessage({ id, result, profile }, transfer);
    if (isProfiling) workerScope.postMessage({ id, resultTail: { resultPostMs: performance.now() - postStartedAtMs } });
  } catch (error) {
    console.error("LOD worker error:", error);
    const profile = finishWorkerTask();
    workerScope.postMessage({ id, error: error instanceof Error ? error.message : String(error), profile });
  }
});
