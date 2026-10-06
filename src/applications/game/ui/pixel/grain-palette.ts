import { LOADING_SCREEN_TEXTURES } from "../../blocks";
import { profiler } from "../../profiler";

/** Packs RGBA into the little-endian Uint32 layout canvas ImageData uses. */
export function packColor(red: number, green: number, blue: number): number {
  return ((255 << 24) | (blue << 16) | (green << 8) | red) >>> 0;
}

export interface GrainPalette {
  /** One list of opaque pixel colors per source texture. */
  texturePixels: Uint32Array[];
}

const FALLBACK_COLORS = [
  packColor(134, 96, 67),
  packColor(120, 120, 120),
  packColor(95, 159, 53),
  packColor(219, 207, 163),
];

function readOpaquePixels(image: HTMLImageElement): Uint32Array {
  const readToken = profiler.begin("main.ui.pixelBackdrop.loadPalette.readPixels");
  try {
    const opaquePixels = readOpaquePixelsUnprofiled(image);
    profiler.addCounter("game.ui.pixelBackdrop.paletteTexturesRead");
    profiler.addCounter("game.ui.pixelBackdrop.paletteColors", opaquePixels.length);
    profiler.recordBytes(
      "bytes.ui.pixelBackdrop.paletteTextureRead",
      image.naturalWidth * image.naturalHeight * 4,
    );
    return opaquePixels;
  } finally {
    profiler.end(readToken);
  }
}

function readOpaquePixelsUnprofiled(image: HTMLImageElement): Uint32Array {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return new Uint32Array(FALLBACK_COLORS);
  context.drawImage(image, 0, 0);
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const opaquePixels: number[] = [];
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if (rgba[offset + 3] === 255) {
      opaquePixels.push(
        packColor(rgba[offset], rgba[offset + 1], rgba[offset + 2]),
      );
    }
  }
  return opaquePixels.length > 0
    ? Uint32Array.from(opaquePixels)
    : new Uint32Array(FALLBACK_COLORS);
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

let cachedPalette: Promise<GrainPalette> | null = null;

/**
 * Samples real pixels out of the game's opaque block textures so the sand in
 * the menus is made of the same pixels as the world.
 */
export function loadGrainPalette(): Promise<GrainPalette> {
  profiler.addCounter(
    cachedPalette ? "game.ui.pixelBackdrop.paletteCacheHits" : "game.ui.pixelBackdrop.paletteLoads",
  );
  cachedPalette ??= profiler.measureAsync("latency.ui.pixelBackdrop.loadPalette", () =>
    Promise.all(LOADING_SCREEN_TEXTURES.map((name) => loadImage(`/game/${name}`))).then(
      (images) => {
        const texturePixels = images
          .filter((image): image is HTMLImageElement => image !== null)
          .map(readOpaquePixels);
        return {
          texturePixels:
            texturePixels.length > 0
              ? texturePixels
              : [new Uint32Array(FALLBACK_COLORS)],
        };
      },
    ),
  );
  return cachedPalette;
}
