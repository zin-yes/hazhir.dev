// Average colour of a block texture PNG, as the GPU would see it from far away: pixels the main shader discards
// (alpha below 0.5) are skipped and the rest are averaged in linear light, then encoded back to sRGB.
// Node/Bun only (node:zlib); the game reads the generated table instead.

import { inflateSync } from "node:zlib";

const PNG_SIGNATURE_LENGTH = 8;
const RGBA_COLOR_TYPE = 6;
const BYTES_PER_RGBA_PIXEL = 4;
const MAIN_SHADER_ALPHA_CUTOFF = 128;

export interface DecodedRgbaImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

function paethPredictor(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const distanceToLeft = Math.abs(estimate - left);
  const distanceToAbove = Math.abs(estimate - above);
  const distanceToUpperLeft = Math.abs(estimate - upperLeft);
  if (distanceToLeft <= distanceToAbove && distanceToLeft <= distanceToUpperLeft) return left;
  if (distanceToAbove <= distanceToUpperLeft) return above;
  return upperLeft;
}

/** Decodes an 8-bit, non-interlaced RGBA PNG (the only format the block textures use). */
export function decodeRgbaPng(fileBytes: Uint8Array): DecodedRgbaImage {
  const view = new DataView(fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength);
  let offset = PNG_SIGNATURE_LENGTH;
  let width = 0;
  let height = 0;
  const compressedParts: Uint8Array[] = [];
  while (offset < fileBytes.length) {
    const chunkLength = view.getUint32(offset);
    const chunkType = String.fromCharCode(...fileBytes.subarray(offset + 4, offset + 8));
    const chunkData = fileBytes.subarray(offset + 8, offset + 8 + chunkLength);
    if (chunkType === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const bitDepth = chunkData[8];
      const colorType = chunkData[9];
      const interlace = chunkData[12];
      if (bitDepth !== 8 || colorType !== RGBA_COLOR_TYPE || interlace !== 0) {
        throw new Error(`Unsupported PNG (bit depth ${bitDepth}, color type ${colorType}, interlace ${interlace})`);
      }
    } else if (chunkType === "IDAT") {
      compressedParts.push(chunkData);
    } else if (chunkType === "IEND") {
      break;
    }
    offset += 12 + chunkLength;
  }
  const compressed = Buffer.concat(compressedParts);
  const filtered = new Uint8Array(inflateSync(compressed));
  const rowBytes = width * BYTES_PER_RGBA_PIXEL;
  const pixels = new Uint8Array(rowBytes * height);
  for (let row = 0; row < height; row++) {
    const filterType = filtered[row * (rowBytes + 1)];
    const sourceStart = row * (rowBytes + 1) + 1;
    const targetStart = row * rowBytes;
    for (let column = 0; column < rowBytes; column++) {
      const raw = filtered[sourceStart + column]!;
      const left = column >= BYTES_PER_RGBA_PIXEL ? pixels[targetStart + column - BYTES_PER_RGBA_PIXEL]! : 0;
      const above = row > 0 ? pixels[targetStart - rowBytes + column]! : 0;
      const upperLeft = row > 0 && column >= BYTES_PER_RGBA_PIXEL ? pixels[targetStart - rowBytes + column - BYTES_PER_RGBA_PIXEL]! : 0;
      let predicted = 0;
      if (filterType === 1) predicted = left;
      else if (filterType === 2) predicted = above;
      else if (filterType === 3) predicted = (left + above) >> 1;
      else if (filterType === 4) predicted = paethPredictor(left, above, upperLeft);
      pixels[targetStart + column] = (raw + predicted) & 0xff;
    }
  }
  return { width, height, pixels };
}

export function srgbChannelToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

export function linearChannelToSrgb(linear: number): number {
  const encoded = linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(encoded * 255)));
}

/** 0xRRGGBB (sRGB) average of the pixels the main shader keeps, or -1 when it discards every pixel. */
export function averageVisibleColor(image: DecodedRgbaImage): number {
  let red = 0;
  let green = 0;
  let blue = 0;
  let visiblePixels = 0;
  for (let index = 0; index < image.pixels.length; index += BYTES_PER_RGBA_PIXEL) {
    if (image.pixels[index + 3]! < MAIN_SHADER_ALPHA_CUTOFF) continue;
    red += srgbChannelToLinear(image.pixels[index]!);
    green += srgbChannelToLinear(image.pixels[index + 1]!);
    blue += srgbChannelToLinear(image.pixels[index + 2]!);
    visiblePixels++;
  }
  if (visiblePixels === 0) return -1;
  return (
    (linearChannelToSrgb(red / visiblePixels) << 16) |
    (linearChannelToSrgb(green / visiblePixels) << 8) |
    linearChannelToSrgb(blue / visiblePixels)
  );
}
