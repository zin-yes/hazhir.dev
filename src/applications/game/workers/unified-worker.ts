import { generateChunk } from "./generation";
import { generateMesh } from "./mesh";
import { loadTextureArray } from "./texture-array";

addEventListener("message", async (event: MessageEvent) => {
  const { id, method, params } = event.data;
  try {
    let result;
    if (method === "generateChunk") {
      result = generateChunk(params[0], params[1], params[2], params[3]);
    } else if (method === "generateMesh") {
      result = generateMesh(params[0], params[1]);
    } else if (method === "loadTextureArray") {
      result = await loadTextureArray(params[0]);
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
