import * as THREE from "three";
import { Texture } from "../blocks";
import { TEXTURE_SIZE } from "../config";
import {
  addWorkerCounter,
  endWorkerSection,
  startWorkerSection,
} from "../profiler/worker-recorder";

async function loadImage(url: string) {
  startWorkerSection("fetchResponse");
  const response = await fetch(url);
  endWorkerSection();

  startWorkerSection("readBlob");
  const image = await response.blob();
  endWorkerSection();
  addWorkerCounter("bytesFetched", image.size);

  startWorkerSection("decodeBitmap");
  const bitmap = await createImageBitmap(image);
  endWorkerSection();
  addWorkerCounter("pixelsDecoded", bitmap.width * bitmap.height);
  return bitmap;
}

export async function loadTextureArray(
  baseUrl: string,
  onProgress?: (fraction: number) => void,
) {
  const canvas = new OffscreenCanvas(TEXTURE_SIZE, TEXTURE_SIZE);
  const context = canvas.getContext("2d", {
    colorSpace: THREE.SRGBColorSpace,
    alpha: true,
    willReadFrequently: true,
  });
  if (context) {
    const textureData: Uint8ClampedArray[] = [];

    const texturesToLoad: string[] = Object.values(Texture);

    for (let i = 0; i < texturesToLoad.length; i++) {
      startWorkerSection("fetchAndDecode");
      const image = await loadImage(baseUrl + "/game/" + texturesToLoad[i]);
      endWorkerSection();

      startWorkerSection("drawAndRead");
      startWorkerSection("clearCanvas");
      context.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
      endWorkerSection();
      startWorkerSection("drawImage");
      context.drawImage(image, 0, 0);
      endWorkerSection();
      startWorkerSection("readPixels");
      const imageData = context.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
      endWorkerSection();
      endWorkerSection();
      addWorkerCounter("bytesRead", imageData.data.byteLength);

      textureData.push(new Uint8ClampedArray(imageData.data.buffer));
      onProgress?.(textureData.length / texturesToLoad.length);
    }

    startWorkerSection("mergeLayers");
    let length = 0;
    textureData.forEach((item) => {
      length += item.length;
    });

    startWorkerSection("allocateMerged");
    let mergedTextureData = new Uint8ClampedArray(length);
    endWorkerSection();
    startWorkerSection("copyLayers");
    let offset = 0;
    textureData.forEach((item) => {
      mergedTextureData.set(item, offset);
      offset += item.length;
    });
    endWorkerSection();
    endWorkerSection();
    addWorkerCounter("texturesLoaded", textureData.length);
    addWorkerCounter("bytesMerged", length);
    return { data: mergedTextureData, length: textureData.length };
  }
  return null;
}
