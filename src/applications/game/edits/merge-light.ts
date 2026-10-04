import { BOUNDARY_FACES, CELLS_PER_CHUNK } from "./chunk-cluster";

const LOW_NIBBLE_LANES = 0x0f0f0f0f;
const LANE_HIGH_BITS = 0x80808080;
const LANE_LOW_BITS = 0x01010101;
const BYTES_PER_WORD = 4;

/** Per-byte max of four values 0..15 held one per byte lane of each word. */
function maxOfNibbleLanes(first: number, second: number): number {
  const differenceLanes = ((first | LANE_HIGH_BITS) - second) >>> 0;
  const firstIsAtLeastSecond = (differenceLanes >>> 7) & LANE_LOW_BITS;
  const firstWinsMask = Math.imul(firstIsAtLeastSecond, 0xff);
  return (first & firstWinsMask) | (second & ~firstWinsMask);
}

function maxOfPackedLight(first: number, second: number): number {
  const sky = maxOfNibbleLanes(
    (first >>> 4) & LOW_NIBBLE_LANES,
    (second >>> 4) & LOW_NIBBLE_LANES,
  );
  const block = maxOfNibbleLanes(
    first & LOW_NIBBLE_LANES,
    second & LOW_NIBBLE_LANES,
  );
  return (sky << 4) | block;
}

/**
 * Raises each light byte of target to the brighter of the two values, sky and
 * block light compared separately (a byte-wise max would let a bright sky
 * level overwrite a brighter block level). Works four cells at a time when
 * both arrays are word aligned.
 */
export function mergeLightInPlace(target: Uint8Array, update: Uint8Array) {
  if (target.length !== update.length) {
    throw new Error("light arrays being merged must be the same size");
  }
  const isWordAligned =
    target.byteOffset % BYTES_PER_WORD === 0 &&
    update.byteOffset % BYTES_PER_WORD === 0 &&
    target.length % BYTES_PER_WORD === 0;
  let position = 0;
  if (isWordAligned) {
    const wordCount = target.length / BYTES_PER_WORD;
    const targetWords = new Uint32Array(
      target.buffer,
      target.byteOffset,
      wordCount,
    );
    const updateWords = new Uint32Array(
      update.buffer,
      update.byteOffset,
      wordCount,
    );
    for (let word = 0; word < wordCount; word++) {
      const updateWord = updateWords[word];
      const targetWord = targetWords[word];
      if (updateWord !== targetWord) {
        targetWords[word] = maxOfPackedLight(targetWord, updateWord);
      }
    }
    position = target.length;
  }
  for (; position < target.length; position++) {
    const targetValue = target[position];
    const updateValue = update[position];
    const sky = Math.max(targetValue >> 4, updateValue >> 4);
    const block = Math.max(targetValue & 0xf, updateValue & 0xf);
    target[position] = (sky << 4) | block;
  }
}

/** Merges every update into the first array, in place, and returns it. */
export function mergeLightUpdatesInPlace(
  target: Uint8Array,
  updates: ArrayLike<Uint8Array>,
): Uint8Array {
  for (let position = 0; position < updates.length; position++) {
    mergeLightInPlace(target, updates[position]);
  }
  return target;
}

/** Bit set by mergeLightReportingFaces when any cell got brighter, above the six face bits. */
export const LIGHT_MERGE_CHANGED = 1 << 6;

/**
 * mergeLightInPlace for a whole chunk that also says what changed: LIGHT_MERGE_CHANGED when any cell got
 * brighter, plus one bit per chunk face (chunk-cluster direction order) that has a brightened cell on it.
 */
export function mergeLightReportingFaces(target: Uint8Array, update: Uint8Array): number {
  if (target.length !== CELLS_PER_CHUNK || update.length !== CELLS_PER_CHUNK) {
    throw new Error("mergeLightReportingFaces merges whole chunks");
  }
  if (target.byteOffset % BYTES_PER_WORD !== 0 || update.byteOffset % BYTES_PER_WORD !== 0) {
    const before = target.slice();
    mergeLightInPlace(target, update);
    let changes = 0;
    for (let index = 0; index < CELLS_PER_CHUNK; index++) {
      if (before[index] !== target[index]) changes |= LIGHT_MERGE_CHANGED | BOUNDARY_FACES[index]!;
    }
    return changes;
  }
  const wordCount = CELLS_PER_CHUNK / BYTES_PER_WORD;
  const targetWords = new Uint32Array(target.buffer, target.byteOffset, wordCount);
  const updateWords = new Uint32Array(update.buffer, update.byteOffset, wordCount);
  let changes = 0;
  for (let word = 0; word < wordCount; word++) {
    const updateWord = updateWords[word]!;
    const targetWord = targetWords[word]!;
    if (updateWord === targetWord) continue;
    const mergedWord = maxOfPackedLight(targetWord, updateWord) >>> 0;
    if (mergedWord === targetWord) continue;
    targetWords[word] = mergedWord;
    changes |= LIGHT_MERGE_CHANGED;
    for (let lane = 0; lane < BYTES_PER_WORD; lane++) {
      const shift = lane * 8;
      if (((mergedWord >>> shift) & 0xff) !== ((targetWord >>> shift) & 0xff)) {
        changes |= BOUNDARY_FACES[word * BYTES_PER_WORD + lane]!;
      }
    }
  }
  return changes;
}
