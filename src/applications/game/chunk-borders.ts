import { CHUNK_HEIGHT, CHUNK_LENGTH, CHUNK_WIDTH } from "./config";
import { profiler } from "./profiler";
import { DIMENSIONS } from "./profiler/dimensions";

export type BorderFace = "top" | "bottom" | "left" | "right" | "front" | "back";

const X_STRIDE = CHUNK_HEIGHT * CHUNK_HEIGHT;
const Y_STRIDE = CHUNK_HEIGHT;

/** How a face is copied: one contiguous slice, whole z rows per x, or one byte at a time along a strided column. */
const COPY_STRATEGY_BY_FACE: { [face in BorderFace]: "slice" | "rows" | "strided" } = {
  top: "rows",
  bottom: "rows",
  right: "slice",
  left: "slice",
  front: "strided",
  back: "strided",
};

const SLABS_COUNTER_BY_STRATEGY = {
  slice: "game.border.slabsBySlice",
  rows: "game.border.slabsByRows",
  strided: "game.border.slabsByStridedCopy",
};
const BYTES_METER_BY_FACE: { [face in BorderFace]: string } = {
  top: "bytes.border.top",
  bottom: "bytes.border.bottom",
  left: "bytes.border.left",
  right: "bytes.border.right",
  front: "bytes.border.front",
  back: "bytes.border.back",
};

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
  const slab = copyBorderSlab(chunk, face);
  if (profiler.enabled) recordExtraction(face, slab.byteLength);
  return slab;
}

function recordExtraction(face: BorderFace, bytes: number) {
  const strategy = COPY_STRATEGY_BY_FACE[face];
  profiler.addCounter("game.border.slabsExtracted");
  profiler.addCounter(SLABS_COUNTER_BY_STRATEGY[strategy]);
  if (strategy === "strided") profiler.addCounter("game.border.stridedBytesCopied", bytes);
  profiler.recordBytes(BYTES_METER_BY_FACE[face], bytes);
  profiler.recordBreakdown(DIMENSIONS.borderFace, face, { units: bytes, calls: 1 });
}

function copyBorderSlab(chunk: Uint8Array, face: BorderFace): ArrayBuffer {
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
