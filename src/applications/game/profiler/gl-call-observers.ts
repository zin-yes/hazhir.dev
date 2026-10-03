import {
  bytesOfBufferSource,
  bytesOfMipChain,
  bytesPerPixelForInternalFormat,
  bytesPerPixelForUpload,
  dimensionsOfImageSource,
} from "./gl-byte-sizes";
import type { GlMemoryTracker } from "./gl-memory-tracker";

export type GlCallObserver = (args: ArrayLike<unknown>) => void;

export interface UploadSink {
  addBufferUpload(bytes: number): void;
  addTextureUpload(bytes: number): void;
}

const IMAGE_SOURCE_PIXEL_FORMAT = 0x1908;
const IMAGE_SOURCE_PIXEL_TYPE = 0x1401;

function numberAt(args: ArrayLike<unknown>, index: number): number {
  const value = args[index];
  return typeof value === "number" ? value : 0;
}

/** Bytes a texture upload moves: view length, image dimensions, or an estimate. */
function uploadedBytes(
  pixels: unknown,
  width: number,
  height: number,
  depth: number,
  format: number,
  type: number,
): number {
  if (ArrayBuffer.isView(pixels)) return pixels.byteLength;
  if (pixels === null || pixels === undefined) return 0;
  const imageDimensions = dimensionsOfImageSource(pixels);
  if (imageDimensions) {
    return (
      imageDimensions.width *
      imageDimensions.height *
      bytesPerPixelForUpload(format, type)
    );
  }
  return width * height * depth * bytesPerPixelForUpload(format, type);
}

function firstViewBytes(args: ArrayLike<unknown>): number {
  for (let index = 0; index < args.length; index++) {
    const candidate = args[index];
    if (ArrayBuffer.isView(candidate)) return candidate.byteLength;
  }
  return 0;
}

/**
 * Per-function observers that keep the memory tracker in sync and report
 * upload sizes. Run after the original call, so they never delay it.
 */
export function createGlCallObservers(
  tracker: GlMemoryTracker,
  uploads: UploadSink,
): { [functionName: string]: GlCallObserver } {
  const recordTextureImage = (
    args: ArrayLike<unknown>,
    width: number,
    height: number,
    depth: number,
    uploadedByteCount: number,
  ) => {
    const target = numberAt(args, 0);
    const allocatedBytes =
      width * height * depth * bytesPerPixelForInternalFormat(numberAt(args, 2));
    tracker.recordTextureLevel(target, numberAt(args, 1), allocatedBytes);
    uploads.addTextureUpload(uploadedByteCount);
  };

  return {
    bindBuffer: (args) => tracker.bindBuffer(numberAt(args, 0), args[1] as object | null),
    deleteBuffer: (args) => tracker.deleteBuffer(args[0] as object | null),
    bufferData: (args) => {
      const bytes = bytesOfBufferSource(args[1], args[3], args[4]);
      tracker.recordBufferData(numberAt(args, 0), bytes);
      uploads.addBufferUpload(bytes);
    },
    bufferSubData: (args) => {
      uploads.addBufferUpload(bytesOfBufferSource(args[2], args[3], args[4]));
    },

    activeTexture: (args) => tracker.activeTexture(numberAt(args, 0)),
    bindTexture: (args) => tracker.bindTexture(numberAt(args, 0), args[1] as object | null),
    deleteTexture: (args) => tracker.deleteTexture(args[0] as object | null),
    generateMipmap: (args) => tracker.recordMipmapGeneration(numberAt(args, 0)),

    texImage2D: (args) => {
      if (args.length <= 6) {
        const dimensions = dimensionsOfImageSource(args[5]) ?? { width: 0, height: 0 };
        const bytes = uploadedBytes(
          args[5], dimensions.width, dimensions.height, 1,
          numberAt(args, 3) || IMAGE_SOURCE_PIXEL_FORMAT,
          numberAt(args, 4) || IMAGE_SOURCE_PIXEL_TYPE,
        );
        recordTextureImage(args, dimensions.width, dimensions.height, 1, bytes);
        return;
      }
      const width = numberAt(args, 3);
      const height = numberAt(args, 4);
      const bytes = uploadedBytes(args[8], width, height, 1, numberAt(args, 6), numberAt(args, 7));
      recordTextureImage(args, width, height, 1, bytes);
    },
    texImage3D: (args) => {
      const width = numberAt(args, 3);
      const height = numberAt(args, 4);
      const depth = numberAt(args, 5);
      const bytes = uploadedBytes(args[9], width, height, depth, numberAt(args, 7), numberAt(args, 8));
      recordTextureImage(args, width, height, depth, bytes);
    },
    texSubImage2D: (args) => {
      if (args.length <= 7) {
        const dimensions = dimensionsOfImageSource(args[6]) ?? { width: 0, height: 0 };
        uploads.addTextureUpload(
          uploadedBytes(
            args[6], dimensions.width, dimensions.height, 1,
            numberAt(args, 4) || IMAGE_SOURCE_PIXEL_FORMAT,
            numberAt(args, 5) || IMAGE_SOURCE_PIXEL_TYPE,
          ),
        );
        return;
      }
      uploads.addTextureUpload(
        uploadedBytes(args[8], numberAt(args, 4), numberAt(args, 5), 1, numberAt(args, 6), numberAt(args, 7)),
      );
    },
    texSubImage3D: (args) => {
      uploads.addTextureUpload(
        uploadedBytes(
          args[10], numberAt(args, 5), numberAt(args, 6), numberAt(args, 7),
          numberAt(args, 8), numberAt(args, 9),
        ),
      );
    },
    texStorage2D: (args) => {
      tracker.recordTextureStorage(
        numberAt(args, 0),
        bytesOfMipChain(numberAt(args, 0), numberAt(args, 1), numberAt(args, 2), numberAt(args, 3), numberAt(args, 4), 1),
      );
    },
    texStorage3D: (args) => {
      tracker.recordTextureStorage(
        numberAt(args, 0),
        bytesOfMipChain(
          numberAt(args, 0), numberAt(args, 1), numberAt(args, 2),
          numberAt(args, 3), numberAt(args, 4), numberAt(args, 5),
        ),
      );
    },
    compressedTexImage2D: (args) => uploads.addTextureUpload(firstViewBytes(args)),
    compressedTexImage3D: (args) => uploads.addTextureUpload(firstViewBytes(args)),
    compressedTexSubImage2D: (args) => uploads.addTextureUpload(firstViewBytes(args)),
    compressedTexSubImage3D: (args) => uploads.addTextureUpload(firstViewBytes(args)),
  };
}
