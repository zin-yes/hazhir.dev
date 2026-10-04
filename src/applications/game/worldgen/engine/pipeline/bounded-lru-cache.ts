// Least-recently-used map with a hard entry limit (Map iteration order is insertion order).

export class BoundedLruCache<Key, Value> {
  private readonly entries = new Map<Key, Value>();

  constructor(private readonly maxEntries: number) {}

  get(key: Key): Value | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: Key, value: Value): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as Key;
      this.entries.delete(oldestKey);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
