import { generateChunk } from "./generation";
import { initializeChunkLight, propagateChunkLight } from "./lighting";
import { generateMesh, listTransferables } from "./mesh";
import { loadTextureArray } from "./texture-array";
import {
  beginWorkerTask,
  finishWorkerTask,
} from "../profiler/worker-recorder";

const workerScope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

addEventListener("message", async (event: MessageEvent) => {
  const { id, method, params } = event.data;
  const isProfiling = event.data.profile === true;
  beginWorkerTask(isProfiling, event.data.trace === true);
  try {
    let result;
    let transfer: Transferable[] = [];
    if (method === "ping") {
      result = true;
    } else if (method === "generateChunk") {
      const chunkBuffer = generateChunk(params[0], params[1], params[2], params[3]);
      result = chunkBuffer;
      transfer = [chunkBuffer];
    } else if (method === "generateMesh") {
      result = generateMesh(
        params[0],
        params[1],
        params[2],
        params[3],
        params[4],
        params[5],
        params[6],
        params[7]
      );
      transfer = listTransferables(result);
    } else if (method === "loadTextureArray") {
      result = await loadTextureArray(params[0], (fraction) =>
        postMessage({ id, progress: fraction }),
      );
    } else if (method === "initializeChunkLight") {
      result = initializeChunkLight(
        new Uint8Array(params[0]),
        params[1],
        params[2],
        params[3],
        params[4],
        params[5] ? new Uint8Array(params[5]) : undefined,
        params[6] ? new Uint8Array(params[6]) : undefined
      );
      transfer = [result.light.buffer];
    } else if (method === "propagateChunkLight") {
      // neighbors and neighborLights are objects with ArrayBuffers
      const neighbors: { [key: string]: Uint8Array } = {};
      if (params[2]) {
        Object.keys(params[2]).forEach((key) => {
          if (params[2][key]) neighbors[key] = new Uint8Array(params[2][key]);
        });
      }

      const neighborLights: { [key: string]: Uint8Array } = {};
      if (params[3]) {
        Object.keys(params[3]).forEach((key) => {
          if (params[3][key])
            neighborLights[key] = new Uint8Array(params[3][key]);
        });
      }

      result = propagateChunkLight(
        new Uint8Array(params[0]),
        new Uint8Array(params[1]),
        neighbors,
        neighborLights,
        params[4]
      );
      transfer = [
        result.centerLight.buffer,
        ...Object.values(result.neighborLightUpdates).map((update) => update.buffer),
      ];
    } else {
      throw new Error(`Unknown method: ${method}`);
    }
    const profile = finishWorkerTask();
    const postStartedAtMs = performance.now();
    workerScope.postMessage({ id, result, profile }, transfer);
    if (isProfiling) {
      postMessage({
        id,
        resultTail: { resultPostMs: performance.now() - postStartedAtMs },
      });
    }
  } catch (error) {
    console.error("Worker Error:", error);
    const profile = finishWorkerTask();
    postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
      profile,
    });
  }
});
