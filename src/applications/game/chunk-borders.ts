import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "./config";

export type BorderFace = "top" | "bottom" | "left" | "right" | "front" | "back";

const X_STRIDE = CHUNK_HEIGHT * CHUNK_HEIGHT;
const Y_STRIDE = CHUNK_HEIGHT;

/**
 * The one-block-thick slab of a chunk that its neighbor in the opposite direction
 * needs for meshing. The face names are the neighbor's view: "top" is this chunk's
 * lowest layer (it sits on top of the neighbor), "left" is its highest x layer.
 *
 * Layouts: top and bottom are [x * length + z], left and right are
 * [y * length + z], back and front are [x * height + y].
 */
export function extractBorderSlab(
  chunk: Uint8Array,
  face: BorderFace,
): ArrayBuffer {
  switch (face) {
    case "top":
      return copyRowsAlongZ(chunk, 0);
    case "bottom":
      return copyRowsAlongZ(chunk, (CHUNK_HEIGHT - 1) * Y_STRIDE);
    case "right":
      return chunk.slice(0, CHUNK_HEIGHT * CHUNK_LENGTH).buffer;
    case "left":
      return chunk.slice((CHUNK_WIDTH - 1) * X_STRIDE, CHUNK_WIDTH * X_STRIDE)
        .buffer;
    case "front":
      return copyColumnsAlongY(chunk, 0);
    case "back":
      return copyColumnsAlongY(chunk, CHUNK_LENGTH - 1);
  }
}

// One layer of constant y: a contiguous run of z for every x.
function copyRowsAlongZ(chunk: Uint8Array, yOffset: number): ArrayBuffer {
  const slab = new Uint8Array(CHUNK_WIDTH * CHUNK_LENGTH);
  for (let x = 0; x < CHUNK_WIDTH; x++) {
    const rowStart = x * X_STRIDE + yOffset;
    slab.set(
      chunk.subarray(rowStart, rowStart + CHUNK_LENGTH),
      x * CHUNK_LENGTH,
    );
  }
  return slab.buffer;
}

// One layer of constant z: a strided run of y for every x.
function copyColumnsAlongY(chunk: Uint8Array, zOffset: number): ArrayBuffer {
  const slab = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT);
  for (let x = 0; x < CHUNK_WIDTH; x++) {
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      slab[x * CHUNK_HEIGHT + y] = chunk[x * X_STRIDE + y * Y_STRIDE + zOffset];
    }
  }
  return slab.buffer;
}
