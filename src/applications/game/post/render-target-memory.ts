// Estimated GPU bytes of the render targets the post, snapshot, cloud and shadow passes keep alive, for the profiler's
// memory gauges. These are format-table estimates (no padding or driver overhead), like the rest of the GPU memory gauges.

/** RGBA half float colour, as used by the world, bloom, snapshot and cloud targets. */
export const HALF_FLOAT_RGBA_BYTES_PER_PIXEL = 8;
/** 24 bit depth plus 8 bit stencil, or a 32 bit depth texture. */
export const DEPTH_BYTES_PER_PIXEL = 4;
/** Single channel 8 bit colour, the colour attachment of the depth only shadow and snapshot depth targets. */
export const RED_BYTE_BYTES_PER_PIXEL = 1;

export function estimateTargetBytes(width: number, height: number, bytesPerPixel: number): number {
  return width * height * bytesPerPixel;
}
