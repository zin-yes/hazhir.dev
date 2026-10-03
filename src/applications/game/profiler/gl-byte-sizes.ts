/** Pure helpers that estimate how many bytes a WebGL call moves or allocates. */

const TEXTURE_3D = 0x806f;
const TEXTURE_2D_ARRAY = 0x8c1a;

const CHANNELS_BY_FORMAT: { [format: number]: number } = {
  0x1908: 4, // RGBA
  0x1907: 3, // RGB
  0x8227: 2, // RG
  0x1903: 1, // RED
  0x1906: 1, // ALPHA
  0x1909: 1, // LUMINANCE
  0x190a: 2, // LUMINANCE_ALPHA
  0x1902: 1, // DEPTH_COMPONENT
  0x84f9: 1, // DEPTH_STENCIL
  0x8d99: 4, // RGBA_INTEGER
  0x8d98: 3, // RGB_INTEGER
  0x8228: 1, // RED_INTEGER
};

const BYTES_BY_TYPE: { [type: number]: number } = {
  0x1400: 1, // BYTE
  0x1401: 1, // UNSIGNED_BYTE
  0x1402: 2, // SHORT
  0x1403: 2, // UNSIGNED_SHORT
  0x1404: 4, // INT
  0x1405: 4, // UNSIGNED_INT
  0x1406: 4, // FLOAT
  0x140b: 2, // HALF_FLOAT (WebGL1 extension)
  0x8d61: 2, // HALF_FLOAT
};

const PACKED_TYPE_PIXEL_BYTES: { [type: number]: number } = {
  0x8363: 2, // UNSIGNED_SHORT_5_6_5
  0x8033: 2, // UNSIGNED_SHORT_4_4_4_4
  0x8034: 2, // UNSIGNED_SHORT_5_5_5_1
  0x8368: 4, // UNSIGNED_INT_2_10_10_10_REV
  0x84fa: 4, // UNSIGNED_INT_24_8
  0x8c3e: 4, // UNSIGNED_INT_5_9_9_9_REV
  0x8c3b: 4, // UNSIGNED_INT_10F_11F_11F_REV
};

const BYTES_BY_INTERNAL_FORMAT: { [internalFormat: number]: number } = {
  0x8058: 4, // RGBA8
  0x8c43: 4, // SRGB8_ALPHA8
  0x8051: 3, // RGB8
  0x8c41: 3, // SRGB8
  0x822b: 2, // RG8
  0x8229: 1, // R8
  0x8814: 16, // RGBA32F
  0x881a: 8, // RGBA16F
  0x8815: 12, // RGB32F
  0x881b: 6, // RGB16F
  0x8230: 8, // RG32F
  0x822f: 4, // RG16F
  0x822e: 4, // R32F
  0x822d: 2, // R16F
  0x81a5: 2, // DEPTH_COMPONENT16
  0x81a6: 3, // DEPTH_COMPONENT24
  0x81a7: 4, // DEPTH_COMPONENT32
  0x8cac: 4, // DEPTH_COMPONENT32F
  0x88f0: 4, // DEPTH24_STENCIL8
  0x8cad: 8, // DEPTH32F_STENCIL8
  0x8d48: 1, // STENCIL_INDEX8
  0x8059: 4, // RGB10_A2
  0x8c3a: 4, // R11F_G11F_B10F
};

const DEFAULT_BYTES_PER_PIXEL = 4;

export function bytesPerPixelForInternalFormat(internalFormat: number): number {
  return (
    BYTES_BY_INTERNAL_FORMAT[internalFormat] ??
    CHANNELS_BY_FORMAT[internalFormat] ??
    DEFAULT_BYTES_PER_PIXEL
  );
}

export function bytesPerPixelForUpload(format: number, type: number): number {
  const packedBytes = PACKED_TYPE_PIXEL_BYTES[type];
  if (packedBytes !== undefined) return packedBytes;
  const channels = CHANNELS_BY_FORMAT[format] ?? 4;
  const bytesPerChannel = BYTES_BY_TYPE[type] ?? 1;
  return channels * bytesPerChannel;
}

/** Bytes of a bufferData / bufferSubData source (size number or view). */
export function bytesOfBufferSource(
  source: unknown,
  sourceOffset?: unknown,
  length?: unknown,
): number {
  if (typeof source === "number") return source;
  if (source === null || source === undefined) return 0;
  if (ArrayBuffer.isView(source)) {
    const bytesPerElement =
      (source as unknown as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1;
    const offsetElements = typeof sourceOffset === "number" ? sourceOffset : 0;
    if (typeof length === "number" && length > 0) return length * bytesPerElement;
    return Math.max(0, source.byteLength - offsetElements * bytesPerElement);
  }
  if (source instanceof ArrayBuffer) return source.byteLength;
  return 0;
}

export function dimensionsOfImageSource(
  source: unknown,
): { width: number; height: number } | null {
  if (source === null || typeof source !== "object") return null;
  const candidate = source as {
    width?: number;
    height?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
    displayWidth?: number;
    displayHeight?: number;
  };
  const width =
    candidate.naturalWidth ?? candidate.videoWidth ?? candidate.displayWidth ?? candidate.width;
  const height =
    candidate.naturalHeight ?? candidate.videoHeight ?? candidate.displayHeight ?? candidate.height;
  if (typeof width !== "number" || typeof height !== "number") return null;
  return { width, height };
}

/** Bytes of one mip level, halving each dimension per level (3D halves depth too). */
export function bytesOfMipChain(
  target: number,
  levels: number,
  internalFormat: number,
  width: number,
  height: number,
  depth: number,
): number {
  const bytesPerPixel = bytesPerPixelForInternalFormat(internalFormat);
  let total = 0;
  for (let level = 0; level < levels; level++) {
    const levelWidth = Math.max(1, width >> level);
    const levelHeight = Math.max(1, height >> level);
    const levelDepth =
      target === TEXTURE_3D ? Math.max(1, depth >> level) : Math.max(1, depth);
    total += levelWidth * levelHeight * levelDepth * bytesPerPixel;
  }
  return total;
}

export function isLayeredTarget(target: number): boolean {
  return target === TEXTURE_3D || target === TEXTURE_2D_ARRAY;
}
