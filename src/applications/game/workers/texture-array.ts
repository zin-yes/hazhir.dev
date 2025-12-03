import * as THREE from "three";
import { Texture } from "../blocks";
import { TEXTURE_SIZE } from "../config";

async function loadImage(url: string) {
  const image = await (await fetch(url)).blob();

  return await createImageBitmap(image);
}

export async function loadTextureArray(baseUrl: string) {
  const canvas = new OffscreenCanvas(TEXTURE_SIZE, TEXTURE_SIZE);
  const context = canvas.getContext("2d", {
    colorSpace: THREE.SRGBColorSpace,
    alpha: false,
    willReadFrequently: true,
  });
  if (context) {
    const textureData: Uint8ClampedArray[] = [];

    const texturesToLoad: string[] = Object.values(Texture);

    for (let i = 0; i < texturesToLoad.length; i++) {
      const image = await loadImage(baseUrl + "/game/" + texturesToLoad[i]);

      context.drawImage(image, 0, 0);
      const imageData = context.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

      textureData.push(new Uint8ClampedArray(imageData.data.buffer));
    }

    let length = 0;
    textureData.forEach((item) => {
      length += item.length;
    });

    let mergedTextureData = new Uint8ClampedArray(length);
    let offset = 0;
    textureData.forEach((item) => {
      mergedTextureData.set(item, offset);
      offset += item.length;
    });
    return { data: mergedTextureData, length: textureData.length };
  }
  return null;
}
