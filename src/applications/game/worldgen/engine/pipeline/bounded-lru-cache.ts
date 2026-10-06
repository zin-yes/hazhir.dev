// Bounded cache with second-chance (CLOCK) eviction, a close approximation of least-recently-used: a read only marks
// the entry, and eviction walks from the oldest insertion, giving marked entries another round instead of evicting.

import { defineHotCounter, noteHot } from "../profiling/hot-counters";

interface CacheCounterSlots {
  readonly hits: number;
  readonly misses: number;
  readonly insertions: number;
  readonly secondChances: number;
  readonly evictions: number;
}

const counterSlotsByName = new Map<string, CacheCounterSlots>();

/** Hit, miss, insertion, second-chance and eviction counters of a named cache (`cache.<name>.hits` and so on). */
function counterSlotsFor(name: string): CacheCounterSlots {
  let slots = counterSlotsByName.get(name);
  if (slots === undefined) {
    slots = {
      hits: defineHotCounter(`cache.${name}.hits`),
      misses: defineHotCounter(`cache.${name}.misses`),
      insertions: defineHotCounter(`cache.${name}.insertions`),
      secondChances: defineHotCounter(`cache.${name}.secondChances`),
      evictions: defineHotCounter(`cache.${name}.evictions`),
    };
    counterSlotsByName.set(name, slots);
  }
  return slots;
}

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
  private readonly counterSlots: CacheCounterSlots;

  /** `statisticsName` names the profiler counters of this cache (caches that share a name add up). */
  constructor(
    private readonly maxEntries: number,
    statisticsName = "unnamed",
  ) {
    this.counterSlots = counterSlotsFor(statisticsName);
  }

  get(key: Key): Value | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      noteHot(this.counterSlots.misses);
      return undefined;
    }
    noteHot(this.counterSlots.hits);
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
    noteHot(this.counterSlots.insertions);
    while (this.entries.size > this.maxEntries) this.evictOne();
  }

  private evictOne(): void {
    for (const [key, entry] of this.entries) {
      this.entries.delete(key);
      if (!entry.wasReadSinceInsert) {
        noteHot(this.counterSlots.evictions);
        return;
      }
      noteHot(this.counterSlots.secondChances);
      entry.wasReadSinceInsert = false;
      this.entries.set(key, entry);
    }
  }

  /** Presence check that does not count as a read. */
  has(key: Key): boolean {
    return this.entries.has(key);
  }

  get size(): number {
    return this.entries.size;
  }
}
