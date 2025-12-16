import { generateChunk } from "./generation";
import { initializeChunkLight, propagateChunkLight } from "./lighting";
import { generateMesh } from "./mesh";
import { loadTextureArray } from "./texture-array";

addEventListener("message", async (event: MessageEvent) => {
  const { id, method, params } = event.data;
  try {
    let result;
    if (method === "generateChunk") {
      result = generateChunk(params[0], params[1], params[2], params[3]);
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
    } else if (method === "loadTextureArray") {
      result = await loadTextureArray(params[0]);
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
    } else {
      throw new Error(`Unknown method: ${method}`);
    }
    postMessage({ id, result });
  } catch (error) {
    console.error("Worker Error:", error);
    postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
