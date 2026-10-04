// Chunk records keyed by integer chunk keys: lookups by (chunkX, chunkY, chunkZ) never allocate a string.

import { FACE_NEIGHBOR_KEY_DELTAS, packChunkKey } from "./chunk-key";
import type { KnownChunkKeys } from "./streaming-plan";

export const FACE_NEIGHBOR_COUNT = FACE_NEIGHBOR_KEY_DELTAS.length;

export class ChunkStore<T> {
  private readonly recordByKey = new Map<number, T>();
  private readonly neighborScratch: (T | undefined)[] = new Array(FACE_NEIGHBOR_COUNT).fill(undefined);

  get size(): number {
    return this.recordByKey.size;
  }

  get(chunkX: number, chunkY: number, chunkZ: number): T | undefined {
    return this.recordByKey.get(packChunkKey(chunkX, chunkY, chunkZ));
  }

  getByKey(chunkKey: number): T | undefined {
    return this.recordByKey.get(chunkKey);
  }

  has(chunkX: number, chunkY: number, chunkZ: number): boolean {
    return this.recordByKey.has(packChunkKey(chunkX, chunkY, chunkZ));
  }

  hasKey(chunkKey: number): boolean {
    return this.recordByKey.has(chunkKey);
  }

  set(chunkX: number, chunkY: number, chunkZ: number, record: T): this {
    this.recordByKey.set(packChunkKey(chunkX, chunkY, chunkZ), record);
    return this;
  }

  setByKey(chunkKey: number, record: T): this {
    this.recordByKey.set(chunkKey, record);
    return this;
  }

  delete(chunkX: number, chunkY: number, chunkZ: number): boolean {
    return this.recordByKey.delete(packChunkKey(chunkX, chunkY, chunkZ));
  }

  deleteByKey(chunkKey: number): boolean {
    return this.recordByKey.delete(chunkKey);
  }

  clear(): void {
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
    for (let faceIndex = 0; faceIndex < FACE_NEIGHBOR_COUNT; faceIndex++) {
      this.neighborScratch[faceIndex] = this.recordByKey.get(chunkKey + FACE_NEIGHBOR_KEY_DELTAS[faceIndex]!);
    }
    return this.neighborScratch;
  }
}
