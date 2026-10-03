// 16x16 RGBA canvas with optional wrap-around addressing, plus PNG output via sharp.

import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";
import { TEXTURE_SIZE } from "./noise";
import type { Rgb } from "./color";

export type Pixel = Rgb | null;

export class Texture {
  private readonly pixels: Pixel[];

  constructor(private readonly wraps: boolean = true, initialColor: Pixel = null) {
    this.pixels = new Array<Pixel>(TEXTURE_SIZE * TEXTURE_SIZE).fill(initialColor);
  }

  static filled(color: Rgb): Texture {
    return new Texture(true, color);
  }

  private indexOf(x: number, y: number): number | null {
    if (this.wraps) {
      const wrappedX = ((x % TEXTURE_SIZE) + TEXTURE_SIZE) % TEXTURE_SIZE;
      const wrappedY = ((y % TEXTURE_SIZE) + TEXTURE_SIZE) % TEXTURE_SIZE;
      return wrappedY * TEXTURE_SIZE + wrappedX;
    }
    if (x < 0 || y < 0 || x >= TEXTURE_SIZE || y >= TEXTURE_SIZE) return null;
    return y * TEXTURE_SIZE + x;
  }

  get(x: number, y: number): Pixel {
    const index = this.indexOf(Math.round(x), Math.round(y));
    return index === null ? null : this.pixels[index];
  }

  set(x: number, y: number, color: Pixel): void {
    const index = this.indexOf(Math.round(x), Math.round(y));
    if (index !== null) this.pixels[index] = color;
  }

  paint(painter: (x: number, y: number) => Pixel): this {
    for (let y = 0; y < TEXTURE_SIZE; y++) {
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        this.pixels[y * TEXTURE_SIZE + x] = painter(x, y);
      }
    }
    return this;
  }

  copy(): Texture {
    const duplicate = new Texture(this.wraps);
    this.pixels.forEach((pixel, index) => {
      duplicate.pixels[index] = pixel;
    });
    return duplicate;
  }

  async savePng(filePath: string): Promise<void> {
    const rawBytes = Buffer.alloc(TEXTURE_SIZE * TEXTURE_SIZE * 4);
    this.pixels.forEach((pixel, index) => {
      if (!pixel) return;
      rawBytes[index * 4] = pixel[0];
      rawBytes[index * 4 + 1] = pixel[1];
      rawBytes[index * 4 + 2] = pixel[2];
      rawBytes[index * 4 + 3] = 255;
    });
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    await sharp(rawBytes, { raw: { width: TEXTURE_SIZE, height: TEXTURE_SIZE, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toFile(filePath);
  }

  static async loadPng(filePath: string): Promise<Texture> {
    const { data } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const texture = new Texture();
    texture.paint((x, y) => {
      const offset = (y * TEXTURE_SIZE + x) * 4;
      return data[offset + 3] < 128 ? null : [data[offset], data[offset + 1], data[offset + 2]];
    });
    return texture;
  }
}

export interface TextureDefinition {
  fileName: string;
  draw: () => Texture | Promise<Texture>;
}
