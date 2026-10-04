// Many changed blocks as one compact binary packet. Consecutive changes that continue a straight run of the same block
// along one axis (y for brushes, whose cells run along y; z for saved edits, stored in z order) collapse into one run:
// a radius 64 sphere (about 1.1 million blocks) becomes about 13 000 runs, under 200 KB.
//
// Layout (little endian): u32 run count, u8 run axis (0 x, 1 y, 2 z), 3 bytes padding, then per field arrays:
// i32 start x, i32 start y, i32 start z, u16 length, u8 block.

import { BlockEditBatch } from "../edits/block-edit-batch";

const HEADER_BYTES = 8;
const BYTES_PER_RUN = 4 * 3 + 2 + 1;
const MAXIMUM_RUN_LENGTH = 0xffff;

export type RunAxis = 0 | 1 | 2;

export function encodeBlockRuns(
  count: number,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  zs: ArrayLike<number>,
  blocks: ArrayLike<number>,
  runAxis: RunAxis,
): ArrayBuffer {
  const startXs = new Int32Array(count);
  const startYs = new Int32Array(count);
  const startZs = new Int32Array(count);
  const lengths = new Uint16Array(count);
  const runBlocks = new Uint8Array(count);
  let runCount = 0;
  for (let position = 0; position < count; position++) {
    const x = xs[position];
    const y = ys[position];
    const z = zs[position];
    const block = blocks[position];
    if (runCount > 0) {
      const last = runCount - 1;
      const length = lengths[last];
      const continuesRun =
        runBlocks[last] === block &&
        length < MAXIMUM_RUN_LENGTH &&
        x === startXs[last] + (runAxis === 0 ? length : 0) &&
        y === startYs[last] + (runAxis === 1 ? length : 0) &&
        z === startZs[last] + (runAxis === 2 ? length : 0);
      if (continuesRun) {
        lengths[last] = length + 1;
        continue;
      }
    }
    startXs[runCount] = x;
    startYs[runCount] = y;
    startZs[runCount] = z;
    lengths[runCount] = 1;
    runBlocks[runCount] = block;
    runCount++;
  }

  const buffer = new ArrayBuffer(HEADER_BYTES + runCount * BYTES_PER_RUN);
  const header = new DataView(buffer);
  header.setUint32(0, runCount, true);
  header.setUint8(4, runAxis);
  let offset = HEADER_BYTES;
  for (const field of [startXs, startYs, startZs]) {
    new Int32Array(buffer, offset, runCount).set(field.subarray(0, runCount));
    offset += runCount * 4;
  }
  // Uint16 views need 2 byte alignment: the i32 fields keep the offset a multiple of 4.
  new Uint16Array(buffer, offset, runCount).set(lengths.subarray(0, runCount));
  offset += runCount * 2;
  new Uint8Array(buffer, offset, runCount).set(runBlocks.subarray(0, runCount));
  return buffer;
}

/** Expands a packet back into edits, in the order they were encoded. */
export function decodeBlockRuns(buffer: ArrayBuffer): BlockEditBatch {
  const header = new DataView(buffer);
  const runCount = header.getUint32(0, true);
  const runAxis = header.getUint8(4);
  let offset = HEADER_BYTES;
  const startXs = new Int32Array(buffer.slice(offset, offset + runCount * 4));
  offset += runCount * 4;
  const startYs = new Int32Array(buffer.slice(offset, offset + runCount * 4));
  offset += runCount * 4;
  const startZs = new Int32Array(buffer.slice(offset, offset + runCount * 4));
  offset += runCount * 4;
  const lengths = new Uint16Array(buffer.slice(offset, offset + runCount * 2));
  offset += runCount * 2;
  const runBlocks = new Uint8Array(buffer, offset, runCount);

  let editCount = 0;
  for (let run = 0; run < runCount; run++) editCount += lengths[run];
  const batch = new BlockEditBatch("any", Math.max(editCount, 1));
  for (let run = 0; run < runCount; run++) {
    for (let step = 0; step < lengths[run]; step++) {
      batch.push(
        startXs[run] + (runAxis === 0 ? step : 0),
        startYs[run] + (runAxis === 1 ? step : 0),
        startZs[run] + (runAxis === 2 ? step : 0),
        runBlocks[run],
      );
    }
  }
  return batch;
}
