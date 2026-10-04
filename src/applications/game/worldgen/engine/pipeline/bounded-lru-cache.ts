// Bounded cache with second-chance (CLOCK) eviction, a close approximation of least-recently-used: a read only marks
// the entry, and eviction walks from the oldest insertion, giving marked entries another round instead of evicting.

/** Packs chunk coordinates (well inside +-2^21 for a 30M block world) into one exact number, for cache keys. */
export function packChunkColumnKey(chunkX: number, chunkZ: number): number {
  return (chunkX + 0x200000) * 0x400000 + (chunkZ + 0x200000);
}

interface CacheEntry<Value> {
  value: Value;
  wasReadSinceInsert: boolean;
}

export class BoundedLruCache<Key, Value> {
  private readonly entries = new Map<Key, CacheEntry<Value>>();

  constructor(private readonly maxEntries: number) {}

  get(key: Key): Value | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    entry.wasReadSinceInsert = true;
    return entry.value;
  }

  set(key: Key, value: Value): void {
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      existing.value = value;
      existing.wasReadSinceInsert = true;
      return;
    }
    this.entries.set(key, { value, wasReadSinceInsert: false });
    while (this.entries.size > this.maxEntries) this.evictOne();
  }

  private evictOne(): void {
    for (const [key, entry] of this.entries) {
      this.entries.delete(key);
      if (!entry.wasReadSinceInsert) return;
      entry.wasReadSinceInsert = false;
      this.entries.set(key, entry);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
