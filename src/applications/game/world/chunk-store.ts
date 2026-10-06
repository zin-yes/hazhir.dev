// Chunk records keyed by integer chunk keys: lookups by (chunkX, chunkY, chunkZ) never allocate a string.

import { profiler } from "../profiler";
import { FACE_NEIGHBOR_KEY_DELTAS, packChunkKey } from "./chunk-key";
import type { KnownChunkKeys } from "./streaming-plan";

export const FACE_NEIGHBOR_COUNT = FACE_NEIGHBOR_KEY_DELTAS.length;

export class ChunkStore<T> {
  private readonly recordByKey = new Map<number, T>();
  private readonly neighborScratch: (T | undefined)[] = new Array(FACE_NEIGHBOR_COUNT).fill(undefined);
  /** Lookup traffic since the last publishProfilerStats call, plain integers because lookups are very hot. */
  private lookupHits = 0;
  private lookupMisses = 0;
  private existenceChecksFound = 0;
  private existenceChecksMissing = 0;
  private neighborHits = 0;
  private neighborMisses = 0;
  private insertCount = 0;
  private replaceCount = 0;
  private deleteCount = 0;
  private peakSizeSinceSample = 0;

  get size(): number {
    return this.recordByKey.size;
  }

  get(chunkX: number, chunkY: number, chunkZ: number): T | undefined {
    return this.getByKey(packChunkKey(chunkX, chunkY, chunkZ));
  }

  getByKey(chunkKey: number): T | undefined {
    const record = this.recordByKey.get(chunkKey);
    if (record === undefined) this.lookupMisses++;
    else this.lookupHits++;
    return record;
  }

  has(chunkX: number, chunkY: number, chunkZ: number): boolean {
    return this.hasKey(packChunkKey(chunkX, chunkY, chunkZ));
  }

  hasKey(chunkKey: number): boolean {
    const isPresent = this.recordByKey.has(chunkKey);
    if (isPresent) this.existenceChecksFound++;
    else this.existenceChecksMissing++;
    return isPresent;
  }

  set(chunkX: number, chunkY: number, chunkZ: number, record: T): this {
    return this.setByKey(packChunkKey(chunkX, chunkY, chunkZ), record);
  }

  setByKey(chunkKey: number, record: T): this {
    if (this.recordByKey.has(chunkKey)) this.replaceCount++;
    else this.insertCount++;
    this.recordByKey.set(chunkKey, record);
    if (this.recordByKey.size > this.peakSizeSinceSample) this.peakSizeSinceSample = this.recordByKey.size;
    return this;
  }

  delete(chunkX: number, chunkY: number, chunkZ: number): boolean {
    return this.deleteByKey(packChunkKey(chunkX, chunkY, chunkZ));
  }

  deleteByKey(chunkKey: number): boolean {
    const wasDeleted = this.recordByKey.delete(chunkKey);
    if (wasDeleted) this.deleteCount++;
    return wasDeleted;
  }

  clear(): void {
    this.deleteCount += this.recordByKey.size;
    this.recordByKey.clear();
  }

  keys(): IterableIterator<number> {
    return this.recordByKey.keys();
  }

  values(): IterableIterator<T> {
    return this.recordByKey.values();
  }

  entries(): IterableIterator<[number, T]> {
    return this.recordByKey.entries();
  }

  forEach(visit: (record: T, chunkKey: number) => void): void {
    this.recordByKey.forEach(visit);
  }

  /** Live view of the stored keys in the shape the stream planner expects as its "known chunks" argument. */
  asKnownChunkKeys(): KnownChunkKeys {
    return this.recordByKey;
  }

  /**
   * Records of the six face neighbors in the order +x, -x, +y, -y, +z, -z (undefined where absent).
   * The returned array is reused by every call: read it before calling again.
   */
  neighborsOf(chunkX: number, chunkY: number, chunkZ: number): readonly (T | undefined)[] {
    return this.neighborsOfKey(packChunkKey(chunkX, chunkY, chunkZ));
  }

  neighborsOfKey(chunkKey: number): readonly (T | undefined)[] {
    let hits = 0;
    for (let faceIndex = 0; faceIndex < FACE_NEIGHBOR_COUNT; faceIndex++) {
      const neighbor = this.recordByKey.get(chunkKey + FACE_NEIGHBOR_KEY_DELTAS[faceIndex]!);
      if (neighbor !== undefined) hits++;
      this.neighborScratch[faceIndex] = neighbor;
    }
    this.neighborHits += hits;
    this.neighborMisses += FACE_NEIGHBOR_COUNT - hits;
    return this.neighborScratch;
  }

  /**
   * Publishes the lookup, insert and delete counts since the last call and the current and peak size. Called by
   * whoever samples the pipeline about once a second.
   */
  publishProfilerStats(): void {
    if (profiler.enabled) {
      profiler.addCounter("game.chunkStore.hits", this.lookupHits);
      profiler.addCounter("game.chunkStore.misses", this.lookupMisses);
      profiler.addCounter("game.chunkStore.existenceChecksFound", this.existenceChecksFound);
      profiler.addCounter("game.chunkStore.existenceChecksMissing", this.existenceChecksMissing);
      profiler.addCounter("game.chunkStore.neighborHits", this.neighborHits);
      profiler.addCounter("game.chunkStore.neighborMisses", this.neighborMisses);
      profiler.addCounter("game.chunkStore.inserts", this.insertCount);
      profiler.addCounter("game.chunkStore.replacements", this.replaceCount);
      profiler.addCounter("game.chunkStore.deletes", this.deleteCount);
      profiler.sampleGauge("game.chunkStore.size", this.recordByKey.size);
      profiler.sampleGauge("game.chunkStore.sizePeak", Math.max(this.peakSizeSinceSample, this.recordByKey.size));
    }
    this.lookupHits = 0;
    this.lookupMisses = 0;
    this.existenceChecksFound = 0;
    this.existenceChecksMissing = 0;
    this.neighborHits = 0;
    this.neighborMisses = 0;
    this.insertCount = 0;
    this.replaceCount = 0;
    this.deleteCount = 0;
    this.peakSizeSinceSample = this.recordByKey.size;
  }
}
