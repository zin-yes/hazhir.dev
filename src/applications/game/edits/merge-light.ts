import { BOUNDARY_FACES, CELLS_PER_CHUNK } from "./chunk-cluster";

const LOW_NIBBLE_LANES = 0x0f0f0f0f;
const LANE_HIGH_BITS = 0x80808080;
const LANE_LOW_BITS = 0x01010101;
const BYTES_PER_WORD = 4;

/**
 * What the merges did, as plain integers so the merge loops stay free of profiler calls and a worker can use the
 * same module. Whoever reports them (the main thread's pipeline, a worker's recorder) drains them.
 */
export interface LightMergeStats {
  /** Calls of mergeLightInPlace (also counts the ones mergeLightUpdatesInPlace makes). */
  inPlaceMerges: number;
  /** Whole chunk merges through mergeLightReportingFaces. */
  reportingMerges: number;
  /** Reporting merges that brightened at least one cell. */
  reportingMergesChanged: number;
  /** Four cell words compared, words that differed, and words whose merged value was brighter than the target. */
  wordsCompared: number;
  wordsDiffering: number;
  wordsBrightened: number;
  /** Cells brightened inside brightened words (reporting merges only) and chunk faces reported as changed. */
  cellsBrightened: number;
  faceBitsReported: number;
  /** Merges that could not read whole words and compared cell by cell. */
  unalignedMerges: number;
}

const lightMergeStats: LightMergeStats = {
  inPlaceMerges: 0,
  reportingMerges: 0,
  reportingMergesChanged: 0,
  wordsCompared: 0,
  wordsDiffering: 0,
  wordsBrightened: 0,
  cellsBrightened: 0,
  faceBitsReported: 0,
  unalignedMerges: 0,
};

/** Returns the merge traffic since the last call and resets it. */
export function drainLightMergeStats(): LightMergeStats {
  const drained = { ...lightMergeStats };
  lightMergeStats.inPlaceMerges = 0;
  lightMergeStats.reportingMerges = 0;
  lightMergeStats.reportingMergesChanged = 0;
  lightMergeStats.wordsCompared = 0;
  lightMergeStats.wordsDiffering = 0;
  lightMergeStats.wordsBrightened = 0;
  lightMergeStats.cellsBrightened = 0;
  lightMergeStats.faceBitsReported = 0;
  lightMergeStats.unalignedMerges = 0;
  return drained;
}

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
  lightMergeStats.inPlaceMerges++;
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
    let wordsDiffering = 0;
    for (let word = 0; word < wordCount; word++) {
      const updateWord = updateWords[word];
      const targetWord = targetWords[word];
      if (updateWord !== targetWord) {
        wordsDiffering++;
        targetWords[word] = maxOfPackedLight(targetWord, updateWord);
      }
    }
    lightMergeStats.wordsCompared += wordCount;
    lightMergeStats.wordsDiffering += wordsDiffering;
    position = target.length;
  } else {
    lightMergeStats.unalignedMerges++;
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
    lightMergeStats.reportingMerges++;
    mergeLightInPlace(target, update);
    let changes = 0;
    for (let index = 0; index < CELLS_PER_CHUNK; index++) {
      if (before[index] !== target[index]) {
        changes |= LIGHT_MERGE_CHANGED | BOUNDARY_FACES[index]!;
        lightMergeStats.cellsBrightened++;
      }
    }
    recordReportedChanges(changes);
    return changes;
  }
  lightMergeStats.reportingMerges++;
  const wordCount = CELLS_PER_CHUNK / BYTES_PER_WORD;
  const targetWords = new Uint32Array(target.buffer, target.byteOffset, wordCount);
  const updateWords = new Uint32Array(update.buffer, update.byteOffset, wordCount);
  let changes = 0;
  let wordsDiffering = 0;
  let wordsBrightened = 0;
  let cellsBrightened = 0;
  for (let word = 0; word < wordCount; word++) {
    const updateWord = updateWords[word]!;
    const targetWord = targetWords[word]!;
    if (updateWord === targetWord) continue;
    wordsDiffering++;
    const mergedWord = maxOfPackedLight(targetWord, updateWord) >>> 0;
    if (mergedWord === targetWord) continue;
    wordsBrightened++;
    targetWords[word] = mergedWord;
    changes |= LIGHT_MERGE_CHANGED;
    for (let lane = 0; lane < BYTES_PER_WORD; lane++) {
      const shift = lane * 8;
      if (((mergedWord >>> shift) & 0xff) !== ((targetWord >>> shift) & 0xff)) {
        changes |= BOUNDARY_FACES[word * BYTES_PER_WORD + lane]!;
        cellsBrightened++;
      }
    }
  }
  lightMergeStats.wordsCompared += wordCount;
  lightMergeStats.wordsDiffering += wordsDiffering;
  lightMergeStats.wordsBrightened += wordsBrightened;
  lightMergeStats.cellsBrightened += cellsBrightened;
  recordReportedChanges(changes);
  return changes;
}

function recordReportedChanges(changes: number) {
  if (changes === 0) return;
  lightMergeStats.reportingMergesChanged++;
  for (let faceBit = 0; faceBit < 6; faceBit++) {
    if ((changes & (1 << faceBit)) !== 0) lightMergeStats.faceBitsReported++;
  }
}
